import type { DocumentBlock } from "./documentBlocks";

export const DEFAULT_GROUP_ID = "group-inbox";
export const DEFAULT_GROUP_NAME = "默认分组";
export const LEGACY_DEFAULT_GROUP_NAME = "待整理";

export interface LibraryGroup {
  id: string;
  name: string;
  createdAt: string;
}

export interface PaperRecord {
  recordType?: "reference";
  arxivId?: string;
  doi?: string;
  landingUrl?: string;
  abstract?: string;
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  sourcePath: string;
  importedAt: string;
  groupId: string;
  favorite: boolean;
  blocks: number;
  blockData?: DocumentBlock[];
  parseStatus?: "pending" | "ready" | "fallback";
  parseError?: string;
  originalId?: string;
  pageCount?: number;
  parseVersion?: number;
  mineruBatchId?: string;
  readingPosition?: { mode: "pdf" | "reading"; page: number; blockId?: string; regionId?: string };
  /** 原始文件真实格式。非 PDF 的演示文稿按幻灯片画布阅读，不要求坐标完整；
   * PPT 另存为的 PDF 保持 sourceFormat "pdf"，走原生 PDF 阅读面。 */
  sourceFormat?: "pdf" | "pptx" | "ppt";
  /** 识别为演示文稿时按 PPT 场景组织助手（解释 + 问答），左侧阅读面不变。 */
  readingMode?: "pdf" | "deck";
  /** 幻灯片画布宽高比（宽/高），deck 模式渲染用。 */
  deckAspect?: number;
}

export interface PaperMetadataPatch {
  title: string;
  authors: string[];
  year: number | null;
  groupId: string;
  doi?: string;
}

export function normalizeDoi(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim()
    .toLocaleLowerCase();
}

export function isValidDoi(value: string): boolean {
  const normalized = normalizeDoi(value);
  return Boolean(normalized) && normalized.length <= 300 && /^10\.\d{4,9}\/\S+$/i.test(normalized);
}

export function normalizeGroupName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function groupIdForName(name: string): string {
  return name === DEFAULT_GROUP_NAME || name === LEGACY_DEFAULT_GROUP_NAME ? DEFAULT_GROUP_ID : `group-${name}`;
}

export function createLibraryGroup(
  groups: LibraryGroup[],
  name: string,
  createdAt = new Date().toISOString(),
): { group: LibraryGroup; groups: LibraryGroup[] } {
  const requestedName = normalizeGroupName(name);
  const normalizedName = requestedName === LEGACY_DEFAULT_GROUP_NAME ? DEFAULT_GROUP_NAME : requestedName;
  if (!normalizedName) throw new Error("分组名称不能为空");
  const existing = groups.find((group) => group.name === normalizedName);
  if (existing) return { group: existing, groups };
  const group = { id: groupIdForName(normalizedName), name: normalizedName, createdAt };
  return { group, groups: [...groups, group] };
}

export function deleteLibraryGroup(
  groups: LibraryGroup[],
  papers: PaperRecord[],
  groupId: string,
): { groups: LibraryGroup[]; papers: PaperRecord[] } {
  if (groupId === DEFAULT_GROUP_ID) throw new Error("默认分组不能删除");
  if (!groups.some((group) => group.id === groupId)) throw new Error("分组不存在");
  return {
    groups: groups.filter((group) => group.id !== groupId),
    papers: papers.map((paper) => paper.groupId === groupId ? { ...paper, groupId: DEFAULT_GROUP_ID } : paper),
  };
}

export function updatePaperMetadata(
  papers: PaperRecord[],
  paperId: string,
  patch: PaperMetadataPatch,
): PaperRecord[] {
  return papers.map((paper) => {
    if (paper.id !== paperId) return paper;
    return {
      ...paper,
      title: patch.title.trim() || paper.title,
      authors: [...new Set(patch.authors.map((author) => author.trim()).filter(Boolean))],
      year: patch.year,
      groupId: patch.groupId,
      ...(patch.doi === undefined
        ? {}
        : normalizeDoi(patch.doi)
          ? { doi: normalizeDoi(patch.doi) }
          : { doi: undefined }),
    };
  });
}

export function removePaper(papers: PaperRecord[], paperId: string): PaperRecord[] {
  return papers.filter((paper) => paper.id !== paperId);
}

export function filterPapers(
  papers: PaperRecord[],
  query: string,
  groupNames: ReadonlyMap<string, string> = new Map(),
): PaperRecord[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return papers;

  return papers.filter((paper) => {
    const searchable = [
      paper.title,
      ...paper.authors,
      paper.doi ?? "",
      paper.year ? String(paper.year) : "",
      groupNames.get(paper.groupId) ?? "",
    ]
      .join(" ")
      .toLocaleLowerCase();
    return searchable.includes(normalizedQuery);
  });
}

export function sortPapers(papers: PaperRecord[]): PaperRecord[] {
  return [...papers].sort((left, right) => {
    if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
    return right.importedAt.localeCompare(left.importedAt);
  });
}
