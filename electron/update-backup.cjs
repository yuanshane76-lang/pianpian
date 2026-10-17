const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const STORAGE_KEYS = ["papers", "groups", "wordbook", "analysis", "appearance"].map((key) => `zhiyan-workbench.${key}.v1`);

function validateStorageSnapshot(storage) {
  if (!storage || typeof storage !== "object" || Array.isArray(storage)) throw new Error("无法读取本地记录，更新已停止。" );
  let total = 0;
  for (const [key, value] of Object.entries(storage)) {
    if (!STORAGE_KEYS.includes(key) || typeof value !== "string") throw new Error("本地记录备份格式无效。" );
    total += Buffer.byteLength(value);
    if (total > 32 * 1024 ** 2) throw new Error("本地记录过大，无法完成更新备份。" );
    try { JSON.parse(value); } catch { throw new Error("本地记录损坏，更新已停止。" ); }
  }
  return storage;
}

async function createUpdateBackup({ userData, storage, fromVersion, toVersion }) {
  validateStorageSnapshot(storage);
  const root = path.resolve(userData);
  const backupRoot = path.join(root, "update-backups");
  async function safe(target) {
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("备份路径无效");
    let current = root;
    for (const part of ["", ...relative.split(path.sep).filter(Boolean)]) {
      if (part) current = path.join(current, part);
      try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("备份路径不能包含链接"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  await safe(backupRoot);
  await fs.mkdir(backupRoot, { recursive: true });
  const directory = path.join(backupRoot, `${Date.now()}-${randomUUID()}`);
  await fs.mkdir(directory);
  try {
  const manifest = { schema: 1, complete: false, fromVersion, toVersion, createdAt: new Date().toISOString(), files: [] };
  let total = 0;
  async function copy(relative) {
    const source = path.join(root, relative), destination = path.join(directory, relative);
    await safe(source);
    let stat;
    try { stat = await fs.lstat(source); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (!stat.isFile() || stat.size > 32 * 1024 ** 2) throw new Error("备份文件无效或过大");
    total += stat.size;
    if (total > 256 * 1024 ** 2) throw new Error("关键数据备份超过 256 MB，请先整理数据。");
    const bytes = await fs.readFile(source);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
    manifest.files.push({ path: relative.replaceAll("\\", "/"), sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const storageBytes = Buffer.from(JSON.stringify(storage));
  await fs.writeFile(path.join(directory, "local-storage.json"), storageBytes, { flag: "wx", mode: 0o600 });
  manifest.files.push({ path: "local-storage.json", sha256: createHash("sha256").update(storageBytes).digest("hex") });
  await copy("service-settings.enc.json");
  await copy(path.join("research-history", "conversations.json"));
  const documentRoot = path.join(root, "documents");
  await safe(documentRoot);
  let documents;
  try { documents = await fs.readdir(documentRoot); } catch (error) { if (error.code !== "ENOENT") throw error; documents = []; }
  for (const id of documents) {
    if (!/^[a-f0-9]{64}$/.test(id)) continue;
    for (const file of ["parse.json", "task.json"]) await copy(path.join("documents", id, file));
  }
  manifest.complete = true;
  await fs.writeFile(path.join(directory, "backup.json"), JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
  return { directory };
  } catch (error) {
    // Only this attempt's new directory is owned here; never remove previous backups.
    const relative = path.relative(backupRoot, directory);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      await safe(directory);
      await fs.rm(directory, { recursive: true, force: true });
    }
    throw error;
  }
}
module.exports = { createUpdateBackup, validateStorageSnapshot, STORAGE_KEYS };
