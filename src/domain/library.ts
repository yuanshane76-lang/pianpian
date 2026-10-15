import type { DocumentBlock } from "./documentBlocks";

const MAX_DOI = 500;

/** Accepts a bare DOI, a `doi:` prefix or a doi.org URL; returns a lowercase bare DOI. */
export function normalizeDoi(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .slice(0, MAX_DOI)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim()
    .toLocaleLowerCase();
}

export function isValidDoi(value: unknown): boolean {
  return /^10\.\d{4,9}\/\S+$/.test(normalizeDoi(value));
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
  tags: string[];
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
  tags: string[];
  /** `undefined` keeps the stored DOI, an empty string clears it. */
  doi?: string;
}

export function updatePaperMetadata(
  papers: PaperRecord[],
  paperId: string,
  patch: PaperMetadataPatch,
): PaperRecord[] {
  return papers.map((paper) => {
    if (paper.id !== paperId) return paper;
    const next: PaperRecord = {
      ...paper,
      title: patch.title.trim() || paper.title,
      authors: [...new Set(patch.authors.map((author) => author.trim()).filter(Boolean))],
      year: patch.year,
      tags: [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))],
    };
    const doi = patch.doi === undefined ? paper.doi : normalizeDoi(patch.doi) || undefined;
    if (doi) next.doi = doi;
    else delete next.doi;
    return next;
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
