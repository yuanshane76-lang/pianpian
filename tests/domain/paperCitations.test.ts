import { describe, expect, it } from "vitest";
import { currentPaperCitations } from "../../src/domain/paperCitations";
import type { PaperRecord } from "../../src/domain/library";
const paper: PaperRecord = { id: "paper", title: "论文", authors: [], year: null,
  sourcePath: "local://paper", importedAt: "2026-10-14", tags: [], favorite: false, blocks: 1,
  blockData: [{ id: "block", kind: "paragraph", pageNumber: 3, order: 0, text: "Actual source." }] };

describe("current paper references", () => {
  it("uses current source text and page, drops foreign and nonexistent sources, and deduplicates", () => {
    expect(currentPaperCitations(paper, [
      { paperId: "foreign", blockId: "block" }, { paperId: "paper", blockId: "missing" },
      { paperId: "paper", blockId: "block", pageNumber: 99, label: "forged" },
      { paperId: "paper", blockId: "block" }, null, {},
    ])).toEqual([{ blockId: "block", label: "引用 1", pageLabel: "第 3 页", inlineLabel: "[1]", excerpt: "Actual source." }]);
    expect(currentPaperCitations({ ...paper, blockData: undefined }, [{ paperId: "paper", blockId: "block" }])).toEqual([]);
  });

  it("keeps same-page sources distinct with citation numbers", () => {
    const sourcePaper = { ...paper, blockData: [
      { id: "first", kind: "paragraph" as const, pageNumber: 1, order: 0, text: "First source." },
      { id: "second", kind: "paragraph" as const, pageNumber: 1, order: 1, text: "Second source." },
      { id: "third", kind: "paragraph" as const, pageNumber: 3, order: 2, text: "Third source." },
    ] };
    expect(currentPaperCitations(sourcePaper, [
      { paperId: "paper", blockId: "first" },
      { paperId: "paper", blockId: "second" },
      { paperId: "paper", blockId: "third" },
    ])).toEqual([
      { blockId: "first", label: "引用 1", pageLabel: "第 1 页", inlineLabel: "[1]", excerpt: "First source." },
      { blockId: "second", label: "引用 2", pageLabel: "第 1 页", inlineLabel: "[2]", excerpt: "Second source." },
      { blockId: "third", label: "引用 3", pageLabel: "第 3 页", inlineLabel: "[3]", excerpt: "Third source." },
    ]);
  });
});
