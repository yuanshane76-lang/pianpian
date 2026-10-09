import { describe, expect, it } from "vitest";
import {
  filterPapers,
  type PaperRecord,
} from "../../src/domain/library";

const papers: PaperRecord[] = [
  {
    id: "paper-a",
    title: "长上下文论文阅读方法",
    authors: ["张三"],
    year: 2023,
    sourcePath: "C:/文献/长上下文.pdf",
    importedAt: "2026-09-29T08:00:00.000Z",
    tags: ["研究方法", "论文阅读"],
    favorite: true,
    overview: null,
    blocks: 18,
  },
  {
    id: "paper-b",
    title: "多智能体实验研究",
    authors: ["李四"],
    year: 2024,
    sourcePath: "C:/文献/多智能体.pdf",
    importedAt: "2026-09-28T08:00:00.000Z",
    tags: ["研究方法", "实验分析"],
    favorite: false,
    overview: null,
    blocks: 42,
  },
];

describe("paper library filtering", () => {
  it("matches title, author, and tags without changing the source order", () => {
    expect(filterPapers(papers, "研究方法").map((paper) => paper.id)).toEqual([
      "paper-a",
      "paper-b",
    ]);
    expect(filterPapers(papers, "张三").map((paper) => paper.id)).toEqual([
      "paper-a",
    ]);
    expect(filterPapers(papers, "实验分析").map((paper) => paper.id)).toEqual([
      "paper-b",
    ]);
  });

  it("returns all papers for an empty query and none for an unknown query", () => {
    expect(filterPapers(papers, "")).toEqual(papers);
    expect(filterPapers(papers, "does-not-exist")).toEqual([]);
  });
});
