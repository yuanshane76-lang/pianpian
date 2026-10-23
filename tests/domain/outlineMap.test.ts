import { describe, expect, it } from "vitest";
import type { DocumentBlock } from "../../src/domain/documentBlocks";
import { buildSectionSkeleton, type WikiEntry, type WikiSection } from "../../src/domain/paperWiki";
import {
  buildOutlineFocusPath,
  findOutlineNode,
  projectOutlineMap,
} from "../../src/domain/outlineMap";

const blocks: DocumentBlock[] = [
  { id: "p001-b001", pageNumber: 1, order: 0, kind: "heading", text: "Introduction", headingLevel: 1 },
  { id: "p001-b002", pageNumber: 1, order: 1, kind: "paragraph", text: "We study the problem of X." },
  { id: "p002-b001", pageNumber: 2, order: 2, kind: "heading", text: "2 Method", headingLevel: 1 },
  { id: "p002-b002", pageNumber: 2, order: 3, kind: "paragraph", text: "Our method uses Y." },
];

const sections = buildSectionSkeleton(blocks);

const threadEntries: WikiEntry[] = [
  {
    id: "thread:e1",
    sectionId: "thread",
    kind: "problem",
    title: "研究问题",
    statement: "论文要解决 X 问题",
    anchors: [{ blockId: "p001-b002", pageNumber: 1, quote: "We study the problem of X." }],
    locatable: true,
  },
];

const sectionEntries: Record<string, WikiEntry[]> = {
  "p002-b001": [
    {
      id: "p002-b001:e1",
      sectionId: "p002-b001",
      kind: "method",
      title: "方法 Y",
      anchors: [{ blockId: "p002-b002", pageNumber: 2, quote: "Our method uses Y." }],
      locatable: true,
    },
  ],
};

function project(overrides: Partial<Parameters<typeof projectOutlineMap>[0]> = {}) {
  return projectOutlineMap({
    paperTitle: "A Paper",
    sections,
    threadEntries,
    sectionEntries,
    sectionStates: {},
    coverage: { covered: 2, total: 2 },
    droppedAnchors: 0,
    mergedDuplicates: 0,
    ...overrides,
  });
}

describe("outline projection", () => {
  it("builds thread branch plus section nodes from the local skeleton", () => {
    const map = project();
    expect(map.title).toBe("A Paper");
    expect(map.nodes[0]).toMatchObject({ id: "thread-branch", title: "论证主线", structural: true });
    expect(map.nodes[0].children[0]).toMatchObject({ id: "thread:e1", kind: "problem", locatable: true });
    const methodSection = map.nodes.find((node) => node.id === "p002-b001")!;
    expect(methodSection).toMatchObject({ id: "p002-b001", kind: "section", structural: true, sectionId: "p002-b001" });
    expect(methodSection.anchors[0]).toMatchObject({ blockId: "p002-b001", pageNumber: 2 });
  });

  it("marks sections pending until their entries load, then nests entries under them", () => {
    const introSection = project().nodes.find((node) => node.id === "p001-b001")!;
    expect(introSection.sectionState).toBe("pending");
    const map = project({ sectionEntries: {} });
    expect(map.nodes.find((node) => node.id === "p002-b001")!.sectionState).toBe("pending");
    expect(map.stats.sectionsGenerated).toBe(0);
    expect(map.stats.sectionsTotal).toBe(2);

    const loaded = project();
    expect(loaded.nodes.find((node) => node.id === "p002-b001")!.sectionState).toBeUndefined();
    expect(loaded.nodes.find((node) => node.id === "p002-b001")!.children).toHaveLength(1);
    expect(loaded.stats.sectionsGenerated).toBe(1);
  });

  it("propagates loading and error section states", () => {
    const loading = project({ sectionStates: { "p001-b001": { state: "loading" } } });
    expect(loading.nodes.find((node) => node.id === "p001-b001")!.sectionState).toBe("loading");
    const failed = project({ sectionStates: { "p001-b001": { state: "error", error: "服务超时" } } });
    const node = failed.nodes.find((item) => item.id === "p001-b001")!;
    expect(node.sectionState).toBe("error");
    expect(node.sectionError).toBe("服务超时");
  });

  it("drops the thread branch when the model returned no thread entries", () => {
    const map = project({ threadEntries: [] });
    expect(map.nodes[0].id).not.toBe("thread-branch");
    expect(map.nodes.map((node) => node.id)).toEqual(["p001-b001", "p002-b001"]);
  });

  it("aggregates stats over the whole projected tree", () => {
    const map = project();
    // thread 分支 1 + 主线 1 + 章节 2 + 方法条目 1 = 5；可定位 = 主线1 + 章节2 + 条目1 = 4
    expect(map.stats.total).toBe(5);
    expect(map.stats.locatable).toBe(4);
    expect(map.stats.coveredBlocks).toBe(2);
    expect(map.stats.contentBlocks).toBe(2);
  });

  it("finds nodes recursively and builds the focus breadcrumb", () => {
    const map = project();
    expect(findOutlineNode(map.nodes, "thread:e1")?.title).toBe("研究问题");
    expect(findOutlineNode(map.nodes, "nope")).toBeNull();
    const sections2: WikiSection[] = buildSectionSkeleton([
      { id: "h1", pageNumber: 1, order: 0, kind: "heading", text: "3 方法", headingLevel: 1 },
      { id: "h2", pageNumber: 2, order: 1, kind: "heading", text: "3.1 数据", headingLevel: 2 },
      { id: "b1", pageNumber: 2, order: 2, kind: "paragraph", text: "Data." },
    ]);
    expect(buildOutlineFocusPath(sections2, "h2").map((crumb) => crumb.title)).toEqual(["总览", "3 方法", "3.1 数据"]);
    expect(buildOutlineFocusPath(sections2, null).map((crumb) => crumb.title)).toEqual(["总览"]);
  });
});
