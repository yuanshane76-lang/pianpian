import type { DocumentBlock } from "./documentBlocks";
import { getDocumentContentSignature } from "./documentBlocks";
import type { AcademicTerm } from "./vocabulary";

export interface WordbookSource {
  paperId: string;
  paperTitle: string;
  blockId: string;
  pageNumber: number;
  contentSignature: string;
  example: string;
}
export interface WordbookEntry {
  id: string;
  term: string;
  translation: string;
  definition: string;
  sources: WordbookSource[];
  mastered: boolean;
  addedAt: string;
}

export function resolveWordbookSourceBlock(blocks: DocumentBlock[], source: WordbookSource): DocumentBlock | null {
  const exact = blocks.find((block) => block.id === source.blockId);
  if (exact && getDocumentContentSignature(exact) === source.contentSignature) return exact;
  const matches = blocks.filter((block) => getDocumentContentSignature(block) === source.contentSignature);
  if (matches.length === 1) return matches[0];
  const pageMatches = matches.filter((block) => block.pageNumber === source.pageNumber);
  return pageMatches.length === 1 ? pageMatches[0] : null;
}

export function academicTermKey(term: string): string {
  return term.trim().toLowerCase().split(/[\s\-\u00ad\u2010-\u2015]+/u).join(" ");
}

export function addWordbookTerm(entries: WordbookEntry[], term: AcademicTerm, source: WordbookSource): WordbookEntry[] {
  const id = academicTermKey(term.term);
  const existing = entries.find((entry) => entry.id === id);
  if (!existing) return [{ id, term: term.term, translation: term.translation, definition: term.definition,
    sources: [{ ...source }], mastered: false, addedAt: new Date().toISOString() }, ...entries];
  if (existing.sources.some((item) => item.paperId === source.paperId &&
      item.blockId === source.blockId && item.contentSignature === source.contentSignature)) return entries;
  return entries.map((entry) => entry.id === id ? { ...entry, sources: [...entry.sources, { ...source }] } : entry);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("单词表数据损坏");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("单词表数据损坏");
  return value;
}
export function parseWordbook(raw: string): WordbookEntry[] {
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("单词表数据损坏");
  const entries = data.map((value): WordbookEntry => {
    const entry = record(value);
    const term = text(entry.term, 100);
    const id = text(entry.id, 100);
    if (id !== academicTermKey(term) || typeof entry.mastered !== "boolean" ||
        !Array.isArray(entry.sources) || !entry.sources.length) throw new Error("单词表数据损坏");
    const addedAt = text(entry.addedAt, 100);
    if (!Number.isFinite(Date.parse(addedAt))) throw new Error("单词表数据损坏");
    return { id, term, translation: text(entry.translation, 160), definition: text(entry.definition, 1000),
      mastered: entry.mastered, addedAt, sources: entry.sources.map((value): WordbookSource => {
        const source = record(value);
        if (!Number.isInteger(source.pageNumber) || Number(source.pageNumber) < 1) throw new Error("单词表数据损坏");
        return { paperId: text(source.paperId), paperTitle: text(source.paperTitle, 5000), blockId: text(source.blockId),
          pageNumber: Number(source.pageNumber), contentSignature: text(source.contentSignature), example: text(source.example, 20000) };
      }) };
  });
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error("单词表数据损坏");
  return entries;
}
