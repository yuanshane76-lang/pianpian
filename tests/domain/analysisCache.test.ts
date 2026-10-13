import { describe, expect, it } from "vitest";
import {
  buildAnalysisCacheKey,
  buildParagraphCacheIdentity,
  getCachedAnalysis,
  setCachedAnalysis,
  type AnalysisCacheEntry,
} from "../../src/domain/analysis";
import { getDocumentBlockSignature, getDocumentContentSignature, type DocumentBlock } from "../../src/domain/documentBlocks";

describe("analysis cache", () => {
  it("shares paragraph cache identities between individual and bundled requests", () => {
    const block: DocumentBlock = { id: "block", kind: "paragraph", pageNumber: 1, order: 0, text: "Attention selects useful features." };
    const signature = getDocumentBlockSignature(block);
    const content = getDocumentContentSignature(block);
    expect(buildParagraphCacheIdentity("paper", block, "translate", "service", "document")).toEqual({
      paperId: "paper", scopeId: `block:${signature}`, operation: "translate",
      sourceSignature: `service:${signature}`, key: `paper::block:${signature}::translate::service:${signature}`,
    });
    expect(buildParagraphCacheIdentity("paper", block, "explain", "service", "document").scopeId).toBe(`block:${signature}`);
    expect(buildParagraphCacheIdentity("paper", block, "insight", "service", "document").sourceSignature).toBe(`service:document:${signature}`);
    const vocabulary = buildParagraphCacheIdentity("paper", block, "vocabulary", "service", "document");
    expect(vocabulary.scopeId).toBe(content);
    expect(vocabulary.sourceSignature).toBe(`service:paragraph-v1:${content}`);
    expect(buildParagraphCacheIdentity("paper", { ...block, bbox: [.1, .1, .9, .2] }, "vocabulary", "service", "changed-document")).toEqual(vocabulary);
  });

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
