const { inflateRawSync } = require("node:zlib");
const { createHash } = require("node:crypto");
const path = require("node:path").posix;

const API_ORIGIN = "https://mineru.net";
const UPLOAD_HOSTS = new Set(["mineru.net", "mineru.oss-cn-shanghai.aliyuncs.com"]);
const RESULT_HOSTS = new Set([...UPLOAD_HOSTS, "cdn-mineru.openxlab.org.cn"]);
const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 4096;
const MAX_BLOCKS = 50000;
const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|gif|bmp|jp2|tiff?)$/i;

/** @typedef {ArrayBuffer | Uint8Array | Buffer} Bytes */
/** @typedef {{fetchImpl?: typeof fetch, timeoutMs?: number}} NetworkOptions */
/** @typedef {"waiting-file" | "pending" | "running" | "converting" | "failed" | "done"} BatchState */
/** @typedef {{state: BatchState, progress: number, error?: string, zipUrl?: string}} BatchStatus */
/** @typedef {{id: string, kind: "heading" | "paragraph" | "image" | "table" | "equation", text: string, order: number, pageNumber: number, headingLevel?: number, assetPath?: string, caption?: string, bbox?: [number, number, number, number], pageWidth?: number, pageHeight?: number}} Block */
/** @typedef {{blocks: Block[], title?: string, pageCount?: number}} ParseResult */
/** @typedef {{result: ParseResult, assets: {path: string, data: Uint8Array}[]}} ExtractedResult */

// Only our own errors pass across the boundary. Fetch, parser and service error text
// may contain credentials or signed URLs and must never become renderer-facing errors.
class MineruError extends Error {}
const fail = (message) => { throw new MineruError(message); };

function bytesView(data) {
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (Object.prototype.toString.call(data) === "[object ArrayBuffer]") return Buffer.from(data);
  return fail("MinerU input must contain bytes.");
}

function validateUrl(value, hosts) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return fail("Invalid MinerU URL.");
  }
  if (typeof value !== "string" || value.length > 16384 || url.protocol !== "https:" || !hosts.has(url.hostname) ||
      url.username || url.password || url.port || url.hash || /[\x00-\x20]/.test(value)) {
    return fail("Untrusted MinerU URL.");
  }
  return value;
}

function validateKey(apiKey) {
  if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 8192 || /[\x00-\x20\x7f]/.test(apiKey)) {
    fail("A valid MinerU API key is required.");
  }
}

function validateBatchId(batchId) {
  if (typeof batchId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(batchId)) fail("Invalid MinerU batch id.");
  return batchId;
}

function sanitizePdfName(value) {
  let name = typeof value === "string" ? value.split(/[\\/]/).pop() : "";
  name = (name || "").replace(/[<>:"|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "_").replace(/^[. ]+|[. ]+$/g, "");
  if (!name) name = "document.pdf";
  if (!/\.pdf$/i.test(name)) name += ".pdf";
  if (RESERVED_NAME.test(name)) name = `_${name}`;
  const stem = Array.from(name.slice(0, -4));
  while (Buffer.byteLength(stem.join("")) > 176) stem.pop();
  return `${stem.join("")}.pdf`;
}

async function readResponseBytes(response, maximum) {
  const advertised = response.headers?.get?.("content-length");
  if (advertised !== null && advertised !== undefined && /^\d+$/.test(advertised) && Number(advertised) > maximum) {
    fail("MinerU response exceeds the size limit.");
  }
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximum) {
          // Do not await a possibly unresponsive injected stream cancellation.
          void reader.cancel().catch(() => {});
          fail("MinerU response exceeds the size limit.");
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, total);
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = bytesView(await response.arrayBuffer());
  if (bytes.length > maximum) fail("MinerU response exceeds the size limit.");
  return bytes;
}

function checkHttp(response) {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) fail("MinerU authentication failed. Check the API key.");
  if (response.status === 429) fail("MinerU rate limit reached. Try again later.");
  fail("MinerU service request failed.");
}

async function withRequest({ fetchImpl = globalThis.fetch, timeoutMs }, url, init, consume, defaultTimeout) {
  const timeout = timeoutMs ?? defaultTimeout;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300000) fail("Invalid MinerU request timeout.");
  if (typeof fetchImpl !== "function") fail("MinerU fetch is unavailable.");
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new MineruError("MinerU request timed out."));
      controller.abort();
    }, timeout);
  });
  const operation = (async () => {
    const response = await fetchImpl(url, { ...init, redirect: "error", signal: controller.signal });
    checkHttp(response);
    return consume(response);
  })();
  try {
    return await Promise.race([operation, deadline]);
  } catch (error) {
    if (error instanceof MineruError) throw error;
    throw new MineruError("MinerU network request failed.");
  } finally {
    clearTimeout(timer);
  }
}

async function consumeApi(response) {
  let envelope;
  try {
    // The json fallback supports injected lightweight responses; real fetch bodies
    // are read incrementally with a 1 MiB limit before JSON parsing.
    envelope = response.body ? JSON.parse((await readResponseBytes(response, 1024 * 1024)).toString("utf8")) : await response.json();
  } catch (error) {
    if (error instanceof MineruError) throw error;
    return fail("Invalid MinerU API response.");
  }
  if (!envelope || typeof envelope !== "object" || !Object.hasOwn(envelope, "code")) fail("Invalid MinerU API response.");
  if (envelope.code !== 0) {
    if (envelope.code === "A0202" || envelope.code === "A0211") fail("MinerU authentication failed. Check the API key.");
    if (envelope.code === -60018 || envelope.code === -60009) fail("MinerU quota or queue limit reached. Try again later.");
    fail("MinerU service rejected the request.");
  }
  if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) fail("Invalid MinerU API response.");
  return envelope.data;
}

/**
 * @param {NetworkOptions & {apiKey: string, name: string}} options
 * @returns {Promise<{batchId: string, uploadUrl: string}>}
 */
async function requestUpload({ apiKey, name, fetchImpl, timeoutMs }) {
  validateKey(apiKey);
  const data = await withRequest({ fetchImpl, timeoutMs }, `${API_ORIGIN}/api/v4/file-urls/batch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ files: [{ name: sanitizePdfName(name) }], model_version: "vlm" }),
  }, consumeApi, 30000);
  if (typeof data.batch_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(data.batch_id) ||
      !Array.isArray(data.file_urls) || data.file_urls.length !== 1) fail("Invalid MinerU upload response.");
  return { batchId: data.batch_id, uploadUrl: validateUrl(data.file_urls[0], UPLOAD_HOSTS) };
}

/** @param {NetworkOptions & {uploadUrl: string, data: Bytes}} options @returns {Promise<void>} */
async function uploadPdf({ uploadUrl, data, fetchImpl, timeoutMs }) {
  validateUrl(uploadUrl, UPLOAD_HOSTS);
  const view = bytesView(data);
  if (view.length > MAX_ZIP_BYTES) fail("PDF exceeds the 100 MB limit.");
  if (view.length < 8 || !/^%PDF-[0-9]\.[0-9]/.test(view.subarray(0, 8).toString("ascii"))) fail("Invalid PDF header.");
  await withRequest({ fetchImpl, timeoutMs }, uploadUrl, { method: "PUT", body: Buffer.from(view) }, () => undefined, 120000);
}

/** @param {NetworkOptions & {apiKey: string, batchId: string}} options @returns {Promise<BatchStatus>} */
async function getBatch({ apiKey, batchId, fetchImpl, timeoutMs }) {
  validateKey(apiKey);
  validateBatchId(batchId);
  const data = await withRequest({ fetchImpl, timeoutMs }, `${API_ORIGIN}/api/v4/extract-results/batch/${batchId}`, {
    method: "GET", headers: { Authorization: `Bearer ${apiKey}` },
  }, consumeApi, 30000);
  if (data.batch_id !== undefined && data.batch_id !== batchId) fail("Invalid MinerU batch response.");
  const rows = data.extract_result;
  if (!Array.isArray(rows) || rows.length > 1) fail("Invalid MinerU batch response.");
  if (rows.length === 0) return { state: "waiting-file", progress: 0 };
  const row = rows[0];
  if (!row || !["waiting-file", "pending", "running", "converting", "failed", "done"].includes(row.state)) {
    fail("Invalid MinerU batch response.");
  }
  if (row.state === "failed") return { state: "failed", progress: 0, error: "MinerU parsing failed." };
  if (row.state === "done") {
    if (typeof row.full_zip_url !== "string" || !row.full_zip_url) fail("Invalid MinerU batch response.");
    return { state: "done", progress: 1, zipUrl: validateUrl(row.full_zip_url, RESULT_HOSTS) };
  }
  const { extracted_pages: completed, total_pages: total } = row.extract_progress || {};
  const progress = row.state === "running" && Number.isFinite(completed) && Number.isFinite(total) && total > 0
    ? Math.min(1, Math.max(0, completed / total)) : 0;
  return { state: row.state, progress };
}

/** @param {NetworkOptions & {zipUrl: string}} options @returns {Promise<Uint8Array>} */
async function downloadResultZip({ zipUrl, fetchImpl, timeoutMs }) {
  validateUrl(zipUrl, RESULT_HOSTS);
  return withRequest({ fetchImpl, timeoutMs }, zipUrl, { method: "GET" }, (response) => readResponseBytes(response, MAX_ZIP_BYTES), 120000);
}

function safeRelative(value) {
  if (typeof value !== "string" || value.length > 1024 || /[\\:%\x00-\x1f\x7f<>\"|?*]/.test(value)) fail("Unsafe ZIP asset path.");
  const segments = value.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part) || RESERVED_NAME.test(part))) {
    fail("Unsafe ZIP asset path.");
  }
  return value;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeName(bytes, flags) {
  try {
    if (!(flags & 0x800) && bytes.some((byte) => byte > 127)) fail("Unsupported ZIP filename encoding.");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof MineruError) throw error;
    return fail("Invalid ZIP filename encoding.");
  }
}

function checkExtra(bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) fail("Invalid ZIP extra field.");
    const kind = bytes.readUInt16LE(offset);
    const size = bytes.readUInt16LE(offset + 2);
    if (kind === 1) fail("ZIP64 results are unsupported.");
    offset += size + 4;
    if (offset > bytes.length) fail("Invalid ZIP extra field.");
  }
}

function unzip(bytes) {
  if (bytes.length > MAX_ZIP_BYTES) fail("ZIP exceeds the download size limit.");
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) {
      end = offset;
      break;
    }
  }
  if (end < 0) fail("Invalid or truncated ZIP result.");
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count ||
      count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) fail("Multi-disk and ZIP64 results are unsupported.");
  if (count > MAX_ENTRIES) fail("ZIP entry count exceeds the limit.");
  if (directoryOffset + directorySize !== end) fail("Invalid ZIP central directory.");
  const entries = [];
  const names = new Set();
  let expanded = 0;
  let offset = directoryOffset;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) fail("Invalid ZIP central directory.");
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const crc = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const externalAttributes = bytes.readUInt32LE(offset + 38);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end || !nameLength || bytes.readUInt16LE(offset + 34) !== 0) fail("Invalid ZIP member.");
    if (flags & ~0x80e) fail("Encrypted or unsupported ZIP result.");
    if (method !== 0 && method !== 8) fail("Unsupported ZIP compression method.");
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) fail("ZIP64 results are unsupported.");
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = decodeName(nameBytes, flags);
    const directory = name.endsWith("/");
    safeRelative(directory ? name.slice(0, -1) : name);
    const canonical = (directory ? name.slice(0, -1) : name).normalize("NFC").toLowerCase();
    if (names.has(canonical)) fail("Duplicate ZIP member path.");
    names.add(canonical);
    const mode = (externalAttributes >>> 16) & 0xf000;
    if (mode && mode !== 0x8000 && mode !== 0x4000) fail("ZIP symbolic links or special files are unsupported.");
    if ((mode === 0x4000 || (externalAttributes & 16)) && !directory) fail("Invalid ZIP directory member.");
    if (directory && size) fail("Invalid ZIP directory size.");
    if (size > MAX_FILE_BYTES || (/\.(?:json|md)$/i.test(name) && size > MAX_TEXT_BYTES)) fail("ZIP member size exceeds the limit.");
    if (size > Math.max(1, compressedSize) * 1000) fail("ZIP expansion ratio exceeds the limit.");
    expanded += size;
    if (expanded > MAX_EXPANDED_BYTES) fail("ZIP expanded size exceeds the limit.");
    checkExtra(bytes.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength));
    entries.push({ name, nameBytes, flags, method, crc, size, compressedSize, localOffset, directory });
    offset = next;
  }
  if (offset !== end) fail("Invalid ZIP central directory size.");
  const files = new Map();
  const spans = [];
  for (const entry of entries) {
    const { localOffset: local, compressedSize, size, method, flags } = entry;
    if (local + 30 > directoryOffset || bytes.readUInt32LE(local) !== 0x04034b50) fail("Invalid ZIP local header.");
    const nameLength = bytes.readUInt16LE(local + 26);
    const extraLength = bytes.readUInt16LE(local + 28);
    const start = local + 30 + nameLength + extraLength;
    let finish = start + compressedSize;
    if (finish > directoryOffset || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method ||
        !bytes.subarray(local + 30, local + 30 + nameLength).equals(entry.nameBytes)) fail("ZIP local header does not match its member.");
    checkExtra(bytes.subarray(local + 30 + nameLength, start));
    const expected = [entry.crc, compressedSize, size];
    const fields = [bytes.readUInt32LE(local + 14), bytes.readUInt32LE(local + 18), bytes.readUInt32LE(local + 22)];
    if (fields.some((field, index) => field !== expected[index] && (!(flags & 8) || field !== 0))) fail("ZIP local size or CRC does not match.");
    if (flags & 8) {
      if (finish + 12 > directoryOffset) fail("Invalid ZIP data descriptor.");
      const descriptor = bytes.readUInt32LE(finish) === 0x08074b50 ? finish + 4 : finish;
      if (descriptor + 12 > directoryOffset || expected.some((value, index) => bytes.readUInt32LE(descriptor + 4 * index) !== value)) {
        fail("ZIP data descriptor does not match.");
      }
      finish = descriptor + 12;
    }
    spans.push([local, finish]);
    let data;
    try {
      data = method === 0 ? Buffer.from(bytes.subarray(start, start + compressedSize))
        : inflateRawSync(bytes.subarray(start, start + compressedSize), { maxOutputLength: Math.max(1, size) });
    } catch {
      fail("Invalid ZIP deflate data or size limit exceeded.");
    }
    if (data.length !== size || crc32(data) !== entry.crc) fail("ZIP size or CRC check failed.");
    if (!entry.directory) files.set(entry.name, data);
  }
  spans.sort((a, b) => a[0] - b[0]);
  if (spans.some((span, index) => index && span[0] < spans[index - 1][1])) fail("Overlapping ZIP members.");
  for (const name of names) {
    let parent = path.dirname(name);
    while (parent !== ".") {
      if (entries.some((entry) => !entry.directory && entry.name.normalize("NFC").toLowerCase() === parent)) fail("Conflicting ZIP member paths.");
      parent = path.dirname(parent);
    }
  }
  return files;
}

function textOf(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean).join("\n");
  return "";
}

function assetReference(reference, sourcePath, files) {
  if (!reference || typeof reference !== "string") return undefined;
  if (/^(?:https?:|data:|\/\/)/i.test(reference)) return undefined;
  // Some MinerU Markdown renderers prefix relative references with "./".
  const relative = safeRelative(reference.startsWith("./") ? reference.slice(2) : reference);
  const candidate = path.join(path.dirname(sourcePath), relative);
  if (IMAGE_EXTENSION.test(candidate) && files.has(candidate)) return candidate;
  if (IMAGE_EXTENSION.test(relative) && files.has(relative)) return relative;
  return undefined;
}

function makeBlock(kind, text, pageNumber, order, extra = {}) {
  const { bbox, pageWidth, pageHeight, headingLevel, ...identity } = extra;
  const fingerprint = createHash("sha256").update(JSON.stringify([kind, text, pageNumber, order, identity])).digest("hex").slice(0, 20);
  return { id: `mineru-${fingerprint}`, kind, text, pageNumber, order, ...extra };
}

function normalizeBbox(value) {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const coordinates = value;
  if (coordinates.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))) return undefined;
  const [left, top, right, bottom] = coordinates;
  if (right <= left || bottom <= top || left < 0 || top < 0) return undefined;
  return [left, top, right, bottom];
}

function normalizePageSize(row) {
  const width = Number(row.page_width ?? row.pageWidth ?? row.width);
  const height = Number(row.page_height ?? row.pageHeight ?? row.height);
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? { pageWidth: width, pageHeight: height } : {};
}

function normalizeBboxToUnit(value) {
  const bbox = normalizeBbox(value);
  if (!bbox) return undefined;
  const max = Math.max(...bbox);
  return max <= 1000 ? bbox.map((coordinate) => coordinate / 1000) : undefined;
}

function normalizeContentList(bytes, sourcePath, files) {
  let rows;
  try {
    rows = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    fail("Invalid MinerU content-list JSON.");
  }
  if (!Array.isArray(rows) || rows.length > MAX_BLOCKS) fail("Invalid MinerU content list or block limit exceeded.");
  const blocks = [];
  let pageCount = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.type !== "string") fail("Invalid MinerU content-list block.");
    const validPage = Number.isInteger(row.page_idx) && row.page_idx >= 0 && row.page_idx < 100000;
    const pageNumber = validPage ? row.page_idx + 1 : 1;
    if (validPage) pageCount = Math.max(pageCount, pageNumber);
    let kind = "paragraph";
    if (row.type === "image" || row.type === "chart") kind = "image";
    else if (row.type === "table") kind = "table";
    else if (row.type === "equation" || row.type === "interline_equation") kind = "equation";
    else if (row.type === "title" || row.type === "heading" || (row.type === "text" && Number(row.text_level) > 0)) kind = "heading";
    const caption = textOf(row.image_caption || row.table_caption || row.caption);
    const text = kind === "table" ? textOf(row.table_body) || textOf(row.text) || caption
      : kind === "image" ? caption || textOf(row.text)
      : textOf(row.text) || textOf(row.list_items) || textOf(row.content) || caption;
    const assetPath = assetReference(row.img_path || row.image_path, sourcePath, files);
    if (!text && !assetPath && (kind === "paragraph" || kind === "heading")) continue;
    const bbox = normalizeBboxToUnit(row.bbox || row.box || row.coordinates);
    blocks.push(makeBlock(kind, text, pageNumber, blocks.length, {
      ...(kind === "heading" && Number.isInteger(Number(row.text_level)) && Number(row.text_level) > 0
        ? { headingLevel: Math.min(6, Number(row.text_level)) } : {}),
      ...(assetPath ? { assetPath } : {}), ...(caption ? { caption } : {}),
      ...(bbox ? { bbox } : {}), ...normalizePageSize(row),
    }));
  }
  const title = blocks.find((block) => block.kind === "heading" && block.text)?.text;
  return { blocks, ...(title ? { title } : {}), ...(pageCount ? { pageCount } : {}) };
}

// content_list merges paragraphs across pages but keeps only the first box.
// layout.json retains the explicit cross_page lines and their physical source
// in preproc_blocks. Match those exact lines; never infer a page from text order.
function addCrossPageBounds(result, bytes) {
  let layout;
  try { layout = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")); }
  catch { fail("Invalid MinerU layout JSON."); }
  if (!Array.isArray(layout?.pdf_info)) fail("Invalid MinerU layout pages.");
  const unitBox = (box, page) => {
    const bbox = normalizeBbox(box);
    const [width, height] = Array.isArray(page.page_size) ? page.page_size : [];
    if (!bbox || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0
      || bbox[2] > width || bbox[3] > height) return undefined;
    return bbox.map((value, index) => value / (index % 2 === 0 ? width : height));
  };
  const gridKey = (pageNumber, bbox) => JSON.stringify([pageNumber, ...bbox.map((value) => Math.floor(value * 1000 + 1e-7))]);
  const lineKey = (line) => JSON.stringify([line.bbox, line.spans?.map((span) => [span.type, span.content])]);
  const sources = new Map();
  for (const page of layout.pdf_info) {
    if (!Number.isInteger(page?.page_idx) || page.page_idx < 0 || page.page_idx >= 100000) fail("Invalid MinerU layout page index.");
    for (const block of page.preproc_blocks || []) {
      if (block.type !== "text") continue;
      for (const line of block.lines || []) {
        const bbox = unitBox(line.bbox, page);
        const key = lineKey(line);
        const entries = sources.get(key) || [];
        entries.push({ pageNumber: page.page_idx + 1, bbox });
        sources.set(key, entries);
      }
    }
  }
  const paragraphs = new Map();
  for (const block of result.blocks) {
    if (block.kind !== "paragraph" || !block.bbox) continue;
    const key = gridKey(block.pageNumber, block.bbox);
    const entries = paragraphs.get(key) || [];
    entries.push(block);
    paragraphs.set(key, entries);
  }
  for (const page of layout.pdf_info) {
    for (const paragraph of page.para_blocks || []) {
      if (paragraph.type !== "text") continue;
      const lines = (paragraph.lines || []).filter((line) => line.spans?.some((span) => span.cross_page === true));
      if (!lines.length) continue;
      const primary = unitBox(paragraph.bbox, page);
      const matches = primary ? paragraphs.get(gridKey(page.page_idx + 1, primary)) : undefined;
      if (matches?.length !== 1) fail("Invalid MinerU cross-page layout paragraph.");
      const block = matches[0];
      const bounds = new Map([[block.pageNumber, [...block.bbox]]]);
      for (const line of lines) {
        const candidates = (sources.get(lineKey(line)) || []).filter((source) => source.pageNumber > block.pageNumber);
        if (candidates.length !== 1 || !candidates[0].bbox) fail("Invalid MinerU cross-page layout source.");
        const source = candidates[0];
        const prior = bounds.get(source.pageNumber);
        bounds.set(source.pageNumber, prior
          ? [Math.min(prior[0], source.bbox[0]), Math.min(prior[1], source.bbox[1]), Math.max(prior[2], source.bbox[2]), Math.max(prior[3], source.bbox[3])]
          : source.bbox);
      }
      block.pageBounds = [...bounds].sort(([left], [right]) => left - right).map(([pageNumber, bbox]) => ({ pageNumber, bbox }));
      result.pageCount = Math.max(result.pageCount || 0, ...bounds.keys());
    }
  }
  return result;
}

function normalizeMarkdown(bytes, sourcePath, files) {
  const lines = bytes.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  function add(kind, text, extra) {
    if (blocks.length >= MAX_BLOCKS) fail("MinerU block count exceeds the limit.");
    blocks.push(makeBlock(kind, text, 1, blocks.length, extra));
  }
  function flush() {
    if (paragraph.length) add("paragraph", paragraph.join("\n").trim());
    paragraph = [];
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) { flush(); continue; }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { flush(); add("heading", heading[2], { headingLevel: heading[1].length }); continue; }
    const image = /^\s*!\[([^\]]*)\]\((\S+?)(?:\s+["'][^"']*["'])?\)\s*$/.exec(line);
    if (image) {
      flush();
      const assetPath = assetReference(image[2].replace(/^<|>$/g, ""), sourcePath, files);
      add("image", image[1], { ...(image[1] ? { caption: image[1] } : {}), ...(assetPath ? { assetPath } : {}) });
      continue;
    }
    if (line.trim().startsWith("$$")) {
      flush();
      const formula = [];
      const first = line.trim().slice(2);
      if (first.endsWith("$$")) formula.push(first.slice(0, -2));
      else {
        if (first) formula.push(first);
        while (++index < lines.length && !lines[index].trim().endsWith("$$")) formula.push(lines[index]);
        if (index < lines.length) formula.push(lines[index].trim().slice(0, -2));
      }
      add("equation", formula.join("\n").trim());
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?[\s:|-]+[-][\s:|-]*\|?\s*$/.test(lines[index + 1] || "")) {
      flush();
      const table = [line];
      while (index + 1 < lines.length && /^\s*\|/.test(lines[index + 1])) table.push(lines[++index]);
      add("table", table.join("\n"));
      continue;
    }
    // Keep fenced code intact so headings and images in code are not reinterpreted.
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      flush();
      const code = [line];
      while (++index < lines.length) {
        code.push(lines[index]);
        if (lines[index].trim().startsWith(fence[1])) break;
      }
      add("paragraph", code.join("\n"));
      continue;
    }
    paragraph.push(line);
  }
  flush();
  const title = blocks.find((block) => block.kind === "heading")?.text;
  // Markdown has no reliable page mapping; pageNumber=1 is the declared fallback.
  return { blocks, ...(title ? { title } : {}) };
}

/** Synchronous in-memory extraction; never writes files or invokes external programs.
 * @param {Bytes} buffer @returns {ExtractedResult}
 */
function extractResultZip(buffer) {
  const files = unzip(bytesView(buffer));
  const contentLists = [...files.keys()].filter((name) => /(?:^|\/)(?:[^/]+_)?content_list\.json$/i.test(name)).sort();
  if (contentLists.length > 1) fail("Ambiguous MinerU content lists in ZIP result.");
  let result;
  if (contentLists.length) {
    result = normalizeContentList(files.get(contentLists[0]), contentLists[0], files);
    const layouts = [...files.keys()].filter((name) => /(?:^|\/)(?:layout|[^/]+_middle)\.json$/i.test(name));
    if (layouts.length > 1) fail("Ambiguous MinerU layout JSON.");
    if (layouts.length) result = addCrossPageBounds(result, files.get(layouts[0]));
  } else {
    const markdown = [...files.keys()].filter((name) => /\.md$/i.test(name)).sort((a, b) => {
      const priority = (name) => /(?:^|\/)full\.md$/i.test(name) ? 0 : /(?:^|\/)markdown\.md$/i.test(name) ? 1 : 2;
      return priority(a) - priority(b) || a.localeCompare(b);
    });
    if (!markdown.length) fail("MinerU ZIP contains no content list or Markdown result.");
    result = normalizeMarkdown(files.get(markdown[0]), markdown[0], files);
  }
  const assets = [...files].filter(([name]) => IMAGE_EXTENSION.test(name)).map(([name, data]) => ({ path: name, data }));
  const positionedCount = result.blocks.filter((block) => block.bbox).length;
  const layoutStatus = positionedCount === 0 ? "unavailable" : positionedCount === result.blocks.length ? "available" : "partial";
  return { result: { ...result, layoutVersion: 2, layoutStatus }, assets };
}

module.exports = { requestUpload, uploadPdf, getBatch, downloadResultZip, extractResultZip };
