import { describe, expect, it } from "vitest";
import type { DocumentBlock } from "../../src/domain/documentBlocks";
import {
  WIKI_FULL_PART_ID,
  WIKI_MAX_PARTS,
  WIKI_PRELUDE_PART_ID,
  buildWikiParts,
  computeWikiCoverage,
  isNearDuplicateTitle,
  mergeDuplicateEntries,
  parsePartTree,
  parseWikiThread,
  type WikiEntry,
  type WikiPoint,
} from "../../src/domain/paperWiki";
import {
  branchIdsWithChildren,
  findOutlineNode,
  projectOutlineMap,
} from "../../src/domain/outlineMap";

const blocks: DocumentBlock[] = [
  { id: "p001-b001", pageNumber: 1, order: 0, kind: "paragraph", text: "Abstract: we study X and propose Y." },
  { id: "p001-b002", pageNumber: 1, order: 1, kind: "heading", text: "1 Introduction", headingLevel: 1 },
  { id: "p001-b003", pageNumber: 1, order: 2, kind: "paragraph", text: "We study the problem of X." },
  { id: "p002-b001", pageNumber: 2, order: 3, kind: "heading", text: "2 Method", headingLevel: 1 },
  { id: "p002-b002", pageNumber: 2, order: 4, kind: "paragraph", text: "Our method uses Y with attention." },
  { id: "p003-b001", pageNumber: 3, order: 5, kind: "heading", text: "References", headingLevel: 1 },
  { id: "p003-b002", pageNumber: 3, order: 6, kind: "paragraph", text: "Smith 2020. Jones 2021." },
];

const parts = buildWikiParts(blocks);

const threadEntry: WikiEntry = {
  id: "thread:e1",
  sectionId: "thread",
  kind: "problem",
  title: "研究问题",
  statement: "论文要解决 X 问题",
  anchors: [{ blockId: "p001-b003", pageNumber: 1, quote: "We study the problem of X." }],
  locatable: true,
};

const methodTree = parsePartTree(JSON.stringify({
  children: [
    {
      title: "注意力机制设计",
      statement: "用注意力加权特征",
      children: [
        { kind: "method", title: "注意力权重", statement: "按相关度加权", anchorBlockIds: ["p002-b002"] },
        { kind: "concept", title: "特征表示", anchorBlockIds: ["p002-b002"] },
      ],
    },
  ],
}), parts.find((part) => part.title === "2 Method")!, blocks);

describe("wiki parts from local chunking", () => {
  it("merges headings into few semantic parts and drops back matter", () => {
    expect(parts.map((part) => part.title)).toEqual(["开篇", "1 Introduction", "2 Method"]);
    expect(parts[0].id).toBe(WIKI_PRELUDE_PART_ID);
    expect(parts[0].blockIds).toEqual(["p001-b001"]);
    expect(parts[2].headings).toEqual([]);
    expect(parts.map((part) => part.id)).not.toContain("p003-b001"); // References 被过滤
  });

  it("falls back to one whole-paper part without headings", () => {
    const flat = buildWikiParts(blocks.filter((block) => block.kind !== "heading"));
    expect(flat).toHaveLength(1);
    expect(flat[0].id).toBe(WIKI_FULL_PART_ID);
    expect(flat[0].blockIds).toHaveLength(4);
  });

  it("caps the number of parts by merging the smallest neighbours", () => {
    const many: DocumentBlock[] = Array.from({ length: WIKI_MAX_PARTS + 6 }, (_, index) => ([
      { id: `h${index}`, pageNumber: index + 1, order: index * 2, kind: "heading" as const, text: `Sec ${index}`, headingLevel: 1 as const },
      { id: `b${index}`, pageNumber: index + 1, order: index * 2 + 1, kind: "paragraph" as const, text: `Content ${index} with details.` },
    ] as DocumentBlock[])).flat();
    const merged = buildWikiParts(many);
    expect(merged.length).toBeLessThanOrEqual(WIKI_MAX_PARTS);
    const totalBlocks = merged.reduce((sum, part) => sum + part.blockIds.length, 0);
    expect(totalBlocks).toBe((WIKI_MAX_PARTS + 6) * 2);
  });
});

describe("thread parsing (assembly)", () => {
  it("parses renames and thread entries with anchors", () => {
    const parsed = parseWikiThread(JSON.stringify({
      title: "论文 X 的方法研究",
      parts: [
        { id: WIKI_PRELUDE_PART_ID, title: "摘要与动机", summary: "介绍研究背景" },
        { id: "p001-b002", title: "问题定义" },
        { id: "不存在的id", title: "应被忽略" },
      ],
      thread: [
        { kind: "problem", title: "研究问题", statement: "解决 X", anchorBlockIds: ["p001-b003"] },
        { kind: "finding", title: "主要发现", anchorBlockIds: ["p002-b002", "p002-b002"] },
      ],
    }), blocks, parts.map((part) => part.id));
    expect(parsed.title).toBe("论文 X 的方法研究");
    expect(parsed.renames).toEqual({
      [WIKI_PRELUDE_PART_ID]: { title: "摘要与动机", summary: "介绍研究背景" },
      "p001-b002": { title: "问题定义" },
    });
    expect(parsed.thread).toHaveLength(2);
    expect(parsed.thread[1].anchors).toHaveLength(1);
    expect(parsed.stats).toMatchObject({ total: 2, locatable: 2 });
  });

  it("rejects empty thread and hallucinated anchors only", () => {
    expect(() => parseWikiThread(JSON.stringify({ thread: [] }), blocks, parts.map((part) => part.id)))
      .toThrow(/没有返回论证主线/);
    expect(() => parseWikiThread(JSON.stringify({ thread: [{ title: "全幻觉", anchorBlockIds: ["nope"] }] }), blocks, parts.map((part) => part.id)))
      .toThrow(/没有给出可用的原文锚点/);
  });
});

describe("part tree parsing", () => {
  it("builds two-level semantic nodes with part-scoped anchors", () => {
    const methodPart = parts.find((part) => part.title === "2 Method")!;
    expect(methodTree.tree.insights).toHaveLength(1);
    const insight = methodTree.tree.insights[0];
    expect(insight).toMatchObject({ title: "注意力机制设计", statement: "用注意力加权特征" });
    expect(insight.points[0]).toMatchObject({ id: `${methodPart.id}:i1:p1`, kind: "method", locatable: true });
    expect(insight.points[0].anchors[0]).toMatchObject({ blockId: "p002-b002", pageNumber: 2 });
    expect(methodTree.stats).toMatchObject({ total: 2, locatable: 2 });
  });

  it("drops out-of-part anchors and rejects fully unlocatable trees", () => {
    const methodPart = parts.find((part) => part.title === "2 Method")!;
    const leaked = parsePartTree(JSON.stringify({
      children: [{ title: "越界要点", children: [
        { kind: "method", title: "引用开篇", anchorBlockIds: ["p001-b003"] },
        { kind: "method", title: "本部分", anchorBlockIds: ["p002-b002"] },
      ] }],
    }), methodPart, blocks);
    expect(leaked.tree.insights[0].points[0].locatable).toBe(false);
    expect(leaked.stats.droppedAnchors).toBe(1);
    expect(() => parsePartTree(JSON.stringify({
      children: [{ title: "全越界", children: [{ kind: "method", title: "x", anchorBlockIds: ["p001-b003"] }] }],
    }), methodPart, blocks)).toThrow(/本部分可用的原文锚点/);
    expect(() => parsePartTree('{"children":[]}', methodPart, blocks)).toThrow(/没有返回可用的要点/);
  });

  it("caps insights and points per part", () => {
    const methodPart = parts.find((part) => part.title === "2 Method")!;
    const children = Array.from({ length: 10 }, (_, index) => ({
      title: `要点 ${index}`,
      children: Array.from({ length: 6 }, (_, sub) => ({
        kind: "method", title: `支撑 ${sub}`, anchorBlockIds: ["p002-b002"],
      })),
    }));
    const capped = parsePartTree(JSON.stringify({ children }), methodPart, blocks);
    expect(capped.tree.insights).toHaveLength(6);
    expect(capped.tree.insights[0].points).toHaveLength(4);
  });
});

describe("local lint and coverage", () => {
  it("detects near-duplicate titles and merges entries", () => {
    expect(isNearDuplicateTitle("数据集 Z 的构建", "数据集Z的构建")).toBe(true);
    const point = (title: string, blockId: string): WikiPoint => ({
      id: title, kind: "method", title,
      anchors: [{ blockId, pageNumber: 1, quote: "" }], locatable: true,
    });
    const { entries, merged } = mergeDuplicateEntries([point("模型训练", "b1"), point("模型  训练", "b2")]);
    expect(merged).toBe(1);
    expect(entries[0].anchors.map((anchor) => anchor.blockId)).toEqual(["b1", "b2"]);
  });

  it("computes coverage over generated parts only", () => {
    const methodPart = parts.find((part) => part.title === "2 Method")!;
    const coverage = computeWikiCoverage({ [methodPart.id]: methodTree.tree }, parts, blocks);
    expect(coverage).toEqual({ covered: 1, total: 1 });
    const empty = computeWikiCoverage({}, parts, blocks);
    expect(empty).toEqual({ covered: 0, total: 0 });
  });
});

describe("outline projection", () => {
  const preludePart = parts[0];
  const introPart = parts[1];
  const methodPart = parts[2];

  function project(overrides: Partial<Parameters<typeof projectOutlineMap>[0]> = {}) {
    return projectOutlineMap({
      paperTitle: "A Paper",
      parts,
      renames: { [methodPart.id]: { title: "方法设计", summary: "提出方法 Y" } },
      thread: [threadEntry],
      partTrees: { [methodPart.id]: methodTree.tree },
      partStates: {},
      coverage: { covered: 1, total: 1 },
      droppedAnchors: 0,
      mergedDuplicates: 0,
      ...overrides,
    });
  }

  it("projects a paper-title root with thread branch and renamed parts below", () => {
    const map = project();
    expect(map.title).toBe("A Paper");
    expect(map.nodes).toHaveLength(1);
    const rootNode = map.nodes[0];
    expect(rootNode).toMatchObject({ id: "paper-root", title: "A Paper", structural: true, locatable: false });
    expect(rootNode.children[0]).toMatchObject({ id: "thread-branch", title: "论证主线", structural: true });
    expect(rootNode.children[0].children[0]).toMatchObject({ id: "thread:e1", kind: "problem" });
    expect(rootNode.children[1]).toMatchObject({ id: WIKI_PRELUDE_PART_ID, title: "开篇", sectionState: "loading" });
    const method = rootNode.children.find((node) => node.id === methodPart.id)!;
    expect(method).toMatchObject({ title: "方法设计", summary: "提出方法 Y", structural: true });
    expect(method.anchors[0]).toMatchObject({ blockId: methodPart.headingBlockId });
    expect(method.children[0]).toMatchObject({ id: `${methodPart.id}:i1`, structural: true });
    expect(method.children[0].children[0]).toMatchObject({ id: `${methodPart.id}:i1:p1`, kind: "method", locatable: true });
  });

  it("prefers the assembly title over the file title for the root", () => {
    const map = project({ threadTitle: "论文 X 的方法研究" });
    expect(map.nodes[0].title).toBe("论文 X 的方法研究");
  });

  it("drops the thread branch when empty and counts stats over the tree", () => {
    const map = project({ thread: [] });
    expect(map.nodes[0].children[0].id).not.toBe("thread-branch");
    const full = project();
    // 根1+主线分支1+主线1+3部分+要点1+支撑点2 = 9；可定位 = 主线1 + 两个有标题的部分 + 支撑点2 = 5
    expect(full.stats.total).toBe(9);
    expect(full.stats.locatable).toBe(5);
    expect(full.stats.sectionsGenerated).toBe(1);
    expect(full.stats.sectionsTotal).toBe(3);
  });

  it("propagates part error states and finds nodes recursively", () => {
    const failed = project({ partStates: { [introPart.id]: { state: "error", error: "服务超时" } } });
    const node = findOutlineNode(failed.nodes, introPart.id)!;
    expect(node.sectionState).toBe("error");
    expect(node.sectionError).toBe("服务超时");
    const map = project();
    expect(findOutlineNode(map.nodes, `${methodPart.id}:i1:p1`)?.title).toBe("注意力权重");
    expect(findOutlineNode(map.nodes, "nope")).toBeNull();
  });

  it("lists branch nodes with children for default collapsing", () => {
    const map = project();
    expect(branchIdsWithChildren(map.nodes)).toEqual(["thread-branch", methodPart.id]);
  });

  it("uses prelude part without heading anchor as unlocatable structure", () => {
    const map = project();
    const prelude = findOutlineNode(map.nodes, preludePart.id)!;
    expect(prelude.locatable).toBe(false);
    expect(prelude.anchors).toEqual([]);
  });
});
