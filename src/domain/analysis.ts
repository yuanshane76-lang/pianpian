import { getDocumentBlockSignature, getDocumentContentSignature, type DocumentBlock } from "./documentBlocks";

export type AnalysisOperation = "translate" | "explain" | "qa" | "insight" | "guide" | "chart" | "equation" | "vocabulary" | "wiki-thread" | "wiki-section";
export type ParagraphOperation = "translate" | "explain" | "insight" | "vocabulary";
export type ParagraphReadingMode = "standard" | "grandma";

export interface AnalysisCacheEntry {
  key: string;
  paperId: string;
  scopeId: string;
  operation: AnalysisOperation;
  sourceSignature: string;
  value: string;
  createdAt: string;
}

export function buildAnalysisCacheKey(
  paperId: string,
  scopeId: string,
  operation: AnalysisOperation,
  sourceSignature: string,
): string {
  return [paperId, scopeId, operation, sourceSignature].join("::");
}

export function buildParagraphCacheIdentity(
  paperId: string,
  block: DocumentBlock,
  operation: ParagraphOperation,
  serviceIdentity: string,
  documentSignature: string,
  readingMode: ParagraphReadingMode = "standard",
): Omit<AnalysisCacheEntry, "value" | "createdAt"> {
  const signature = getDocumentBlockSignature(block);
  const contentSignature = getDocumentContentSignature(block);
  const scopeId = operation === "vocabulary" ? contentSignature : operation === "insight" ? block.id : `${block.id}:${signature}`;
  const modeSuffix = readingMode === "grandma" ? ":grandma" : "";
  const sourceSignature = operation === "vocabulary" ? `${serviceIdentity}:paragraph-v1:${contentSignature}${modeSuffix}`
    : operation === "insight" ? `${serviceIdentity}:${documentSignature}:${signature}${modeSuffix}`
    : `${serviceIdentity}:${signature}${modeSuffix}`;
  return { key: buildAnalysisCacheKey(paperId, scopeId, operation, sourceSignature), paperId, scopeId, operation, sourceSignature };
}

export function getCachedAnalysis(
  cache: Map<string, AnalysisCacheEntry>,
  key: string,
): AnalysisCacheEntry | null {
  return cache.get(key) ?? null;
}

export function setCachedAnalysis(
  cache: Map<string, AnalysisCacheEntry>,
  entry: AnalysisCacheEntry,
): void {
  cache.set(entry.key, entry);
}
