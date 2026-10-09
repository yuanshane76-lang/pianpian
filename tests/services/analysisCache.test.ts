import { afterEach, describe, expect, it } from "vitest";
import { loadAnalysisCache, saveAnalysisCache } from "../../src/services/analysisCache";

afterEach(() => {
  window.localStorage.clear();
});

describe("analysis cache persistence", () => {
  it("round-trips cache entries through local storage", () => {
    const cache = new Map([
      [
        "paper-a::block-1::translate::source-v1",
        {
          key: "paper-a::block-1::translate::source-v1",
          paperId: "paper-a",
          scopeId: "block-1",
          operation: "translate" as const,
          sourceSignature: "source-v1",
          value: "这是译文",
          createdAt: "2026-09-29T08:00:00.000Z",
        },
      ],
    ]);

    saveAnalysisCache(cache);

    expect(loadAnalysisCache().get("paper-a::block-1::translate::source-v1")?.value).toBe("这是译文");
  });

  it("only removes the known legacy cache key", () => {
    window.localStorage.setItem("paperquay-rebuild.analysis.v1", "[]");
    window.localStorage.setItem("paperquay-rebuild.other-feature", "keep");

    expect(loadAnalysisCache()).toEqual(new Map());
    expect(window.localStorage.getItem("paperquay-rebuild.analysis.v1")).toBeNull();
    expect(window.localStorage.getItem("paperquay-rebuild.other-feature")).toBe("keep");
  });
});
