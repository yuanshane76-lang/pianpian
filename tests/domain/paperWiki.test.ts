import { describe, expect, it } from "vitest";
import type { DocumentBlock } from "../../src/domain/documentBlocks";
import {
  PAPER_WIKI_PROTOCOL_VERSION,
  WIKI_FULL_SECTION_ID,
  WIKI_PRELUDE_SECTION_ID,
  SECTION_MAX_ENTRIES,
  buildSectionSkeleton,
  buildWikiSectionCacheIdentity,
  buildWikiThreadCacheIdentity,
  computeWikiCoverage,
  flattenSections,
  getWikiSectionPath,
  getWikiSiblingTitles,
  getWikiSectionSignature,
  isNearDuplicateTitle,
  mergeDuplicateEntries,
  parseSectionEntries,
  parseThreadEntries,
  type WikiEntry,
} from "../../src/domain/paperWiki";

const blocks: DocumentBlock[] = [
  { id: "p001-b001", pageNumber: 1, order: 0, kind: "paragraph", text: "Abstract text." },
  { id: "p001-b002", pageNumber: 1, order: 1, kind: "heading", text: "1 Introduction", headingLevel: 1 },
  { id: "p001-b003", pageNumber: 1, order: 2, kind: "paragraph", text: "We study X." },
  { id: "p002-b001", pageNumber: 2, order: 3, kind: "heading", text: "2 Method", headingLevel: 1 },
  { id: "p002-b002", pageNumber: 2, order: 4, kind: "paragraph", text: "Step one uses Y." },
  { id: "p002-b003", pageNumber: 2, order: 5, kind: "heading", text: "2.1 Data", headingLevel: 2 },
  { id: "p002-b004", pageNumber: 2, order: 6, kind: "paragraph", text: "The dataset is Z." },
];

describe("section skeleton from local headings", () => {
  it("nests sections by heading level and assigns content to the deepest section", () => {
    const sections = buildSectionSkeleton(blocks);
    expect(sections.map((section) => section.id)).toEqual([WIKI_PRELUDE_SECTION_ID, "p001-b002", "p002-b001"]);
    expect(sections[0]).toMatchObject({ title: "开篇", headingBlockId: null, blockIds: ["p001-b001"] });
    expect(sections[1]).toMatchObject({ title: "1 Introduction", headingBlockId: "p001-b002", pageNumber: 1, blockIds: ["p001-b003"] });
    expect(sections[2].blockIds).toEqual(["p002-b002"]);
    expect(sections[2].children[0]).toMatchObject({ id: "p002-b003", title: "2.1 Data", blockIds: ["p002-b004"] });
    expect(flattenSections(sections).map((section) => section.id)).toEqual([
      WIKI_PRELUDE_SECTION_ID, "p001-b002", "p002-b001", "p002-b003",
    ]);
  });

  it("falls back to one whole-paper section when no headings exist", () => {
    const sections = buildSectionSkeleton(blocks.filter((block) => block.kind !== "heading"));
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ id: WIKI_FULL_SECTION_ID, title: "全文", headingBlockId: null });
  });

  it("resolves heading levels with the shared fallback when MinerU omits them", () => {
    const sections = buildSectionSkeleton([
      { id: "h1", pageNumber: 1, order: 0, kind: "heading", text: "3.1 Data Preprocessing" },
      { id: "b1", pageNumber: 1, order: 1, kind: "paragraph", text: "Text." },
    ]);
    expect(sections[0].level).toBe(2);
  });

  it("computes section paths and sibling titles for the prompt context", () => {
    const sections = buildSectionSkeleton(blocks);
    expect(getWikiSectionPath(sections, "p002-b003")).toBe("2 Method / 2.1 Data");
    expect(getWikiSiblingTitles(sections, "p002-b003")).toEqual([]);
    expect(getWikiSiblingTitles(sections, "p001-b002")).toEqual(["开篇", "2 Method"]);
  });
});

describe("thread entry parsing", () => {
  it("resolves anchors against any block and reports stats", () => {
    const parsed = parseThreadEntries(JSON.stringify({
      title: "论文 X 的方法研究",
      entries: [
        { kind: "problem", title: "研究问题", statement: "解决 X", anchorBlockIds: ["p001-b003"] },
        { kind: "finding", title: "主要发现", anchorBlockIds: ["p002-b004", "p002-b004", "p001-b001"] },
      ],
    }), blocks);
    expect(parsed.title).toBe("论文 X 的方法研究");
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0].anchors[0]).toMatchObject({ blockId: "p001-b003", pageNumber: 1, quote: "We study X." });
    expect(parsed.entries[1].anchors.map((anchor) => anchor.blockId)).toEqual(["p002-b004", "p001-b001"]);
    expect(parsed.stats).toMatchObject({ total: 2, locatable: 2, droppedAnchors: 0 });
  });

  it("drops hallucinated block ids and rejects anchorless results", () => {
    const parsed = parseThreadEntries(JSON.stringify({
      entries: [
        { title: "真实条目", anchorBlockIds: ["p001-b003"] },
        { title: "幻觉条目", anchorBlockIds: ["p999-b999"] },
      ],
    }), blocks);
    expect(parsed.entries[1].locatable).toBe(false);
    expect(parsed.stats.droppedAnchors).toBe(1);
    expect(() => parseThreadEntries(JSON.stringify({ entries: [{ title: "全幻觉", anchorBlockIds: ["nope"] }] }), blocks))
      .toThrow(/没有给出可用的原文锚点/);
    expect(() => parseThreadEntries('{"entries":[]}', blocks)).toThrow(/没有返回论证主线条目/);
  });

  it("accepts fenced JSON and caps entries", () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({ title: `条目${index}`, anchorBlockIds: ["p001-b003"] }));
    const parsed = parseThreadEntries("```json\n" + JSON.stringify({ entries }) + "\n```", blocks);
    expect(parsed.entries).toHaveLength(8);
  });
});

describe("section entry parsing", () => {
  const sections = buildSectionSkeleton(blocks);
  const methodSub = flattenSections(sections).find((section) => section.id === "p002-b003")!;

  it("only accepts anchors inside the section and merges near-duplicate titles", () => {
    const parsed = parseSectionEntries(JSON.stringify({
      entries: [
        { kind: "concept", title: "数据集 Z", statement: "包含 Z 的数据", anchorBlockIds: ["p002-b004"] },
        { kind: "concept", title: "数据集Z", anchorBlockIds: ["p002-b004"] },
        { kind: "method", title: "越界引用", anchorBlockIds: ["p001-b003"] },
      ],
    }), methodSub, blocks);
    // 越界锚点的条目保留但不可定位（与“无锚点节点保留”的既有行为一致）。
    expect(parsed.entries.map((entry) => entry.title)).toEqual(["数据集 Z", "越界引用"]);
    expect(parsed.entries[1].locatable).toBe(false);
    expect(parsed.stats.mergedDuplicates).toBe(1);
    expect(parsed.stats.droppedAnchors).toBe(1);
    expect(parsed.entries[0].id).toBe("p002-b003:e1");
  });

  it("caps entries per section and rejects empty or fully unlocatable output", () => {
    const entries = Array.from({ length: SECTION_MAX_ENTRIES + 5 }, (_, index) => ({
      title: `条目 ${index}`, anchorBlockIds: ["p002-b004"],
    }));
    expect(parseSectionEntries(JSON.stringify({ entries }), methodSub, blocks).entries).toHaveLength(SECTION_MAX_ENTRIES);
    expect(() => parseSectionEntries('{"entries":[]}', methodSub, blocks)).toThrow(/没有返回本章节的条目/);
    expect(() => parseSectionEntries('{"entries":[{"title":"全越界","anchorBlockIds":["p001-b003"]}]}', methodSub, blocks))
      .toThrow(/本章节可用的原文锚点/);
  });
});

describe("local lint", () => {
  it("detects near-duplicate titles for Chinese and English text", () => {
    expect(isNearDuplicateTitle("数据集 Z 的构建", "数据集Z的构建")).toBe(true);
    expect(isNearDuplicateTitle("attention mechanism", "Attention Mechanism!")).toBe(true);
    expect(isNearDuplicateTitle("数据预处理", "实验结果分析")).toBe(false);
  });

  it("merges duplicates by unioning anchors but keeps distinct titles apart", () => {
    const base = (title: string, blockId: string, index: number): WikiEntry => ({
      id: `s:e${index}`, sectionId: "s", kind: "method", title,
      anchors: [{ blockId, pageNumber: 1, quote: "" }], locatable: true,
    });
    const { entries, merged } = mergeDuplicateEntries([
      base("模型训练", "b1", 1),
      base("模型  训练", "b2", 2),
      base("推理加速", "b3", 3),
    ]);
    expect(merged).toBe(1);
    expect(entries).toHaveLength(2);
    expect(entries[0].anchors.map((anchor) => anchor.blockId)).toEqual(["b1", "b2"]);
  });

  it("computes coverage over loaded sections only", () => {
    const sections = buildSectionSkeleton(blocks);
    const flat = flattenSections(sections);
    const coverage = computeWikiCoverage(
      { [flat[1].id]: [{ id: "e", sectionId: flat[1].id, kind: "method", title: "t", anchors: [{ blockId: "p001-b003", pageNumber: 1, quote: "" }], locatable: true }] },
      sections,
      blocks,
    );
    expect(coverage).toEqual({ covered: 1, total: 1 });
  });
});

describe("cache identities", () => {
  it("binds the thread identity to the document signature and protocol version", () => {
    const first = buildWikiThreadCacheIdentity({ paperId: "p1", serviceIdentity: "rev:a:m", documentSignature: "doc-a" });
    const second = buildWikiThreadCacheIdentity({ paperId: "p1", serviceIdentity: "rev:a:m", documentSignature: "doc-b" });
    expect(first.key).toContain("wiki-thread");
    expect(first.key).toContain(PAPER_WIKI_PROTOCOL_VERSION);
    expect(first.key).not.toBe(second.key);
    expect(first.scopeId).toBe("paper");
  });

  it("keys section caches by section id and section content signature", () => {
    const sections = buildSectionSkeleton(blocks);
    const methodSub = flattenSections(sections).find((section) => section.id === "p002-b003")!;
    const signature = getWikiSectionSignature(methodSub, blocks);
    const identity = buildWikiSectionCacheIdentity({ paperId: "p1", serviceIdentity: "rev:a:m", sectionId: methodSub.id, sectionSignature: signature });
    const other = buildWikiSectionCacheIdentity({ paperId: "p1", serviceIdentity: "rev:a:m", sectionId: "p001-b002", sectionSignature: signature });
    expect(identity.scopeId).toBe("p002-b003");
    expect(identity.key).toContain("wiki-section");
    expect(identity.key).not.toBe(other.key);
    const changed = buildWikiSectionCacheIdentity({ paperId: "p1", serviceIdentity: "rev:a:m", sectionId: methodSub.id, sectionSignature: "different" });
    expect(changed.key).not.toBe(identity.key);
  });
});
