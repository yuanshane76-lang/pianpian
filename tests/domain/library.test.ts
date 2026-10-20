import { describe, expect, it } from "vitest";
import {
  createLibraryGroup,
  filterPapers,
  isValidDoi,
  updatePaperMetadata,
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
    groupId: "group-method",
    favorite: true,
    blocks: 18,
  },
  {
    id: "paper-b",
    title: "多智能体实验研究",
    authors: ["李四"],
    year: 2024,
    sourcePath: "C:/文献/多智能体.pdf",
    importedAt: "2026-09-28T08:00:00.000Z",
    groupId: "group-method",
    favorite: false,
    blocks: 42,
  },
];

describe("paper library filtering", () => {
  it("matches title and author without changing the source order", () => {
    expect(filterPapers(papers, "上下文").map((paper) => paper.id)).toEqual([
      "paper-a",
    ]);
    expect(filterPapers(papers, "张三").map((paper) => paper.id)).toEqual([
      "paper-a",
    ]);
  });

  it("returns all papers for an empty query and none for an unknown query", () => {
    expect(filterPapers(papers, "")).toEqual(papers);
    expect(filterPapers(papers, "does-not-exist")).toEqual([]);
  });

  it("matches a paper by its group name when the library supplies group names", () => {
    expect(filterPapers(papers, "方法", new Map([["group-method", "研究方法"]]))).toEqual([papers[0], papers[1]]);
  });
});

describe("paper groups", () => {
  it("creates a normalized group and reuses an existing name", () => {
    const first = createLibraryGroup([], "  实验分析  ", "2026-10-16T00:00:00.000Z");
    expect(first.group).toMatchObject({
      id: "group-实验分析",
      name: "实验分析",
      createdAt: "2026-10-16T00:00:00.000Z",
    });

    const duplicate = createLibraryGroup(first.groups, "实验分析");
    expect(duplicate.group).toEqual(first.group);
    expect(duplicate.groups).toHaveLength(1);
  });

  it("rejects an empty group name", () => {
    expect(() => createLibraryGroup([], " \n ")).toThrow("分组名称不能为空");
  });
});

describe("paper metadata editing", () => {
  const patch = (overrides: Partial<Parameters<typeof updatePaperMetadata>[2]> = {}) => ({
    title: papers[0].title, authors: papers[0].authors, year: papers[0].year, groupId: papers[0].groupId, ...overrides,
  });

  it("stores a normalized DOI and keeps it when a later edit omits the field", () => {
    const withDoi = updatePaperMetadata(papers, "paper-a", patch({ doi: "https://doi.org/10.1145/3592433" }));
    expect(withDoi[0].doi).toBe("10.1145/3592433");

    const later = updatePaperMetadata(withDoi, "paper-a", patch({ title: "改过的标题" }));
    expect(later[0].doi).toBe("10.1145/3592433");
    expect(later[0].title).toBe("改过的标题");
  });

  it("clears the DOI when the user empties the field", () => {
    const withDoi = updatePaperMetadata(papers, "paper-b", patch({ doi: "10.1/x" }));
    expect(withDoi[1].doi).toBe("10.1/x");
    const cleared = updatePaperMetadata(withDoi, "paper-b", patch({ doi: "   " }));
    expect(cleared[1].doi).toBeUndefined();
  });

  it("leaves other papers untouched", () => {
    const result = updatePaperMetadata(papers, "paper-a", patch({ doi: "10.1/only-a" }));
    expect(result[1]).toBe(papers[1]);
  });

  it("recognizes well-formed DOIs and rejects free text", () => {
    expect(isValidDoi("10.1145/3592433")).toBe(true);
    expect(isValidDoi("https://doi.org/10.1145/3592433")).toBe(true);
    expect(isValidDoi("DOI: 10.1145/3592433")).toBe(true);
    expect(isValidDoi("not-a-doi")).toBe(false);
    expect(isValidDoi("10.1145")).toBe(false);
    expect(isValidDoi("")).toBe(false);
  });
});
