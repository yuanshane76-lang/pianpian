import { normalizeDoi, type PaperRecord } from "./library";

export interface LiteraturePaper {
  title: string;
  authors: string[];
  year: number | null;
  doi?: string;
  landingUrl?: string;
  abstract?: string;
  source?: string;
}

export function addLiteraturePaper(papers: PaperRecord[], item: LiteraturePaper, now = new Date().toISOString()): {
  papers: PaperRecord[];
  id: string;
  duplicate: boolean;
} {
  const title = item.title.trim();
  if (!title) throw new Error("论文标题不能为空");
  const doi = normalizeDoi(item.doi || (/^https?:\/\/(?:dx\.)?doi\.org\//i.test(item.landingUrl || "") ? item.landingUrl : ""));
  const normalizedSource = (value = "") => value.trim().replace(/\/$/, "").toLocaleLowerCase();
  const existing = papers.find((paper) => doi
    ? normalizeDoi(paper.doi) === doi || normalizeDoi(paper.sourcePath) === doi
    : item.landingUrl && [paper.landingUrl, paper.sourcePath].some((source) => normalizedSource(source) === normalizedSource(item.landingUrl))
      || paper.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase());
  if (existing) return { papers, id: existing.id, duplicate: true };
  const id = crypto.randomUUID();
  const record: PaperRecord = {
    id, title, authors: item.authors, year: item.year,
    sourcePath: item.landingUrl || (doi ? `https://doi.org/${doi}` : `literature://${id}`),
    doi: doi || undefined, landingUrl: item.landingUrl, abstract: item.abstract,
    importedAt: now, tags: ["待获取全文"], favorite: false, blocks: 0,
    recordType: "reference", blockData: [], parseVersion: 2,
  };
  return { papers: [record, ...papers], id, duplicate: false };
}
