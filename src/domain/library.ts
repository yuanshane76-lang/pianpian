import type { DocumentBlock } from "./documentBlocks";

export interface PaperRecord {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  sourcePath: string;
  importedAt: string;
  tags: string[];
  favorite: boolean;
  overview: string | null;
  blocks: number;
  blockData?: DocumentBlock[];
  parseStatus?: "pending" | "ready" | "fallback";
  parseError?: string;
  originalId?: string;
  pageCount?: number;
  parseVersion?: number;
  mineruBatchId?: string;
  readingPosition?: { mode: "pdf" | "reading"; page: number; blockId?: string };
}

export interface PaperMetadataPatch {
  title: string;
  authors: string[];
  year: number | null;
  tags: string[];
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
      tags: [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))],
    };
  });
}

export function removePaper(papers: PaperRecord[], paperId: string): PaperRecord[] {
  return papers.filter((paper) => paper.id !== paperId);
}

export function filterPapers(papers: PaperRecord[], query: string): PaperRecord[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return papers;

  return papers.filter((paper) => {
    const searchable = [
      paper.title,
      ...paper.authors,
      ...paper.tags,
      paper.year ? String(paper.year) : "",
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
