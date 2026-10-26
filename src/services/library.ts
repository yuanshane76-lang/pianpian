import { createDocumentBlocks, type DocumentBlock } from "../domain/documentBlocks";
import {
  DEFAULT_GROUP_ID,
  DEFAULT_GROUP_NAME,
  groupIdForName,
  LEGACY_DEFAULT_GROUP_NAME,
  normalizeGroupName,
  sortPapers,
  type LibraryGroup,
  type PaperRecord,
} from "../domain/library";
import { extractPdfBlocks, openPdf } from "./document";
import { saveOriginalPdf } from "./originalPdf";

const PAPERS_KEY = "zhiyan-workbench.papers.v1";
const GROUPS_KEY = "zhiyan-workbench.groups.v1";
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

interface LegacyStoredPaper extends Omit<PaperRecord, "groupId"> {
  groupId?: string;
  tags?: string[];
}

function parseStoredPapers(value: string | null): LegacyStoredPaper[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as LegacyStoredPaper[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseStoredGroups(value: string | null): LibraryGroup[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as LibraryGroup[];
    return Array.isArray(parsed)
      ? parsed.filter((group) => group && typeof group.id === "string" && typeof group.name === "string")
      : [];
  } catch {
    return [];
  }
}

function getLegacyGroupNames(papers: LegacyStoredPaper[]): string[] {
  return papers
    .flatMap((paper) => Array.isArray(paper.tags) ? [paper.tags[0]] : [])
    .map((name) => normalizeGroupName(name || ""))
    .filter(Boolean);
}

function normalizeGroups(groups: LibraryGroup[], legacyNames: string[] = []): LibraryGroup[] {
  const normalized: LibraryGroup[] = [];
  const seen = new Set<string>();
  const add = (group: LibraryGroup) => {
    const name = normalizeGroupName(group.name);
    if (!name || seen.has(name)) return;
    seen.add(name);
    normalized.push({ id: group.id || groupIdForName(name), name, createdAt: group.createdAt || "" });
  };
  const storedDefault = groups.find((group) => group.id === DEFAULT_GROUP_ID)
    ?? groups.find((group) => group.name === DEFAULT_GROUP_NAME || group.name === LEGACY_DEFAULT_GROUP_NAME);
  add({ id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, createdAt: storedDefault?.createdAt || "" });
  for (const group of groups) {
    if (group.id === DEFAULT_GROUP_ID || group.name === DEFAULT_GROUP_NAME || group.name === LEGACY_DEFAULT_GROUP_NAME) continue;
    add(group);
  }
  for (const name of legacyNames) add({ id: groupIdForName(name), name, createdAt: "" });
  return normalized;
}

export function loadGroups(): LibraryGroup[] {
  const storage = getStorage();
  if (!storage) return [{ id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, createdAt: "" }];
  try {
    const legacyPapers = parseStoredPapers(storage.getItem(PAPERS_KEY));
    const groups = normalizeGroups(parseStoredGroups(storage.getItem(GROUPS_KEY)), getLegacyGroupNames(legacyPapers));
    if (storage.getItem(GROUPS_KEY) !== JSON.stringify(groups)) storage.setItem(GROUPS_KEY, JSON.stringify(groups));
    return groups;
  } catch {
    return [{ id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, createdAt: "" }];
  }
}

export function saveGroups(groups: LibraryGroup[]): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const papers = parseStoredPapers(storage.getItem(PAPERS_KEY));
    const normalized = normalizeGroups(groups, getLegacyGroupNames(papers));
    if (storage.getItem(GROUPS_KEY) !== JSON.stringify(normalized)) {
      storage.setItem(GROUPS_KEY, JSON.stringify(normalized));
    }
    return true;
  } catch (error) {
    console.warn("无法持久化分组，当前会话仍可继续使用。", error);
    return false;
  }
}

export function saveLibraryGroupsAndPapers(groups: LibraryGroup[], papers: PaperRecord[]): boolean {
  const storage = getStorage();
  if (!storage) return false;
  let previousGroups: string | null = null;
  let previousPapers: string | null = null;
  let hasSnapshots = false;
  try {
    previousGroups = storage.getItem(GROUPS_KEY);
    previousPapers = storage.getItem(PAPERS_KEY);
    hasSnapshots = true;
    storage.setItem(PAPERS_KEY, JSON.stringify(sortPapers(dedupePapers(papers))));
    const normalizedGroups = normalizeGroups(groups);
    if (previousGroups !== JSON.stringify(normalizedGroups)) {
      storage.setItem(GROUPS_KEY, JSON.stringify(normalizedGroups));
    }
    return true;
  } catch (error) {
    if (hasSnapshots) {
      try {
        if (previousPapers === null) storage.removeItem(PAPERS_KEY);
        else storage.setItem(PAPERS_KEY, previousPapers);
        if (previousGroups === null) storage.removeItem(GROUPS_KEY);
        else storage.setItem(GROUPS_KEY, previousGroups);
      } catch {
        // Best-effort rollback preserves the original records if either write fails.
      }
    }
    console.warn("无法同时持久化分组和论文归属，未应用删除操作。", error);
    return false;
  }
}

function paperSourceKey(paper: Pick<PaperRecord, "sourcePath" | "title" | "blocks">): string {
  return paper.sourcePath || `${paper.title}:${paper.blocks}`;
}

function dedupePapers<T extends Pick<PaperRecord, "sourcePath" | "title" | "blocks" | "importedAt">>(papers: T[]): T[] {
  const bySource = new Map<string, T>();
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
    const groups = loadGroups();
    const groupIds = new Set(groups.map((group) => group.id));
    const papers = dedupePapers(parseStoredPapers(storage.getItem(PAPERS_KEY))).map((paper) => {
      const legacyName = normalizeGroupName(paper.tags?.[0] || "");
      const groupId = paper.groupId && groupIds.has(paper.groupId)
        ? paper.groupId
        : legacyName ? groupIdForName(legacyName) : DEFAULT_GROUP_ID;
      const { tags: _legacyTags, ...withoutLegacyTags } = paper;
      const migratedPaper: PaperRecord = { ...withoutLegacyTags, groupId };
      if (paper.parseVersion === 2 || !paper.blockData?.length) return migratedPaper;
      const pages = [...new Set(paper.blockData.map((block) => block.pageNumber))].map((pageNumber) => ({
        pageNumber, lines: paper.blockData!.filter((block) => block.pageNumber === pageNumber).map((block) => block.text),
      }));
      const blockData = createDocumentBlocks(pages);
      return { ...migratedPaper, blockData, blocks: blockData.length, parseVersion: 2 };
    }).map((paper) => {
      if (paper.groupId) return paper;
      return { ...paper, groupId: DEFAULT_GROUP_ID };
    });
    const sorted = sortPapers(papers);
    const serialized = JSON.stringify(sorted);
    if (storage.getItem(PAPERS_KEY) !== serialized) storage.setItem(PAPERS_KEY, serialized);
    return sorted;
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
    groupId: DEFAULT_GROUP_ID,
    favorite: false,
    blocks: blocks.length,
    blockData: blocks,
    parseStatus,
    parseError,
  };
}

function importedTitle(file: File, pdfTitle?: string): string {
  if (pdfTitle && pdfTitle.length > 4 && !/^(untitled|microsoft|latex)/i.test(pdfTitle)) return pdfTitle;
  return file.name.replace(/\.(?:pdf|pptx?|ppt)$/i, "").replaceAll("_", " ");
}

/**
 * 幻灯片启发式：绝大多数页面为横版宽幅（宽高比 ≥ 1.2，如 16:9 / 4:3）即视为演示文稿。
 * 论文几乎总是纵版，个别横置图版页由占比阈值（≥ 75%）排除。
 */
export function looksLikeSlideDeck(sizes: Array<{ width: number; height: number }>): boolean {
  if (!sizes.length) return false;
  const landscape = sizes.filter(({ width, height }) => height > 0 && width / height >= 1.2);
  return landscape.length / sizes.length >= 0.75;
}

export async function prepareImportFile(
  file: File,
  savedOriginal?: { id: string; duplicate: boolean },
): Promise<{ paper: PaperRecord; data: ArrayBuffer; duplicate: boolean }> {
  if (file.size > 100 * 1024 * 1024) throw new Error("文件不能超过 100 MB");
  const isDeck = /\.(?:pptx|ppt)$/i.test(file.name);
  const data = await file.arrayBuffer();
  if (isDeck) {
    // 演示文稿：不做本地 PDF 解析，原件交给 MinerU 转换；标题取文件名。
    const saved = savedOriginal ?? await saveOriginalPdf(file.name, data);
    return {
      data,
      duplicate: saved.duplicate,
      paper: {
        id: saved.id, originalId: saved.id, sourcePath: `local://${saved.id}`,
        title: importedTitle(file),
        authors: [], year: null, importedAt: new Date().toISOString(), groupId: DEFAULT_GROUP_ID,
        favorite: false, blocks: 0, blockData: [],
        parseStatus: "pending", parseVersion: 2, readingPosition: { mode: "pdf", page: 1 },
        sourceFormat: "deck",
      },
    };
  }
  const document = await openPdf(data);
  try {
    const metadata = await document.getMetadata();
    const info = metadata.info as { Title?: string };
    const saved = savedOriginal ?? await saveOriginalPdf(file.name, data);
    // PPT 另存为 PDF 是常见导入来源：按页面横版占比识别为幻灯片，走 deck 阅读模式。
    const sample = Math.min(document.numPages, 10);
    const sizes: Array<{ width: number; height: number }> = [];
    for (let index = 1; index <= sample; index += 1) {
      const viewport = await (await document.getPage(index)).getViewport({ scale: 1 });
      sizes.push({ width: viewport.width, height: viewport.height });
    }
    return {
      data,
      duplicate: saved.duplicate,
      paper: {
        id: saved.id, originalId: saved.id, sourcePath: `local://${saved.id}`,
        title: importedTitle(file, info.Title?.trim()),
        authors: [], year: null, importedAt: new Date().toISOString(), groupId: DEFAULT_GROUP_ID,
        favorite: false, blocks: 0, blockData: [], pageCount: document.numPages,
        parseStatus: "pending", parseVersion: 2, readingPosition: { mode: "pdf", page: 1 },
        sourceFormat: looksLikeSlideDeck(sizes) ? "deck" : "pdf",
      },
    };
  } finally { await document.destroy(); }
}
