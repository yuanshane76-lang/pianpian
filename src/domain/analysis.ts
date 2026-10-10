export type AnalysisOperation = "overview" | "translate" | "qa" | "insight" | "guide" | "chart" | "vocabulary";

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
