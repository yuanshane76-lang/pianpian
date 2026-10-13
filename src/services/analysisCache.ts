import type { AnalysisCacheEntry } from "../domain/analysis";

const ANALYSIS_CACHE_KEY = "zhiyan-workbench.analysis.v1";
const LEGACY_ANALYSIS_CACHE_KEYS = ["paperquay-rebuild.analysis.v1"];

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function clearLegacyStorage(storage: Storage): void {
  for (const key of LEGACY_ANALYSIS_CACHE_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // Storage cleanup is best effort.
    }
  }
}

function parseEntries(value: string | null): AnalysisCacheEntry[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is AnalysisCacheEntry =>
            Boolean(
              entry &&
                typeof entry.key === "string" &&
                typeof entry.paperId === "string" &&
                typeof entry.scopeId === "string" &&
                typeof entry.operation === "string" &&
                entry.operation !== "overview" &&
                typeof entry.sourceSignature === "string" &&
                typeof entry.value === "string" &&
                typeof entry.createdAt === "string",
            ),
        )
      : [];
  } catch {
    return [];
  }
}

export function loadAnalysisCache(): Map<string, AnalysisCacheEntry> {
  const storage = getStorage();
  if (!storage) return new Map();
  try {
    clearLegacyStorage(storage);
    return new Map(parseEntries(storage.getItem(ANALYSIS_CACHE_KEY)).map((entry) => [entry.key, entry]));
  } catch {
    return new Map();
  }
}

export function saveAnalysisCache(cache: Map<string, AnalysisCacheEntry>): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify([...cache.values()]));
  } catch (error) {
    console.warn("无法持久化分析缓存，当前会话仍可继续使用。", error);
  }
}
