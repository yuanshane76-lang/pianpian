import { isNearDuplicateTitle, type WikiAnchor, type WikiEntryKind } from "./paperWiki";

/**
 * 论文库级知识库（化用 Obsidian）：概念/方法页跨论文聚合，每条论述带原文块锚点。
 * 阶段一全部本地组装——判重合并、链接与反向链接都是代码计算，不调模型。
 */
export const LIBRARY_WIKI_STORAGE_VERSION = "library-wiki-v1";

/** 进入库级 wiki 的条目类型：跨论文可复用的知识原子；发现/局限等属于单篇论证，不入库。 */
export const LIBRARY_PAGE_KINDS: WikiEntryKind[] = ["concept", "method"];

export interface LibraryWikiCitation {
  paperId: string;
  paperTitle: string;
  blockId: string;
  pageNumber: number;
  quote: string;
}

export interface LibraryWikiOccurrence {
  paperId: string;
  paperTitle: string;
  /** 论文文档签名：论文重新解析后内容变化，占位被替换而不是重复追加。 */
  contentSignature: string;
  generatedAt: string;
  statements: string[];
  citations: LibraryWikiCitation[];
}

export interface LibraryWikiPage {
  id: string;
  kind: WikiEntryKind;
  title: string;
  aliases: string[];
  /** 临时定义：取自最近一篇论文的论述；跨论文定义由后续阶段由模型撰写。 */
  summary: string;
  occurrences: Record<string, LibraryWikiOccurrence>;
  updatedAt: string;
}

export interface LibraryWikiIngestPoint {
  kind: WikiEntryKind;
  title: string;
  statement?: string;
  anchors: WikiAnchor[];
}

export interface LibraryWikiIngestSource {
  paperId: string;
  paperTitle: string;
  contentSignature: string;
  points: LibraryWikiIngestPoint[];
}

export interface LibraryWikiIngestResult {
  pages: LibraryWikiPage[];
  createdPages: number;
  mergedPages: number;
}

export function libraryWikiNormalize(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function libraryWikiPageId(title: string): string {
  return libraryWikiNormalize(title).slice(0, 60) || "untitled";
}

/** 与既有页判重：id 相等、标题/别名归一相等或近似标题；命中即“扩展而非新建”。 */
function findExistingPage(pages: LibraryWikiPage[], title: string): LibraryWikiPage | null {
  const normalized = libraryWikiNormalize(title);
  if (!normalized) return null;
  for (const page of pages) {
    if (page.id === libraryWikiPageId(title)) return page;
    if (libraryWikiNormalize(page.title) === normalized) return page;
    if (page.aliases.some((alias) => libraryWikiNormalize(alias) === normalized)) return page;
    if (isNearDuplicateTitle(page.title, title)) return page;
    if (page.aliases.some((alias) => isNearDuplicateTitle(alias, title))) return page;
  }
  return null;
}

function uniqueId(pages: LibraryWikiPage[], base: string): string {
  let id = base;
  let suffix = 2;
  const taken = new Set(pages.map((page) => page.id));
  while (taken.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

/**
 * 论文 wiki 的 concept/method 支撑点并入库级知识库：
 * 命中既有页则合并该论文的论述与锚点（同签名幂等、签名变化替换），否则建新页。
 */
export function ingestPaperWikiPages(pages: LibraryWikiPage[], source: LibraryWikiIngestSource): LibraryWikiIngestResult {
  const now = new Date().toISOString();
  const next = pages.map((page) => ({ ...page, occurrences: { ...page.occurrences } }));
  let createdPages = 0;
  let mergedPages = 0;

  for (const point of source.points) {
    if (!LIBRARY_PAGE_KINDS.includes(point.kind)) continue;
    const title = point.title.trim();
    if (!title || !point.anchors.length) continue;
    const existing = findExistingPage(next, title);
    const page = existing ?? {
      id: uniqueId(next, libraryWikiPageId(title)),
      kind: point.kind,
      title,
      aliases: [],
      summary: point.statement ?? title,
      occurrences: {},
      updatedAt: now,
    };
    if (!existing) {
      next.push(page);
      createdPages += 1;
    } else {
      mergedPages += 1;
      if (libraryWikiNormalize(existing.title) !== libraryWikiNormalize(title)
        && !existing.aliases.some((alias) => libraryWikiNormalize(alias) === libraryWikiNormalize(title))) {
        page.aliases = [...existing.aliases, title];
      }
    }

    const previous = page.occurrences[source.paperId];
    const freshCitations = point.anchors.slice(0, 2).map((anchor) => ({
      paperId: source.paperId,
      paperTitle: source.paperTitle,
      blockId: anchor.blockId,
      pageNumber: anchor.pageNumber,
      quote: anchor.quote,
    }));
    if (previous?.contentSignature === source.contentSignature) {
      // 同一次生成的不同部分都提到该概念：累加论述与锚点而不是互相覆盖。
      const statements = [...previous.statements];
      if (point.statement && !statements.includes(point.statement)) statements.push(point.statement);
      const seenBlocks = new Set(previous.citations.map((citation) => citation.blockId));
      const citations = [...previous.citations, ...freshCitations.filter((citation) => !seenBlocks.has(citation.blockId))]
        .slice(0, 4);
      page.occurrences[source.paperId] = { ...previous, statements, citations };
    } else {
      page.occurrences[source.paperId] = {
        paperId: source.paperId,
        paperTitle: source.paperTitle,
        contentSignature: source.contentSignature,
        generatedAt: now,
        statements: point.statement ? [point.statement] : [],
        citations: freshCitations,
      };
    }
    page.updatedAt = now;
    page.summary = point.statement ?? page.summary;
  }
  return { pages: next, createdPages, mergedPages };
}

export interface LibraryWikiIndex {
  pages: LibraryWikiPage[];
  /** page -> 它提到的页面（化用 [[双链]]：标题/别名出现在对方论述文本中即成链）。 */
  links: Record<string, string[]>;
  /** page -> 提到它的页面（反向链接）。 */
  backlinks: Record<string, string[]>;
  /** page -> 标题近似的关联页面（包含或字符二元组相似且同类），跨论文星群的桥。 */
  related: Record<string, string[]>;
  totalCitations: number;
}

function pageText(page: LibraryWikiPage): string {
  return [
    page.summary,
    ...Object.values(page.occurrences).flatMap((occurrence) => occurrence.statements),
  ].join("\n");
}

function titleBigrams(value: string): Set<string> {
  const normalized = libraryWikiNormalize(value);
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) grams.add(normalized.slice(index, index + 2));
  return grams;
}

/** 标题近似度：一方包含另一方（≥3 字）得满分，否则按字符二元组 Jaccard。 */
function titleAffinity(left: { title: string; kind: string }, right: { title: string; kind: string }): number {
  const a = libraryWikiNormalize(left.title);
  const b = libraryWikiNormalize(right.title);
  if (a.length < 2 || b.length < 2) return 0;
  if (a.length >= 3 && b.includes(a)) return 1;
  if (b.length >= 3 && a.includes(b)) return 1;
  const ga = titleBigrams(left.title);
  const gb = titleBigrams(right.title);
  if (!ga.size || !gb.size) return 0;
  let shared = 0;
  for (const gram of ga) if (gb.has(gram)) shared += 1;
  return shared / (ga.size + gb.size - shared);
}

/**
 * 化用 Obsidian 双向链接：页面标题（或别名）出现在其他页面的论述里即建立链接，纯本地计算；
 * 此外标题近似的同类页面（包含或相似度 ≥ 0.3）互为“关联”，把不同论文的星群桥接起来。
 */
export function buildLibraryWikiIndex(pages: LibraryWikiPage[]): LibraryWikiIndex {
  const links: Record<string, string[]> = {};
  const backlinks: Record<string, string[]> = {};
  const related: Record<string, string[]> = {};
  for (const page of pages) {
    links[page.id] = [];
    backlinks[page.id] = [];
    related[page.id] = [];
  }
  const searchable = pages
    .map((page) => ({
      page,
      needles: [page.title, ...page.aliases]
        .map((value) => libraryWikiNormalize(value))
        .filter((value) => value.length >= 2),
    }))
    .filter((entry) => entry.needles.length);
  for (const source of pages) {
    const text = libraryWikiNormalize(pageText(source));
    if (!text) continue;
    for (const target of searchable) {
      if (target.page.id === source.id) continue;
      if (target.needles.some((needle) => text.includes(needle))) {
        links[source.id].push(target.page.id);
        backlinks[target.page.id].push(source.id);
      }
    }
  }
  // 近似关联：同类 + (包含 或 相似度 ≥ 0.3)；每页最多 3 条，按相似度取 top。
  const affinityThreshold = 0.3;
  const maxRelatedPerNode = 3;
  for (const left of pages) {
    const scored: Array<{ id: string; score: number }> = [];
    for (const right of pages) {
      if (right.id === left.id || right.kind !== left.kind) continue;
      if (links[left.id].includes(right.id) || links[right.id].includes(left.id)) continue; // 已有提及线
      const score = titleAffinity(left, right);
      if (score >= affinityThreshold) scored.push({ id: right.id, score });
    }
    scored.sort((first, second) => second.score - first.score);
    related[left.id] = scored.slice(0, maxRelatedPerNode).map((entry) => entry.id);
  }
  const sorted = [...pages].sort((left, right) => {
    const leftCount = Object.keys(left.occurrences).length;
    const rightCount = Object.keys(right.occurrences).length;
    return rightCount - leftCount || left.title.localeCompare(right.title, "zh-Hans-CN");
  });
  const totalCitations = pages.reduce(
    (sum, page) => sum + Object.values(page.occurrences).reduce((inner, occurrence) => inner + occurrence.citations.length, 0),
    0,
  );
  return { pages: sorted, links, backlinks, related, totalCitations };
}

/** 供持久化校验的宽松解析：结构不符的页面丢弃，不让单条脏数据拖垮整个知识库。 */
export function parseLibraryWikiPages(value: unknown): LibraryWikiPage[] {
  if (!Array.isArray(value)) return [];
  const pages: LibraryWikiPage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const source = item as Record<string, unknown>;
    const id = typeof source.id === "string" ? source.id : "";
    const title = typeof source.title === "string" ? source.title.trim() : "";
    if (!id || !title) continue;
    const occurrences: Record<string, LibraryWikiOccurrence> = {};
    if (source.occurrences && typeof source.occurrences === "object" && !Array.isArray(source.occurrences)) {
      for (const [paperId, occurrence] of Object.entries(source.occurrences as Record<string, unknown>)) {
        if (!occurrence || typeof occurrence !== "object" || Array.isArray(occurrence)) continue;
        const record = occurrence as Record<string, unknown>;
        if (typeof record.contentSignature !== "string" || !Array.isArray(record.citations)) continue;
        occurrences[paperId] = {
          paperId,
          paperTitle: typeof record.paperTitle === "string" ? record.paperTitle : "",
          contentSignature: record.contentSignature,
          generatedAt: typeof record.generatedAt === "string" ? record.generatedAt : "",
          statements: Array.isArray(record.statements) ? record.statements.filter((item): item is string => typeof item === "string") : [],
          citations: record.citations.filter((citation): citation is LibraryWikiCitation =>
            Boolean(citation) && typeof citation === "object" && typeof (citation as LibraryWikiCitation).blockId === "string"),
        };
      }
    }
    pages.push({
      id,
      kind: source.kind === "method" ? "method" : "concept",
      title,
      aliases: Array.isArray(source.aliases) ? source.aliases.filter((item): item is string => typeof item === "string") : [],
      summary: typeof source.summary === "string" ? source.summary : "",
      occurrences,
      updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
    });
  }
  return pages;
}
