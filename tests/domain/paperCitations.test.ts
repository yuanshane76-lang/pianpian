import { describe, expect, it } from "vitest";
import { currentPaperCitations } from "../../src/domain/paperCitations";
import type { PaperRecord } from "../../src/domain/library";
const paper: PaperRecord = { id: "paper", title: "论文", authors: [], year: null,
  sourcePath: "local://paper", importedAt: "2026-10-14", groupId: "group-inbox", favorite: false, blocks: 1,
  blockData: [{ id: "block", kind: "paragraph", pageNumber: 3, order: 0, text: "Actual source." }] };

describe("current paper references", () => {
  it("keeps only verified block identities, drops foreign and nonexistent sources, and deduplicates", () => {
    expect(currentPaperCitations(paper, [
      { paperId: "foreign", blockId: "block" }, { paperId: "paper", blockId: "missing" },
      { paperId: "paper", blockId: "block", pageNumber: 99, label: "forged" },
      { paperId: "paper", blockId: "block" }, null, {},
    ])).toEqual([{ blockId: "block" }]);
    expect(currentPaperCitations({ ...paper, blockData: undefined }, [{ paperId: "paper", blockId: "block" }])).toEqual([]);
  });

  it("keeps different blocks on the same page distinct without using page numbers as identities", () => {
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
      { blockId: "first" },
      { blockId: "second" },
      { blockId: "third" },
    ]);
  });
});
