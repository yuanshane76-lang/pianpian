import { describe, expect, it } from "vitest";
import { formatResearchCitation } from "../../src/domain/researchCitation";

describe("research citation", () => {
  it("formats a selected block as a plain-text prompt citation", () => {
    expect(formatResearchCitation({
      paperTitle: "Attention Paper",
      pageNumber: 3,
      blockId: "p003-b002",
      text: "The model uses attention.",
    })).toBe([
      "请结合下面这段原文回答：",
      "",
      "《Attention Paper》第 3 页 · 段落 p003-b002",
      "> The model uses attention.",
      "",
    ].join("\n"));
  });

  it("limits very long source text without interpreting markup", () => {
    const citation = formatResearchCitation({
      paperTitle: "Paper",
      pageNumber: 1,
      blockId: "b1",
      text: "<b>source</b>".repeat(1000),
    });
    expect(citation).toContain("> <b>source</b>");
    expect(citation.length).toBeLessThan(5000);
  });
});
