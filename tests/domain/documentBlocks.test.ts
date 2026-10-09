import { describe, expect, it } from "vitest";
import {
  createDocumentBlocks,
  getDocumentBlockSignature,
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
    expect(blocks.map((block) => block.text)).toEqual([
      "摘要",
      "本文提出一种实用方法。",
      "2. 方法",
      "我们在三个数据集上评估方法。",
    ]);
    expect(blocks[2].pageNumber).toBe(2);
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
