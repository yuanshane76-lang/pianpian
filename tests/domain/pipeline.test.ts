import { describe, expect, it } from "vitest";
import { pipelineStageLabel, selectInitialTranslationBlocks } from "../../src/domain/pipeline";

const block = (id: string, kind: "heading" | "paragraph", text: string) => ({
  id, kind, pageNumber: 1, order: Number(id.replace(/\D/g, "")) || 0, text,
});

describe("paper processing pipeline", () => {
  it("prioritizes abstract and introduction paragraphs for the first preview", () => {
    const blocks = [
      block("h1", "heading", "Title"),
      block("h2", "heading", "Abstract"),
      block("p1", "paragraph", "This is the abstract paragraph with enough content to translate first."),
      block("h3", "heading", "Introduction"),
      block("p2", "paragraph", "This is the introduction paragraph with enough content to translate next."),
      block("p3", "paragraph", "This is another introduction paragraph with enough content to translate."),
      block("p4", "paragraph", "This is a later paragraph with enough content to translate."),
    ];

    expect(selectInitialTranslationBlocks(blocks, 3).map((item) => item.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("returns a truthful status label for active MinerU processing", () => {
    expect(pipelineStageLabel({
      paperId: "paper", source: "local", stage: "mineru-processing",
      translatedCount: 2, queuedCount: 1, failedCount: 0, paused: false,
      mineruMessage: "已处理 4 / 15 页",
    })).toBe("已处理 4 / 15 页");
  });
});
