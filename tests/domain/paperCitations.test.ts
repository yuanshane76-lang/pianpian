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
    ])).toEqual([{ blockId: "block", label: "第 3 页", excerpt: "Actual source." }]);
    expect(currentPaperCitations({ ...paper, blockData: undefined }, [{ paperId: "paper", blockId: "block" }])).toEqual([]);
  });
});
