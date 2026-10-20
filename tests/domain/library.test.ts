import { describe, expect, it } from "vitest";
import {
  createLibraryGroup,
  deleteLibraryGroup,
  DEFAULT_GROUP_ID,
  DEFAULT_GROUP_NAME,
  filterPapers,
  groupIdForName,
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
  it("uses 默认分组 as the default group name", () => {
    expect(DEFAULT_GROUP_NAME).toBe("默认分组");
    expect(groupIdForName("待整理")).toBe(DEFAULT_GROUP_ID);
  });

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

  it("moves papers to the default group when deleting a custom group", () => {
    const groups = [
      { id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, createdAt: "" },
      { id: "group-method", name: "研究方法", createdAt: "2026-10-16" },
    ];
    const papers = [
      { ...papersFixture("paper-a"), groupId: "group-method" },
      { ...papersFixture("paper-b"), groupId: DEFAULT_GROUP_ID },
    ];

    const result = deleteLibraryGroup(groups, papers, "group-method");

    expect(result.groups).toEqual([groups[0]]);
    expect(result.papers.map((paper) => [paper.id, paper.groupId])).toEqual([
      ["paper-a", DEFAULT_GROUP_ID],
      ["paper-b", DEFAULT_GROUP_ID],
    ]);
  });

  it("does not allow the default group to be deleted", () => {
    expect(() => deleteLibraryGroup([], [], DEFAULT_GROUP_ID)).toThrow("默认分组不能删除");
  });
});

function papersFixture(id: string): PaperRecord {
  return {
    id,
    title: id,
    authors: [],
    year: null,
    sourcePath: `local://${id}`,
    importedAt: "2026-09-29T08:00:00.000Z",
    groupId: DEFAULT_GROUP_ID,
    favorite: false,
    blocks: 0,
  };
}
