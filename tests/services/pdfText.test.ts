import { describe, expect, it } from "vitest";
import { groupPdfTextItemsIntoLines } from "../../src/services/pdfText";

describe("PDF text item grouping", () => {
  it("joins items on the same baseline and respects explicit line endings", () => {
    const lines = groupPdfTextItemsIntoLines([
      {
        str: "大型语言",
        transform: [10, 0, 0, 10, 75, 500],
        width: 110,
        hasEOL: false,
      },
      {
        str: " 模型",
        transform: [10, 0, 0, 10, 185, 500],
        width: 30,
        hasEOL: true,
      },
      {
        str: "",
        transform: [10, 0, 0, 10, 75, 488],
        width: 0,
        hasEOL: true,
      },
      {
        str: "摘要",
        transform: [12, 0, 0, 12, 75, 470],
        width: 50,
        hasEOL: true,
      },
    ]);

    expect(lines).toEqual(["大型语言 模型", "摘要"]);
  });

  it("keeps a new line when the baseline changes", () => {
    const lines = groupPdfTextItemsIntoLines([
      {
        str: "第一行",
        transform: [10, 0, 0, 10, 75, 500],
        width: 50,
        hasEOL: false,
      },
      {
        str: "第二行",
        transform: [10, 0, 0, 10, 75, 488],
        width: 60,
        hasEOL: false,
      },
    ]);

    expect(lines).toEqual(["第一行", "第二行"]);
  });
});
