import { describe, expect, it } from "vitest";
import {
  createDocumentBlocks,
  getDocumentBlockSignature,
  getDocumentOutline,
  type DocumentBlock,
  type ExtractedPage,
} from "../../src/domain/documentBlocks";

describe("document blocks", () => {
  it("keeps page and line order stable while classifying headings", () => {
    const pages: ExtractedPage[] = [
      {
        pageNumber: 2,
        lines: ["2. 方法", "我们在三个数据集上评估方法。"],
      },
      {
        pageNumber: 1,
        lines: ["摘要", "本文提出一种实用方法。"],
      },
    ];

    const blocks = createDocumentBlocks(pages);

    expect(blocks.map((block) => block.id)).toEqual([
      "p001-b001",
      "p001-b002",
      "p002-b001",
      "p002-b002",
    ]);
    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "paragraph",
    ]);
    expect(blocks.map((block) => block.headingLevel)).toEqual([1, undefined, 1, undefined]);
    expect(blocks.map((block) => block.text)).toEqual([
      "摘要",
      "本文提出一种实用方法。",
      "2. 方法",
      "我们在三个数据集上评估方法。",
    ]);
    expect(blocks[2].pageNumber).toBe(2);
  });

  it("derives nested heading levels from numbered headings", () => {
    const blocks = createDocumentBlocks([{
      pageNumber: 1,
      lines: ["1. 方法", "1.1 数据集", "1.1.1 训练设置", "正文"],
    }]);

    expect(blocks.filter((block) => block.kind === "heading").map((block) => ({
      text: block.text,
      headingLevel: block.headingLevel,
    }))).toEqual([
      { text: "1. 方法", headingLevel: 1 },
      { text: "1.1 数据集", headingLevel: 2 },
      { text: "1.1.1 训练设置", headingLevel: 3 },
    ]);
  });

  it("uses parser levels and supports older cached headings without valid level metadata", () => {
    const heading = { id: "heading", kind: "heading", pageNumber: 1, order: 0, text: "1.2 Dataset" } as DocumentBlock;
    const blocks = [
      { ...heading, headingLevel: 3 },
      { ...heading, id: "legacy" },
      { ...heading, id: "invalid", headingLevel: 0 },
      { ...heading, id: "unnumbered", text: "Acknowledgments" },
      { ...heading, id: "body", kind: "paragraph" },
    ] as DocumentBlock[];
    expect(getDocumentOutline(blocks).map(({ block, level }) => [block.id, level])).toEqual([
      ["heading", 3], ["legacy", 2], ["invalid", 2], ["unnumbered", 1],
    ]);
    expect(getDocumentBlockSignature(heading)).toBe(getDocumentBlockSignature({ ...heading, headingLevel: 3 } as DocumentBlock));
  });

  it("derives a content signature that changes when source text changes", () => {
    const first = getDocumentBlockSignature({
      id: "p001-b001",
      pageNumber: 1,
      kind: "paragraph",
      text: "一段简短的内容。",
    });
    const second = getDocumentBlockSignature({
      id: "p001-b001",
      pageNumber: 1,
      kind: "paragraph",
      text: "一段修改后的内容。",
    });

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[a-f0-9]{16}$/);
  });
});
