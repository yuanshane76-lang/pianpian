import { describe, expect, it } from "vitest";
import type { DocumentBlock } from "../../src/domain/documentBlocks";
import {
  buildWikiKnowledgeCacheIdentity,
  parseKnowledgeEntries,
} from "../../src/domain/paperWiki";
import {
  buildLibraryWikiIndex,
  ingestPaperWikiPages,
  libraryWikiPageId,
  parseLibraryWikiPages,
  type LibraryWikiPage,
} from "../../src/domain/libraryWiki";

const anchor = (blockId: string, pageNumber = 1) => ({ blockId, pageNumber, quote: "quote" });

function ingest(pages: LibraryWikiPage[], paperId: string, title: string, kind: "concept" | "method" = "concept",
  options: { statement?: string; signature?: string; blockIds?: string[] } = {}) {
  return ingestPaperWikiPages(pages, {
    paperId,
    paperTitle: `论文 ${paperId}`,
    contentSignature: options.signature ?? `sig-${paperId}`,
    points: [{
      kind,
      title,
      ...(options.statement ? { statement: options.statement } : {}),
      anchors: (options.blockIds ?? ["b1"]).map((blockId) => anchor(blockId)),
    }],
  });
}

describe("library wiki ingest", () => {
  it("creates pages from concept and method points and skips other kinds", () => {
    const result = ingestPaperWikiPages([], {
      paperId: "p1", paperTitle: "论文一", contentSignature: "s1",
      points: [
        { kind: "concept", title: "注意力机制", statement: "按相关度加权", anchors: [anchor("b1")] },
        { kind: "method", title: "对比学习", anchors: [anchor("b2")] },
        { kind: "finding", title: "提升 3%", anchors: [anchor("b3")] },
        { kind: "concept", title: "无锚点概念", anchors: [] },
      ],
    });
    expect(result.pages.map((page) => page.title)).toEqual(["注意力机制", "对比学习"]);
    expect(result.createdPages).toBe(2);
    expect(result.pages[0].occurrences.p1.citations[0]).toMatchObject({ paperId: "p1", blockId: "b1", pageNumber: 1 });
  });

  it("merges into existing pages by duplicate or alias match and accumulates per paper", () => {
    const first = ingest([], "p1", "检索增强生成", "concept", { statement: "用检索补充上下文" }).pages;
    const second = ingest(first, "p2", "检索增强  生成", "concept", { statement: "RAG 的基础" });
    expect(second.pages).toHaveLength(1);
    expect(second.mergedPages).toBe(1);
    const page = second.pages[0];
    expect(page.aliases).toEqual([]); // 归一后与标题同名，不需要别名
    expect(Object.keys(page.occurrences)).toEqual(["p1", "p2"]);

    // 近似但归一后不同的标题会记为别名；既有页标题保持不变。
    const aliased = ingest(second.pages, "p3", "Attention Mechanisms", "method");
    const attention = ingest(aliased.pages, "p4", "Attention Mechanism", "method").pages
      .find((item) => item.title === "Attention Mechanisms")!;
    expect(attention.aliases).toContain("Attention Mechanism");

    // 同一篇论文的不同部分再次提到同一概念：同签名累加，不覆盖。
    const third = ingest(second.pages, "p1", "检索增强生成", "concept", { statement: "另一种说法", blockIds: ["b9"] });
    const occurrence = third.pages[0].occurrences.p1;
    expect(occurrence.statements).toEqual(["用检索补充上下文", "另一种说法"]);
    expect(occurrence.citations.map((citation) => citation.blockId)).toEqual(["b1", "b9"]);
  });

  it("replaces a paper occurrence when the document signature changed", () => {
    const first = ingest([], "p1", "知识蒸馏", "method", { statement: "旧说法", signature: "sig-old" }).pages;
    const second = ingest(first, "p1", "知识蒸馏", "method", { statement: "新说法", signature: "sig-new", blockIds: ["b7"] });
    const occurrence = second.pages[0].occurrences.p1;
    expect(occurrence.contentSignature).toBe("sig-new");
    expect(occurrence.statements).toEqual(["新说法"]);
    expect(occurrence.citations.map((citation) => citation.blockId)).toEqual(["b7"]);
  });

  it("generates unique ids for distinct pages with the same normalized title", () => {
    expect(libraryWikiPageId("Attention Mechanism!")).toBe(libraryWikiPageId("attention mechanism"));
    const first = ingest([], "p1", "Transformer").pages;
    const second = ingest(first, "p1", "转换器", "concept").pages; // 不同标题不同页
    expect(second).toHaveLength(2);
    expect(new Set(second.map((page) => page.id)).size).toBe(2);
  });
});

describe("library wiki links (Obsidian-style)", () => {
  it("builds links and backlinks from title mentions in statements", () => {
    let pages = ingest([], "p1", "注意力机制", "concept", { statement: "本文使用注意力机制建模。" }).pages;
    pages = ingest(pages, "p2", "多尺度特征", "method", { statement: "先做多尺度特征提取，再用注意力机制加权。" }).pages;
    const index = buildLibraryWikiIndex(pages);
    const attention = index.pages.find((page) => page.title === "注意力机制")!;
    const multiscale = index.pages.find((page) => page.title === "多尺度特征")!;
    expect(index.links[multiscale.id]).toContain(attention.id); // 多尺度特征 提到 注意力机制
    expect(index.backlinks[attention.id]).toContain(multiscale.id);
    expect(index.links[attention.id]).toEqual([]);
    expect(index.totalCitations).toBe(2);
  });

  it("sorts pages by paper count and survives tolerant parsing", () => {
    let pages = ingest([], "p1", "概念A", "concept").pages;
    pages = ingest(pages, "p2", "概念A", "concept").pages;
    pages = ingest(pages, "p1", "概念B", "concept").pages;
    const index = buildLibraryWikiIndex(pages);
    expect(index.pages[0].title).toBe("概念A");
    const parsed = parseLibraryWikiPages(JSON.parse(JSON.stringify(pages)));
    expect(parsed).toHaveLength(2);
    expect(parseLibraryWikiPages([null, { id: "x" }, "junk", { id: "ok", title: "有效", kind: "method", occurrences: { p: { contentSignature: "s" } } }]))
      .toEqual([expect.objectContaining({ id: "ok", title: "有效", kind: "method", occurrences: {} })]); // 缺 citations 的脏占位被丢弃
  });
});

describe("per-paper knowledge extraction", () => {
  const blocks: DocumentBlock[] = [
    { id: "h1", pageNumber: 1, order: 0, kind: "heading", text: "1 Method", headingLevel: 1 },
    { id: "b1", pageNumber: 1, order: 1, kind: "paragraph", text: "We use attention for X." },
    { id: "b2", pageNumber: 2, order: 2, kind: "paragraph", text: "The dataset is Z." },
  ];

  it("parses concept/method entries with paper-wide anchors and feeds the library wiki", () => {
    const parsed = parseKnowledgeEntries(JSON.stringify({
      entries: [
        { kind: "method", title: "注意力机制", statement: "按相关度加权特征", anchorBlockIds: ["b1"] },
        { kind: "concept", title: "数据集 Z", anchorBlockIds: ["b2"] },
        { kind: "finding", title: "提升 3%", anchorBlockIds: ["b1"] },
        { kind: "concept", title: "幻觉条目", anchorBlockIds: ["p999-b999"] },
      ],
    }), blocks);
    // finding 不属于知识条目域，解析即丢弃；越界锚点被丢弃但条目保留
    expect(parsed.entries.map((entry) => entry.title)).toEqual(["注意力机制", "数据集 Z", "幻觉条目"]);
    expect(parsed.entries[0]).toMatchObject({ kind: "method", locatable: true });
    expect(parsed.entries[2].locatable).toBe(false);
    expect(parsed.stats.droppedAnchors).toBe(1);
    const pages = ingestPaperWikiPages([], {
      paperId: "p1", paperTitle: "论文一", contentSignature: "s1",
      points: parsed.entries.map((entry) => ({ ...entry, sectionId: undefined })),
    }).pages;
    expect(pages.map((page) => page.title)).toEqual(["注意力机制", "数据集 Z"]);
  });

  it("rejects empty or fully unlocatable knowledge output", () => {
    expect(() => parseKnowledgeEntries('{"entries":[]}', blocks)).toThrow(/没有返回知识条目/);
    expect(() => parseKnowledgeEntries('{"entries":[{"kind":"concept","title":"x","anchorBlockIds":["nope"]}]}', blocks))
      .toThrow(/没有给出可用的原文锚点/);
  });

  it("binds the knowledge cache to its own protocol independent of the mindmap", () => {
    const identity = buildWikiKnowledgeCacheIdentity({ paperId: "p1", serviceIdentity: "rev:a:m", documentSignature: "doc-a" });
    expect(identity.key).toContain("wiki-knowledge");
    expect(identity.key).toContain("library-wiki-v1");
    const changed = buildWikiKnowledgeCacheIdentity({ paperId: "p1", serviceIdentity: "rev:a:m", documentSignature: "doc-b" });
    expect(identity.key).not.toBe(changed.key);
  });
});
