import type { DocumentBlock } from "./documentBlocks";

export const DEFAULT_GROUP_ID = "group-inbox";
export const DEFAULT_GROUP_NAME = "待整理";

export interface LibraryGroup {
  id: string;
  name: string;
  createdAt: string;
}

export interface PaperRecord {
  recordType?: "reference";
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
}

export interface PaperMetadataPatch {
  title: string;
  authors: string[];
  year: number | null;
  groupId: string;
}

export function normalizeGroupName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function groupIdForName(name: string): string {
  return name === DEFAULT_GROUP_NAME ? DEFAULT_GROUP_ID : `group-${name}`;
}

export function createLibraryGroup(
  groups: LibraryGroup[],
  name: string,
  createdAt = new Date().toISOString(),
): { group: LibraryGroup; groups: LibraryGroup[] } {
  const normalizedName = normalizeGroupName(name);
  if (!normalizedName) throw new Error("分组名称不能为空");
  const existing = groups.find((group) => group.name === normalizedName);
  if (existing) return { group: existing, groups };
  const group = { id: groupIdForName(normalizedName), name: normalizedName, createdAt };
  return { group, groups: [...groups, group] };
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
