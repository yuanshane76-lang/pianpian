const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_PARSE_BYTES = 16 * 1024 * 1024;
const MAX_TASK_BYTES = 1024 * 1024;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;

/** @typedef {ArrayBuffer | Uint8Array | Buffer} Bytes */
/** @typedef {{id: string, name: string, duplicate: boolean, page?: number}} SavedDocument */

function validateId(id) {
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid document id.");
  return id;
}

function validateRelative(relative) {
  if (typeof relative !== "string" || relative.length > 1024 || /[\\:%\x00-\x1f\x7f<>\"|?*]/.test(relative)) {
    throw new Error("Invalid asset path.");
  }
  const segments = relative.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || /[. ]$/.test(segment) || RESERVED_NAME.test(segment))) {
    throw new Error("Invalid asset path.");
  }
  return segments;
}

function sanitizeName(input) {
  let name = typeof input === "string" ? input.split(/[\\/]/).pop() : "";
  name = (name || "").replace(/[<>:"|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, (character) => character === "\0" ? "" : "_")
    .replace(/^[. ]+|[. ]+$/g, "");
  if (!name) name = "document.pdf";
  if (!/\.pdf$/i.test(name)) name += ".pdf";
  if (RESERVED_NAME.test(name)) name = `_${name}`;
  const stem = Array.from(name.slice(0, -4));
  while (Buffer.byteLength(stem.join("")) > 176) stem.pop();
  return `${stem.join("")}.pdf`;
}

function bytesView(data) {
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (Object.prototype.toString.call(data) === "[object ArrayBuffer]") return Buffer.from(data);
  throw new Error("Document data must be bytes.");
}

function validatePdf(data) {
  const bytes = bytesView(data);
  if (bytes.length > MAX_PDF_BYTES) throw new Error("文件超过 100 MB 限制。");
  if (bytes.length < 8) throw new Error("不支持的文件内容：文件过小。");
  // 接受 PDF、pptx（ZIP 容器）与 ppt（OLE 容器）：与 MinerU v4 支持的类型一致。
  const ascii = bytes.subarray(0, 8).toString("ascii");
  const head = bytes.subarray(0, 4);
  const isPdf = /^%PDF-[0-9]\.[0-9]/.test(ascii);
  const isZip = head[0] === 0x50 && head[1] === 0x4b && [3, 5, 7].includes(head[2]);
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  if (!isPdf && !isZip && !isOle) throw new Error("不支持的文件内容：仅接受 PDF、PPTX 或 PPT。");
  return bytes;
}

// Reject existing junctions/symlinks at every component under the trusted configured root.
// Checking both before and after mkdir also catches preexisting linked document directories.
function assertSafePath(root, target) {
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Unsafe document path.");
  }
  const components = [root];
  let current = root;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    components.push(current);
  }
  for (let index = 0; index < components.length; index++) {
    let stat;
    try {
      stat = fs.lstatSync(components[index]);
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
    if (stat.isSymbolicLink() || (index < components.length - 1 && !stat.isDirectory())) {
      throw new Error("Unsafe document path or symbolic link.");
    }
  }
}

async function atomicWrite(root, target, data, createOnly = false) {
  assertSafePath(root, target);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  assertSafePath(root, target);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fsp.open(temporary, "wx", 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    assertSafePath(root, target);
    if (createOnly) {
      // A hard link atomically publishes a complete file without overwriting a concurrent import.
      try {
        await fsp.link(temporary, target);
      } catch (error) {
        if (error.code === "EEXIST") return false;
        throw error;
      }
    } else {
      await fsp.rename(temporary, target);
    }
    return true;
  } finally {
    if (handle) await handle.close();
    await fsp.rm(temporary, { force: true });
  }
}

async function readBounded(root, target, maximum) {
  assertSafePath(root, target);
  const handle = await fsp.open(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Invalid document file.");
    if (stat.size > maximum) throw new Error("Document file exceeds the size limit.");
    // Read at most maximum + 1 bytes, even if a file grows after stat.
    const chunks = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximum + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maximum) throw new Error("Document file exceeds the size limit.");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Uint8Array.from(Buffer.concat(chunks, total));
  } finally {
    await handle.close();
  }
}

function encodeRecord(value, maximum) {
  let json;
  try {
    json = JSON.stringify(value);
    if (!json) throw new Error();
  } catch {
    throw new Error("Record must be JSON serializable.");
  }
  if (Buffer.byteLength(json) > maximum) throw new Error("JSON record exceeds the size limit.");
  const queue = [JSON.parse(json)];
  while (queue.length) {
    const item = queue.pop();
    if (!item || typeof item !== "object") continue;
    for (const [key, nested] of Object.entries(item)) {
      if (/^(?:api[_-]?key|authorization|password|token|secret|access[_-]?key)$/i.test(key)) {
        throw new Error("Credential or secret fields must stay in the parent process.");
      }
      if (nested && typeof nested === "object") queue.push(nested);
    }
  }
  return Buffer.from(json, "utf8");
}

/**
 * All I/O methods return Promises; assetPath is synchronous and does not create directories.
 * @param {{rootDirectory: string}} options
 */
function createDocumentStore({ rootDirectory }) {
  if (typeof rootDirectory !== "string" || !rootDirectory || rootDirectory.includes("\0")) {
    throw new Error("A root directory is required.");
  }
  const root = path.resolve(rootDirectory);
  const documentPath = (id, file) => path.join(root, validateId(id), file);
  const assetPath = (id, relative) => {
    const target = path.join(root, validateId(id), "assets", ...validateRelative(relative));
    assertSafePath(root, target);
    return target;
  };

  async function loadRecord(id, file, maximum) {
    const target = documentPath(id, file);
    let bytes;
    try {
      bytes = await readBounded(root, target, maximum);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    try {
      return JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      throw new Error("Stored record contains invalid JSON.");
    }
  }

  async function saveRecord(id, file, value, maximum) {
    const target = documentPath(id, file);
    const bytes = encodeRecord(value, maximum);
    const original = documentPath(id, "original.pdf");
    assertSafePath(root, original);
    const stat = await fsp.lstat(original);
    if (!stat.isFile()) throw new Error("Document original is missing.");
    await atomicWrite(root, target, bytes);
  }

  return {
    /** @param {{name: string, data: Bytes}} input @returns {Promise<SavedDocument>} */
    async save({ name, data }) {
      // Snapshot before the first await; callers may reuse or mutate their input buffer.
      const bytes = Buffer.from(validatePdf(data));
      const id = createHash("sha256").update(bytes).digest("hex");
      const created = await atomicWrite(root, documentPath(id, "original.pdf"), bytes, true);
      return { id, name: sanitizeName(name), duplicate: !created };
    },
    /** @returns {Promise<Uint8Array>} */
    async read(id) {
      return readBounded(root, documentPath(id, "original.pdf"), MAX_PDF_BYTES);
    },
    async remove(id) {
      const target = documentPath(id, "");
      assertSafePath(root, target);
      try {
        await fsp.lstat(target);
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
      try {
        await fsp.rm(target, { recursive: true, force: true });
        return true;
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    },
    assetPath,
    /** @param {string} id @param {string} relative @param {Bytes} data */
    async saveAsset(id, relative, data) {
      const target = assetPath(id, relative);
      const view = bytesView(data);
      if (view.length > MAX_ASSET_BYTES) throw new Error("Asset exceeds the size limit.");
      const bytes = Buffer.from(view);
      const original = documentPath(id, "original.pdf");
      assertSafePath(root, original);
      const stat = await fsp.lstat(original);
      if (!stat.isFile()) throw new Error("Document original is missing.");
      await atomicWrite(root, target, bytes);
    },
    /** @returns {Promise<Uint8Array>} */
    async readAsset(id, relative) {
      return readBounded(root, assetPath(id, relative), MAX_ASSET_BYTES);
    },
    loadParse: (id) => loadRecord(id, "parse.json", MAX_PARSE_BYTES),
    saveParse: (id, result) => saveRecord(id, "parse.json", result, MAX_PARSE_BYTES),
    loadTask: (id) => loadRecord(id, "task.json", MAX_TASK_BYTES),
    saveTask: (id, task) => saveRecord(id, "task.json", task, MAX_TASK_BYTES),
  };
}

module.exports = { createDocumentStore };
