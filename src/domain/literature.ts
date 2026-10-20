import { DEFAULT_GROUP_ID, normalizeDoi, type PaperRecord } from "./library";

export interface LiteraturePaper {
  candidateId?: string;
  arxivId?: string;
  title: string;
  authors: string[];
  year: number | null;
  doi?: string;
  landingUrl?: string;
  abstract?: string;
  source?: string;
}

function matchesLiteraturePaper(paper: PaperRecord, item: LiteraturePaper, doi: string): boolean {
  const normalizedSource = (value = "") => value.trim().replace(/\/$/, "").toLocaleLowerCase();
  if (item.arxivId && paper.arxivId) return paper.arxivId.toLocaleLowerCase() === item.arxivId.toLocaleLowerCase();
  if (doi) return normalizeDoi(paper.doi) === doi || normalizeDoi(paper.sourcePath) === doi;
  if (item.landingUrl) return [paper.landingUrl, paper.sourcePath]
    .some((source) => normalizedSource(source) === normalizedSource(item.landingUrl))
    || paper.title.trim().toLocaleLowerCase() === item.title.trim().toLocaleLowerCase();
  return paper.title.trim().toLocaleLowerCase() === item.title.trim().toLocaleLowerCase();
}

export function addLiteraturePaper(papers: PaperRecord[], item: LiteraturePaper, now = new Date().toISOString()): {
  papers: PaperRecord[];
  id: string;
  duplicate: boolean;
} {
  const title = item.title.trim();
  if (!title) throw new Error("论文标题不能为空");
  const doi = normalizeDoi(item.doi || (/^https?:\/\/(?:dx\.)?doi\.org\//i.test(item.landingUrl || "") ? item.landingUrl : ""));
  const existing = papers.find((paper) => matchesLiteraturePaper(paper, item, doi));
  if (existing) return { papers, id: existing.id, duplicate: true };
  const id = crypto.randomUUID();
  const record: PaperRecord = {
    id, title, authors: item.authors, year: item.year,
    sourcePath: item.landingUrl || (doi ? `https://doi.org/${doi}` : `literature://${id}`),
    arxivId: item.arxivId, doi: doi || undefined, landingUrl: item.landingUrl, abstract: item.abstract,
    importedAt: now, groupId: DEFAULT_GROUP_ID, favorite: false, blocks: 0,
    recordType: "reference", blockData: [], parseVersion: 2,
  };
  return { papers: [record, ...papers], id, duplicate: false };
}

export function upgradeLiteraturePaperWithPdf(
  papers: PaperRecord[],
  item: LiteraturePaper,
  prepared: PaperRecord,
): { papers: PaperRecord[]; id: string; duplicate: boolean } {
  if (!prepared.originalId) throw new Error("已准备的论文缺少原始 PDF 身份");
  const sameDocument = papers.find((paper) => paper.originalId === prepared.originalId);
  const doi = normalizeDoi(item.doi || (/^https?:\/\/(?:dx\.)?doi\.org\//i.test(item.landingUrl || "") ? item.landingUrl : ""));
  const references = papers.filter((paper) => !paper.originalId && matchesLiteraturePaper(paper, item, doi));
  if (sameDocument) {
    const updated = {
      ...sameDocument,
      title: item.title.trim() || sameDocument.title,
      authors: item.authors,
      year: item.year,
      arxivId: item.arxivId || sameDocument.arxivId,
      doi: doi || item.doi || sameDocument.doi,
      landingUrl: item.landingUrl || sameDocument.landingUrl,
      abstract: item.abstract || sameDocument.abstract,
    };
    return {
      papers: papers.filter((paper) => !references.includes(paper))
        .map((paper) => paper.id === sameDocument.id ? updated : paper),
      id: sameDocument.id,
      duplicate: true,
    };
  }

  // A different content hash is a different original, including another arXiv version.
  const existing = references[0];
  const upgraded: PaperRecord = {
    ...existing,
    ...prepared,
    id: existing?.id ?? prepared.id,
    title: item.title.trim() || prepared.title,
    authors: item.authors,
    year: item.year,
    doi: doi || item.doi || prepared.doi,
    arxivId: item.arxivId || prepared.arxivId,
    landingUrl: item.landingUrl || prepared.landingUrl,
    abstract: item.abstract || prepared.abstract,
    importedAt: existing?.importedAt || prepared.importedAt,
    groupId: existing?.groupId || prepared.groupId,
    favorite: existing?.favorite ?? prepared.favorite,
    readingPosition: existing?.readingPosition || prepared.readingPosition,
    recordType: undefined,
  };
  return {
    papers: existing
      ? papers.filter((paper) => !references.includes(paper) || paper.id === existing.id)
        .map((paper) => paper.id === existing.id ? upgraded : paper)
      : [upgraded, ...papers],
    id: upgraded.id,
    duplicate: false,
  };
}
