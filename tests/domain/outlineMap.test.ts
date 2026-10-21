import { describe, expect, it } from "vitest";
import type { DocumentBlock } from "../../src/domain/documentBlocks";
import {
  OUTLINE_MAX_DEPTH,
  OUTLINE_MAX_NODES,
  buildOutlineCacheIdentity,
  parseOutlineMap,
} from "../../src/domain/outlineMap";

const blocks: DocumentBlock[] = [
  { id: "p001-b001", pageNumber: 1, order: 0, kind: "heading", text: "Introduction", headingLevel: 1 },
  { id: "p001-b002", pageNumber: 1, order: 1, kind: "paragraph", text: "We study  the   problem of X." },
  { id: "p002-b001", pageNumber: 2, order: 2, kind: "paragraph", text: "Our method uses Y." },
];

const valid = JSON.stringify({
  title: "A Paper",
  nodes: [
    {
      id: "1",
      title: "研究问题",
      summary: "研究什么",
      kind: "problem",
      anchorBlockIds: ["p001-b002"],
      children: [{ title: "方法", kind: "method", anchorBlockIds: ["p002-b001"] }],
    },
  ],
});

describe("outline map parsing", () => {
  it("resolves block ids into page numbers and quotes", () => {
    const map = parseOutlineMap(valid, blocks);
    expect(map.title).toBe("A Paper");
    expect(map.nodes[0].anchors).toEqual([
      { blockId: "p001-b002", pageNumber: 1, quote: "We study the problem of X." },
    ]);
    expect(map.nodes[0].children[0]).toMatchObject({
      title: "方法",
      kind: "method",
      locatable: true,
      anchors: [{ blockId: "p002-b001", pageNumber: 2 }],
    });
    expect(map.stats).toEqual({ total: 2, locatable: 2, droppedAnchors: 0 });
  });

  it("accepts markdown-fenced JSON and JSON wrapped in prose", () => {
    expect(parseOutlineMap("```json\n" + valid + "\n```", blocks).nodes).toHaveLength(1);
    expect(parseOutlineMap("结果如下：\n" + valid + "\n希望有帮助。", blocks).nodes).toHaveLength(1);
  });

  it("accepts a bare array of nodes", () => {
    const array = JSON.stringify([{ title: "方法", anchorBlockIds: ["p002-b001"] }]);
    expect(parseOutlineMap(array, blocks).nodes[0].title).toBe("方法");
  });

  it("drops unknown block ids and keeps the node readable but unlocatable", () => {
    const map = parseOutlineMap(JSON.stringify({
      nodes: [
        { title: "真实节点", anchorBlockIds: ["p001-b002"] },
        { title: "幻觉节点", anchorBlockIds: ["p999-b999"] },
      ],
    }), blocks);
    expect(map.nodes[1].locatable).toBe(false);
    expect(map.nodes[1].anchors).toEqual([]);
    expect(map.stats.droppedAnchors).toBe(1);
  });

  it("dedupes and caps anchors at two per node", () => {
    const map = parseOutlineMap(JSON.stringify({
      nodes: [{ title: "节点", anchorBlockIds: ["p001-b002", "p001-b002", "p002-b001", "p001-b001"] }],
    }), blocks);
    expect(map.nodes[0].anchors.map((anchor) => anchor.blockId)).toEqual(["p001-b002", "p002-b001"]);
  });

  it("caps the tree depth", () => {
    let leaf: Record<string, unknown> = { title: "第3层", anchorBlockIds: ["p001-b002"] };
    for (let index = 0; index < 3; index += 1) {
      leaf = { title: "上层", anchorBlockIds: ["p001-b002"], children: [leaf] };
    }
    const map = parseOutlineMap(JSON.stringify({ nodes: [leaf] }), blocks);
    let depth = 0;
    let cursor = map.nodes[0];
    while (cursor.children.length) {
      cursor = cursor.children[0];
      depth += 1;
    }
    expect(depth).toBe(OUTLINE_MAX_DEPTH - 1);
  });

  it("caps the total node count", () => {
    const nodes = Array.from({ length: OUTLINE_MAX_NODES + 10 }, (_, index) => ({
      title: `节点 ${index}`,
      anchorBlockIds: ["p001-b002"],
    }));
    const map = parseOutlineMap(JSON.stringify({ nodes }), blocks);
    expect(map.stats.total).toBe(OUTLINE_MAX_NODES);
    expect(map.nodes).toHaveLength(OUTLINE_MAX_NODES);
  });

  it("rejects unparseable, empty and anchorless results", () => {
    expect(() => parseOutlineMap("这不是 JSON", blocks)).toThrow(/无法解析/);
    expect(() => parseOutlineMap('{"nodes":[]}', blocks)).toThrow(/没有返回可用的大纲节点/);
    expect(() => parseOutlineMap('{"nodes":[{"title":"只有一个","anchorBlockIds":["nope"]}]}', blocks))
      .toThrow(/没有给出可用的原文锚点/);
  });

  it("builds a cache identity that follows the document signature", () => {
    const first = buildOutlineCacheIdentity({ paperId: "paper-1", serviceIdentity: "deepseek:flash", documentSignature: "doc-a" });
    const second = buildOutlineCacheIdentity({ paperId: "paper-1", serviceIdentity: "deepseek:flash", documentSignature: "doc-b" });
    expect(first.key).toContain("outline");
    expect(first.key).toContain("outline-v1");
    expect(first.key).not.toBe(second.key);
    expect(first.scopeId).toBe("paper");
  });
});
