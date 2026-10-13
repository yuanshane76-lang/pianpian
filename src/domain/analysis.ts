import { getDocumentBlockSignature, getDocumentContentSignature, type DocumentBlock } from "./documentBlocks";

export type AnalysisOperation = "translate" | "explain" | "qa" | "insight" | "guide" | "chart" | "vocabulary";
export type ParagraphOperation = "translate" | "explain" | "insight" | "vocabulary";

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
): Omit<AnalysisCacheEntry, "value" | "createdAt"> {
  const signature = getDocumentBlockSignature(block);
  const contentSignature = getDocumentContentSignature(block);
  const scopeId = operation === "vocabulary" ? contentSignature : operation === "insight" ? block.id : `${block.id}:${signature}`;
  const sourceSignature = operation === "vocabulary" ? `${serviceIdentity}:paragraph-v1:${contentSignature}`
    : operation === "insight" ? `${serviceIdentity}:${documentSignature}:${signature}`
    : `${serviceIdentity}:${signature}`;
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
