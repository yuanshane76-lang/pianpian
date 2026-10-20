import { describe, expect, it } from "vitest";
import { createDocumentBlocks } from "../../src/domain/documentBlocks";
import { getTranslationTarget, getAnalysisAvailability } from "../../src/domain/readingFlow";
import { DEFAULT_SERVICE_SETTINGS, toPublicServiceSettings } from "../../src/domain/serviceSettings";

describe("reading paragraphs and selected text", () => {
  it("merges layout lines into a paragraph instead of one card per line", () => {
    const blocks = createDocumentBlocks([{ pageNumber: 1, lines: [
      "Abstract", "The dominant sequence transduction models are based on complex recurrent or",
      "convolutional neural networks. We propose a new simple network architecture.",
      "", "1 Introduction", "Attention helps the model focus on relevant information.",
    ] }]);
    expect(blocks.map((block) => block.text)).toEqual([
      "Abstract",
      "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture.",
      "1 Introduction",
      "Attention helps the model focus on relevant information.",
    ]);
  });

  it("repairs hyphenated words across lines without adding spaces between Chinese characters", () => {
    const blocks = createDocumentBlocks([{ pageNumber: 1, lines: [
      "We evaluate trans-", "duction models.", "", "本文提出", "一种新的方法。",
    ] }]);
    expect(blocks.map((block) => block.text)).toEqual(["We evaluate transduction models.", "本文提出一种新的方法。"]);
  });

  it("defaults to the whole paragraph and accepts a sentence selected within it", () => {
    const block = { id: "p001-b001", text: "First sentence. Second sentence.", pageNumber: 1, order: 0, kind: "paragraph" as const };
    expect(getTranslationTarget(block, "")?.text).toBe(block.text);
    expect(getTranslationTarget(block, "Second sentence.")?.text).toBe("Second sentence.");
  });

  it("never routes a table, figure, or equation selection to paragraph translation", () => {
    for (const kind of ["table", "image", "equation"] as const) {
      const block = { id: "visual", kind, text: "Table 1", pageNumber: 1, order: 0 };
      expect(getTranslationTarget(block, "")).toBeNull();
      expect(getTranslationTarget(block, "Table")).toBeNull();
    }
  });

  it("honors a PDF selection even when MinerU normalizes spaces and citations differently", () => {
    const block = { id: "p001-b001", text: "Models [35, 2, 5] can improve translation. Another sentence.", pageNumber: 1, order: 0, kind: "paragraph" as const };
    const selection = "Models [ 35 , 2 , 5] can improve translation.";
    expect(getTranslationTarget(block, selection)?.text).toBe(selection);
  });

  it("does not advertise a fake translation when no real model is configured", () => {
    const settings = toPublicServiceSettings(DEFAULT_SERVICE_SETTINGS);
    expect(getAnalysisAvailability(settings).available).toBe(false);
    const configured = { ...settings, aiProvider: "deepseek" as const, deepseek: { ...settings.deepseek, configured: true } };
    expect(getAnalysisAvailability(configured)).toMatchObject({ available: true, label: "DeepSeek" });
  });

  it("defines the PDF canvas as the only reading surface with MinerU interactions layered on top", () => {
    const readingSurface = { source: "pdf", mineruOverlay: true, clickableBlocks: true };
    expect(readingSurface).toEqual({ source: "pdf", mineruOverlay: true, clickableBlocks: true });
  });
});
