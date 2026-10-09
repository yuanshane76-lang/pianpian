import { getDesktopBridge } from "../platform/electron";

const DB_NAME = "zhiyan-original-files";

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("pdfs");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("无法打开本地文件存储"));
  });
}

export async function saveOriginalPdf(name: string, data: ArrayBuffer): Promise<{ id: string; duplicate: boolean }> {
  const desktop = getDesktopBridge();
  if (desktop) return desktop.invoke("zhiyan:documents:save", { name, data: new Uint8Array(data) });
  const digest = await crypto.subtle.digest("SHA-256", data);
  const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("pdfs", "readwrite");
      const store = transaction.objectStore("pdfs");
      let duplicate = false;
      const existing = store.getKey(id);
      existing.onsuccess = () => { duplicate = existing.result !== undefined; store.put(data, id); };
      transaction.oncomplete = () => resolve({ id, duplicate });
      transaction.onerror = () => reject(new Error("无法保存原始 PDF，请检查磁盘空间"));
    });
  } finally { db.close(); }
}

export async function readOriginalPdf(id: string): Promise<ArrayBuffer> {
  const desktop = getDesktopBridge();
  if (desktop) {
    const bytes = await desktop.invoke<Uint8Array>("zhiyan:documents:read", id);
    return new Uint8Array(bytes).buffer;
  }
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("pdfs", "readonly").objectStore("pdfs").get(id);
      request.onsuccess = () => request.result ? resolve(request.result) : reject(new Error("原始 PDF 未保存，请重新导入"));
      request.onerror = () => reject(new Error("无法读取原始 PDF"));
    });
  } finally { db.close(); }
}

export async function deleteOriginalPdf(id: string): Promise<void> {
  const desktop = getDesktopBridge();
  if (desktop) {
    await desktop.invoke("zhiyan:documents:delete", id);
    return;
  }
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction("pdfs", "readwrite").objectStore("pdfs").delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error("无法删除原始 PDF"));
    });
  } finally { db.close(); }
}

export async function loadImageAsset(id: string, assetPath: string): Promise<string> {
  const desktop = getDesktopBridge();
  if (!desktop) throw new Error("解析图片仅在桌面版中可用");
  const bytes = await desktop.invoke<Uint8Array>("zhiyan:documents:asset", { id, path: assetPath });
  const data = new Uint8Array(bytes);
  let binary = "";
  for (let offset = 0; offset < data.length; offset += 8192) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 8192));
  }
  const extension = assetPath.split(".").pop()?.toLowerCase();
  const mime = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${btoa(binary)}`;
}
