import { describe, expect, it } from "vitest";
import {
  buildAnalysisCacheKey,
  getCachedAnalysis,
  setCachedAnalysis,
  type AnalysisCacheEntry,
} from "../../src/domain/analysis";

describe("analysis cache", () => {
  it("hits only when the source signature and operation are unchanged", () => {
    const cache = new Map<string, AnalysisCacheEntry>();
    const key = buildAnalysisCacheKey("paper-a", "block-1", "translate", "source-v1");
    const entry: AnalysisCacheEntry = {
      key,
      paperId: "paper-a",
      scopeId: "block-1",
      operation: "translate",
      sourceSignature: "source-v1",
      value: "这是译文",
      createdAt: "2026-09-29T08:00:00.000Z",
    };

    setCachedAnalysis(cache, entry);

    expect(getCachedAnalysis(cache, key)?.value).toBe("这是译文");
    expect(
      getCachedAnalysis(
        cache,
        buildAnalysisCacheKey("paper-a", "block-1", "translate", "source-v2"),
      ),
    ).toBeNull();
  });
});
