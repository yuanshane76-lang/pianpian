import { createDocumentBlocks, type DocumentBlock } from "../domain/documentBlocks";
import { sortPapers, type PaperRecord } from "../domain/library";
import { extractPdfBlocks, openPdf } from "./document";
import { saveOriginalPdf } from "./originalPdf";

const PAPERS_KEY = "zhiyan-workbench.papers.v1";
const LEGACY_PAPERS_KEYS = ["paperquay-rebuild.papers.v5"];

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function clearLegacyStorage(storage: Storage): void {
  for (const key of LEGACY_PAPERS_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // Storage cleanup is best effort.
    }
  }
}

function parseStoredPapers(value: string | null): PaperRecord[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as PaperRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function paperSourceKey(paper: PaperRecord): string {
  return paper.sourcePath || `${paper.title}:${paper.blocks}`;
}

function dedupePapers(papers: PaperRecord[]): PaperRecord[] {
  const bySource = new Map<string, PaperRecord>();
  for (const paper of papers) {
    const sourceKey = paperSourceKey(paper);
    const previous = bySource.get(sourceKey);
    if (!previous || paper.importedAt.localeCompare(previous.importedAt) > 0) {
      bySource.set(sourceKey, paper);
    }
  }
  return [...bySource.values()];
}

export function loadPapers(): PaperRecord[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    clearLegacyStorage(storage);
    return sortPapers(dedupePapers(parseStoredPapers(storage.getItem(PAPERS_KEY))).map((paper) => {
      if (paper.parseVersion === 2 || !paper.blockData?.length) return paper;
      const pages = [...new Set(paper.blockData.map((block) => block.pageNumber))].map((pageNumber) => ({
        pageNumber, lines: paper.blockData!.filter((block) => block.pageNumber === pageNumber).map((block) => block.text),
      }));
      const blockData = createDocumentBlocks(pages);
      return { ...paper, blockData, blocks: blockData.length, parseVersion: 2 };
    }));
  } catch {
    return [];
  }
}

export function savePapers(papers: PaperRecord[]): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(PAPERS_KEY, JSON.stringify(sortPapers(dedupePapers(papers))));
    return true;
  } catch (error) {
    console.warn("无法持久化论文库，当前会话仍可继续使用。", error);
    return false;
  }
}

function createPaperId(name: string, size: number, lastModified: number, contentHash: string): string {
  return `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${size}-${lastModified}-${contentHash.slice(-16)}`;
}

function hashBytes(data: ArrayBuffer): string {
  let hash = 1469598103934665603n;
  for (const byte of new Uint8Array(data)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash.toString(16).padStart(16, "0");
}

async function createFileFingerprint(file: File, data: ArrayBuffer): Promise<string> {
  const metadata = `${file.name}:${file.size}:${file.lastModified}`;
  if (!globalThis.crypto?.subtle) return `${metadata}:${hashBytes(data)}`;

  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  const contentHash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${metadata}:${contentHash}`;
}

export async function importPdfFile(file: File): Promise<PaperRecord> {
  const data = await file.arrayBuffer();
  const fingerprint = await createFileFingerprint(file, data);
  let blocks: DocumentBlock[];
  let parseStatus: PaperRecord["parseStatus"] = "ready";
  let parseError: string | undefined;
  try {
    blocks = await extractPdfBlocks(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知解析错误";
    parseStatus = "fallback";
    parseError = message;
    blocks = createDocumentBlocks([
      {
        pageNumber: 1,
        lines: [
          `无法解析 PDF 文本：${file.name}`,
          `解析器错误：${message}`,
          "请检查文件是否损坏，或稍后接入 MinerU 结构化解析。",
        ],
      },
    ]);
  }

  return {
    id: createPaperId(file.name, file.size, file.lastModified, fingerprint),
    title: file.name.replace(/\.pdf$/i, ""),
    authors: [],
    year: null,
    sourcePath: `local://${fingerprint}`,
    importedAt: new Date().toISOString(),
    tags: ["待整理"],
    favorite: false,
    blocks: blocks.length,
    blockData: blocks,
    parseStatus,
    parseError,
  };
}

export async function preparePdfFile(file: File): Promise<{ paper: PaperRecord; data: ArrayBuffer; duplicate: boolean }> {
  if (file.size > 100 * 1024 * 1024) throw new Error("PDF 文件不能超过 100 MB");
  const data = await file.arrayBuffer();
  const document = await openPdf(data);
  try {
    const metadata = await document.getMetadata();
    const info = metadata.info as { Title?: string };
    const title = info.Title?.trim();
    const saved = await saveOriginalPdf(file.name, data);
    return {
      data,
      duplicate: saved.duplicate,
      paper: {
        id: saved.id, originalId: saved.id, sourcePath: `local://${saved.id}`,
        title: title && title.length > 4 && !/^(untitled|microsoft|latex)/i.test(title) ? title : file.name.replace(/\.pdf$/i, "").replaceAll("_", " "),
        authors: [], year: null, importedAt: new Date().toISOString(), tags: ["待整理"],
        favorite: false, blocks: 0, blockData: [], pageCount: document.numPages,
        parseStatus: "pending", parseVersion: 2, readingPosition: { mode: "pdf", page: 1 },
      },
    };
  } finally { await document.destroy(); }
}
