import { buildAnalysisCacheKey } from "./analysis";
import { getDocumentSourceSignature, inferHeadingLevel, type DocumentBlock, type HeadingLevel } from "./documentBlocks";

/**
 * 单论文知识库（wiki-lite）：不做“标题树复读机”。正文先按一级章节合并成少数大部分，
 * 每部分由模型提炼两级语义要点树；一次装配调用统一设计全文结构、语义标题与论证主线。
 * 模型只允许返回阅读块 ID；页码与引文一律本地解析。
 */
export const PAPER_WIKI_PROTOCOL_VERSION = "paper-wiki-v2";
export const WIKI_PRELUDE_PART_ID = "part-pre";
export const WIKI_FULL_PART_ID = "part-full";

export const THREAD_MAX_ENTRIES = 8;
export const PART_MAX_INSIGHTS = 6;
export const INSIGHT_MAX_POINTS = 4;
export const PART_MAX_POINTS = 24;
export const WIKI_MAX_PARTS = 9;
const WIKI_MIN_PART_CHARS = 1200;

/** 参考文献、致谢等尾部材料没有论证内容，不参与知识库生成。 */
const BACK_MATTER = /^(references?|bibliography|works?\s*cited|acknowledg(e)?ments?|append(?:ix|ices)\b|author contributions|funding|interest statement|参考文献|致\s*谢|附\s*录)/i;

export type WikiEntryKind = "problem" | "method" | "finding" | "limitation" | "background" | "concept";

const ENTRY_KINDS: WikiEntryKind[] = ["problem", "method", "finding", "limitation", "background", "concept"];

export const THREAD_ENTRY_SECTION_ID = "thread";

/** 参与知识库生成的大块：边界来自真实一级章节（真值），标题由装配调用语义化重命名。 */
export interface WikiPart {
  id: string;
  title: string;
  headingBlockId: string | null;
  pageNumber: number | null;
  blockIds: string[];
  /** 部分内部的次级标题，供装配调用总览全文。 */
  headings: string[];
  firstBlockId: string | null;
}

export interface WikiAnchor {
  blockId: string;
  pageNumber: number;
  quote: string;
}

export interface WikiEntry {
  id: string;
  sectionId: string;
  kind: WikiEntryKind;
  title: string;
  statement?: string;
  anchors: WikiAnchor[];
  locatable: boolean;
}

export interface WikiPoint {
  id: string;
  kind: WikiEntryKind;
  title: string;
  statement?: string;
  anchors: WikiAnchor[];
  locatable: boolean;
}

export interface WikiInsight {
  id: string;
  title: string;
  statement?: string;
  points: WikiPoint[];
}

export interface WikiPartTree {
  title: string;
  insights: WikiInsight[];
}

export interface WikiEntryParseStats {
  total: number;
  locatable: number;
  droppedAnchors: number;
  mergedDuplicates: number;
}

export interface WikiRename {
  title: string;
  summary?: string;
}

function clean(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maximum);
}

function extractJsonText(text: string): string {
  if (typeof text !== "string" || !text.trim()) throw new Error("模型没有返回内容，请重试");
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = fenced ? fenced[1].trim() : trimmed;
  try {
    JSON.parse(body);
    return body;
  } catch {
    // Fall through: the model may have wrapped the JSON in prose.
  }
  const starts = [body.indexOf("{"), body.indexOf("[")].filter((index) => index >= 0);
  if (!starts.length) throw new Error("模型返回的结构无法解析，请重试");
  const start = Math.min(...starts);
  const closer = body[start] === "{" ? "}" : "]";
  const end = body.lastIndexOf(closer);
  if (end <= start) throw new Error("模型返回的结构无法解析，请重试");
  const candidate = body.slice(start, end + 1);
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    throw new Error("模型返回的结构无法解析，请重试");
  }
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(extractJsonText(text)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("模型返回的结构无法解析，请重试");
  return parsed as Record<string, unknown>;
}

function headingLevelOf(block: DocumentBlock): HeadingLevel {
  if (Number.isInteger(block.headingLevel) && Number(block.headingLevel) >= 1 && Number(block.headingLevel) <= 6) {
    return block.headingLevel as HeadingLevel;
  }
  return inferHeadingLevel(block.text) ?? 1;
}

function blockChars(block: DocumentBlock): number {
  return block.text.length;
}

function makePart(
  id: string,
  title: string,
  headingBlockId: string | null,
  partBlocks: DocumentBlock[],
): WikiPart {
  const headingTexts = partBlocks
    .filter((block) => block.kind === "heading" && block.id !== headingBlockId)
    .map((block) => clean(block.text, 50))
    .filter(Boolean);
  const first = partBlocks.find((block) => block.kind !== "heading" && block.text.trim());
  return {
    id,
    title,
    headingBlockId,
    pageNumber: headingBlockId ? partBlocks.find((block) => block.id === headingBlockId)?.pageNumber ?? null : null,
    blockIds: partBlocks.map((block) => block.id),
    headings: headingTexts,
    firstBlockId: first?.id ?? null,
  };
}

/**
 * 大块划分：优先按一级章节切，不足两块时放宽到二级；仍不足则整篇一块。
 * 随后丢弃尾部材料、把过小的块并入相邻块、总量封顶——保证每次生成的上下文是
 * “有完整语义的一段”，而不是几十个标题碎片。
 */
export function buildWikiParts(blocks: DocumentBlock[]): WikiPart[] {
  const content = blocks.filter((block) => block.text.trim());
  if (!content.length) return [];

  function segment(splitLevel: number): WikiPart[] {
    const parts: WikiPart[] = [];
    let prelude: DocumentBlock[] = [];
    let current: DocumentBlock[] = [];
    let currentHeading: DocumentBlock | null = null;

    function close() {
      if (!currentHeading) {
        prelude = current;
      } else {
        parts.push(makePart(currentHeading.id, clean(currentHeading.text, 60) || "未命名部分", currentHeading.id, current));
      }
      current = [];
    }

    for (const block of content) {
      if (block.kind === "heading" && headingLevelOf(block) <= splitLevel) {
        close();
        currentHeading = block;
        current = [block];
        continue;
      }
      current.push(block);
    }
    close();
    if (prelude.length && content.some((block) => block.kind === "heading")) {
      parts.unshift(makePart(WIKI_PRELUDE_PART_ID, "开篇", null, prelude));
    }
    return parts;
  }

  let parts: WikiPart[] = [];
  for (const splitLevel of [1, 2, 6]) {
    parts = segment(splitLevel);
    if (parts.length >= 2) break;
  }
  if (parts.length < 2) {
    return [makePart(WIKI_FULL_PART_ID, "全文", null, content)];
  }

  // 尾部材料不参与生成。
  parts = parts.filter((part) => part.id === WIKI_PRELUDE_PART_ID || !BACK_MATTER.test(part.title));

  const charOf = (() => {
    const sizes = new Map(content.map((block) => [block.id, block.text.length]));
    return (part: WikiPart) => part.blockIds.reduce((sum, id) => sum + (sizes.get(id) ?? 0), 0);
  })();
  function mergeInto(parts: WikiPart[], index: number): WikiPart[] {
    const part = parts[index];
    const left = parts[index - 1];
    const right = parts[index + 1];
    const targetIsLeft = !right || (left && charOf(left) <= charOf(right));
    const targetIndex = targetIsLeft ? index - 1 : index + 1;
    const target = targetIsLeft ? left : right;
    if (!target) return parts;
    const merged: WikiPart = {
      ...target,
      blockIds: targetIsLeft ? [...target.blockIds, ...part.blockIds] : [...part.blockIds, ...target.blockIds],
      headings: targetIsLeft ? [...target.headings, part.title, ...part.headings] : [...part.headings, part.title, ...target.headings],
    };
    const next = [...parts];
    next.splice(index, 1);
    next[targetIsLeft ? index - 1 : index] = merged;
    return next;
  }

  // 过小的部分并入相邻较小的一侧；自然的小论文（≤3 块）保持原结构不动。
  let guard = 0;
  while (parts.length > 3 && guard < 100) {
    guard += 1;
    const smallest = parts.reduce((best, part, index) => (charOf(part) < charOf(parts[best]) ? index : best), 0);
    if (charOf(parts[smallest]) >= WIKI_MIN_PART_CHARS) break;
    parts = mergeInto(parts, smallest);
  }
  // 总量封顶：反复把最小块并入相邻块。
  guard = 0;
  while (parts.length > WIKI_MAX_PARTS && guard < 100) {
    guard += 1;
    const smallest = parts.reduce((best, part, index) => (charOf(part) < charOf(parts[best]) ? index : best), 0);
    parts = mergeInto(parts, smallest);
  }
  return parts;
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function bigrams(value: string): Set<string> {
  const normalized = normalizeTitle(value);
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) grams.add(normalized.slice(index, index + 2));
  return grams;
}

/** 标题归一后相等或字符二元组 Jaccard ≥ 0.8 视为近似重复（对中文友好）。 */
export function isNearDuplicateTitle(left: string, right: string): boolean {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) * 0.4) return false;
  const ga = bigrams(left);
  const gb = bigrams(right);
  if (!ga.size || !gb.size) return false;
  let shared = 0;
  for (const gram of ga) if (gb.has(gram)) shared += 1;
  return shared / (ga.size + gb.size - shared) >= 0.8;
}

/** “扩展而非新建”：近似重复条目就地合并，锚点取并集。纯本地，不调模型。 */
export function mergeDuplicateEntries<T extends { title: string; anchors: WikiAnchor[]; locatable: boolean }>(
  entries: T[],
): { entries: T[]; merged: number } {
  const kept: T[] = [];
  let merged = 0;
  for (const entry of entries) {
    const duplicate = kept.find((candidate) => isNearDuplicateTitle(candidate.title, entry.title));
    if (!duplicate) {
      kept.push(entry);
      continue;
    }
    merged += 1;
    duplicate.anchors = duplicate.anchors
      .concat(entry.anchors.filter((anchor) => !duplicate.anchors.some((existing) => existing.blockId === anchor.blockId)))
      .slice(0, 2);
    duplicate.locatable = duplicate.anchors.length > 0;
  }
  return { entries: kept, merged };
}

function normalizeKind(value: unknown): WikiEntryKind {
  return typeof value === "string" && (ENTRY_KINDS as string[]).includes(value) ? value as WikiEntryKind : "background";
}

function quoteOf(block: DocumentBlock): string {
  return clean(block.text, 160);
}

function resolveAnchor(
  blockId: unknown,
  seen: Set<string>,
  allowed: Set<string>,
  blockMap: Map<string, DocumentBlock>,
  stats: WikiEntryParseStats,
): WikiAnchor | null {
  const id = typeof blockId === "string" ? blockId.trim() : "";
  if (!id || seen.has(id)) return null;
  seen.add(id);
  const block = blockMap.get(id);
  if (!block || !allowed.has(id)) {
    stats.droppedAnchors += 1;
    return null;
  }
  return { blockId: id, pageNumber: block.pageNumber, quote: quoteOf(block) };
}

function readAnchorIds(source: Record<string, unknown>): unknown[] {
  if (Array.isArray(source.anchorBlockIds)) return source.anchorBlockIds;
  if (Array.isArray(source.anchors)) return source.anchors;
  return [];
}

/** 论证主线 + 全文装配：跨部分条目与各部分语义重命名，一次调用完成。 */
export function parseWikiThread(text: string, blocks: DocumentBlock[], partIds: string[]): {
  title: string;
  thread: WikiEntry[];
  renames: Record<string, WikiRename>;
  stats: WikiEntryParseStats;
} {
  const container = parseJsonObject(text);
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  const allowed = new Set(blockMap.keys());
  const stats: WikiEntryParseStats = { total: 0, locatable: 0, droppedAnchors: 0, mergedDuplicates: 0 };

  const renames: Record<string, WikiRename> = {};
  const knownIds = new Set(partIds);
  if (Array.isArray(container.parts)) {
    for (const item of container.parts) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const source = item as Record<string, unknown>;
      const id = typeof source.id === "string" ? source.id.trim() : "";
      const title = clean(source.title, 40);
      if (!id || !knownIds.has(id) || !title) continue;
      const summary = clean(source.summary, 80);
      renames[id] = { title, ...(summary ? { summary } : {}) };
    }
  }

  const rawEntries = Array.isArray(container.thread)
    ? container.thread
    : Array.isArray(container.entries)
      ? container.entries
      : [];
  const entries: WikiEntry[] = [];
  for (const item of rawEntries) {
    if (entries.length >= THREAD_MAX_ENTRIES) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const source = item as Record<string, unknown>;
    const title = clean(source.title, 40);
    if (!title) continue;
    const anchors: WikiAnchor[] = [];
    const seen = new Set<string>();
    for (const candidate of readAnchorIds(source)) {
      const anchor = resolveAnchor(candidate, seen, allowed, blockMap, stats);
      if (anchor) anchors.push(anchor);
      if (anchors.length >= 2) break;
    }
    const statement = clean(source.statement, 120);
    entries.push({
      id: `${THREAD_ENTRY_SECTION_ID}:e${entries.length + 1}`,
      sectionId: THREAD_ENTRY_SECTION_ID,
      kind: normalizeKind(source.kind),
      title,
      ...(statement ? { statement } : {}),
      anchors,
      locatable: anchors.length > 0,
    });
  }
  const deduped = mergeDuplicateEntries(entries);
  if (!deduped.entries.length) throw new Error("模型没有返回论证主线，请重试");
  if (!deduped.entries.some((entry) => entry.locatable)) throw new Error("模型没有给出可用的原文锚点，请重试");
  stats.total = deduped.entries.length;
  stats.locatable = deduped.entries.filter((entry) => entry.locatable).length;
  stats.mergedDuplicates = deduped.merged;
  return {
    title: clean(container.title, 80),
    thread: deduped.entries,
    renames,
    stats,
  };
}

/** 部分要点树：两级语义结构（要点 → 支撑点），锚点只落在支撑点上且必须属于本部分。 */
export function parsePartTree(text: string, part: WikiPart, blocks: DocumentBlock[]): { tree: WikiPartTree; stats: WikiEntryParseStats; title: string } {
  const container = parseJsonObject(text);
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  const allowed = new Set([part.id, ...part.blockIds]);
  const stats: WikiEntryParseStats = { total: 0, locatable: 0, droppedAnchors: 0, mergedDuplicates: 0 };

  const rawInsights = Array.isArray(container.children)
    ? container.children
    : Array.isArray(container.insights)
      ? container.insights
      : [];
  const insights: WikiInsight[] = [];
  for (const rawInsight of rawInsights) {
    if (insights.length >= PART_MAX_INSIGHTS) break;
    if (!rawInsight || typeof rawInsight !== "object" || Array.isArray(rawInsight)) continue;
    const insightSource = rawInsight as Record<string, unknown>;
    const insightTitle = clean(insightSource.title, 40);
    if (!insightTitle) continue;
    const insightStatement = clean(insightSource.statement, 100);

    const points: WikiPoint[] = [];
    const rawPoints = Array.isArray(insightSource.children) ? insightSource.children : [];
    for (const rawPoint of rawPoints) {
      if (points.length >= INSIGHT_MAX_POINTS || stats.total >= PART_MAX_POINTS) break;
      if (!rawPoint || typeof rawPoint !== "object" || Array.isArray(rawPoint)) continue;
      const pointSource = rawPoint as Record<string, unknown>;
      const pointTitle = clean(pointSource.title, 40);
      if (!pointTitle) continue;
      const anchors: WikiAnchor[] = [];
      const seen = new Set<string>();
      for (const candidate of readAnchorIds(pointSource)) {
        const anchor = resolveAnchor(candidate, seen, allowed, blockMap, stats);
        if (anchor) anchors.push(anchor);
        if (anchors.length >= 2) break;
      }
      const statement = clean(pointSource.statement, 100);
      points.push({
        id: `${part.id}:i${insights.length + 1}:p${points.length + 1}`,
        kind: normalizeKind(pointSource.kind),
        title: pointTitle,
        ...(statement ? { statement } : {}),
        anchors,
        locatable: anchors.length > 0,
      });
      stats.total += 1;
      if (points[points.length - 1].locatable) stats.locatable += 1;
    }

    insights.push({
      id: `${part.id}:i${insights.length + 1}`,
      title: insightTitle,
      ...(insightStatement ? { statement: insightStatement } : {}),
      points,
    });
  }

  const dedupedByInsight = insights.map((insight) => {
    const deduped = mergeDuplicateEntries(insight.points);
    stats.mergedDuplicates += deduped.merged;
    stats.total -= insight.points.length - deduped.entries.length;
    return { ...insight, points: deduped.entries };
  });
  if (!dedupedByInsight.length) throw new Error("模型没有返回可用的要点，请重试");
  if (!stats.locatable) throw new Error("模型没有给出本部分可用的原文锚点，请重试");
  return {
    tree: { title: clean(container.title, 40) || part.title, insights: dedupedByInsight },
    stats,
    title: clean(container.title, 40) || part.title,
  };
}

/** 覆盖率只统计已生成部分的正文块，未生成部分不计入分母。 */
export function computeWikiCoverage(
  partTrees: Record<string, WikiPartTree>,
  parts: WikiPart[],
  blocks: DocumentBlock[],
): { covered: number; total: number } {
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  const loadedParts = parts.filter((part) => partTrees[part.id]);
  const anchored = new Set<string>();
  for (const tree of Object.values(partTrees)) {
    for (const insight of tree.insights) {
      for (const point of insight.points) {
        for (const anchor of point.anchors) anchored.add(anchor.blockId);
      }
    }
  }
  let covered = 0;
  let total = 0;
  for (const part of loadedParts) {
    for (const blockId of part.blockIds) {
      const block = blockMap.get(blockId);
      if (!block || block.kind === "heading" || !block.text.trim()) continue;
      total += 1;
      if (anchored.has(blockId)) covered += 1;
    }
  }
  return { covered, total };
}

/** 论文库级知识库的自有协议：独立于单篇思维导图（paper-wiki-v2）演进。 */
export const LIBRARY_WIKI_PROTOCOL_VERSION = "library-wiki-v1";
export const KNOWLEDGE_MAX_ENTRIES = 12;

export interface KnowledgeEntry {
  id: string;
  kind: "concept" | "method";
  title: string;
  statement?: string;
  anchors: WikiAnchor[];
  locatable: boolean;
}

/**
 * 按论文提取知识条目（论文库级 wiki 的数据源）：只接受 concept/method，
 * 锚点允许指向全文任意块。与思维导图的要点树互不依赖。
 */
export function parseKnowledgeEntries(text: string, blocks: DocumentBlock[]): { entries: KnowledgeEntry[]; stats: WikiEntryParseStats } {
  const container = parseJsonObject(text);
  const rawEntries = Array.isArray(container.entries) ? container.entries : [];
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  const allowed = new Set(blockMap.keys());
  const stats: WikiEntryParseStats = { total: 0, locatable: 0, droppedAnchors: 0, mergedDuplicates: 0 };
  const entries: KnowledgeEntry[] = [];
  for (const item of rawEntries) {
    if (entries.length >= KNOWLEDGE_MAX_ENTRIES) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const source = item as Record<string, unknown>;
    const title = clean(source.title, 40);
    if (!title) continue;
    // 只收知识条目域：concept/method；finding/limitation 等单篇论证直接丢弃。
    if (source.kind !== "concept" && source.kind !== "method") continue;
    const anchors: WikiAnchor[] = [];
    const seen = new Set<string>();
    for (const candidate of readAnchorIds(source)) {
      const anchor = resolveAnchor(candidate, seen, allowed, blockMap, stats);
      if (anchor) anchors.push(anchor);
      if (anchors.length >= 2) break;
    }
    const kind: "concept" | "method" = source.kind;
    const statement = clean(source.statement, 120);
    entries.push({
      id: `k:e${entries.length + 1}`,
      kind,
      title,
      ...(statement ? { statement } : {}),
      anchors,
      locatable: anchors.length > 0,
    });
  }
  const deduped = mergeDuplicateEntries(entries);
  if (!deduped.entries.length) throw new Error("模型没有返回知识条目，请重试");
  if (!deduped.entries.some((entry) => entry.locatable)) throw new Error("模型没有给出可用的原文锚点，请重试");
  stats.total = deduped.entries.length;
  stats.locatable = deduped.entries.filter((entry) => entry.locatable).length;
  stats.mergedDuplicates = deduped.merged;
  return { entries: deduped.entries, stats };
}

export function buildWikiKnowledgeCacheIdentity(options: {
  paperId: string;
  serviceIdentity: string;
  documentSignature: string;
}): { key: string; scopeId: string; sourceSignature: string } {
  const sourceSignature = `${options.serviceIdentity}:${options.documentSignature}:${LIBRARY_WIKI_PROTOCOL_VERSION}:knowledge`;
  return {
    key: buildAnalysisCacheKey(options.paperId, "paper", "wiki-knowledge", sourceSignature),
    scopeId: "paper",
    sourceSignature,
  };
}

export function buildWikiThreadCacheIdentity(options: {
  paperId: string;
  serviceIdentity: string;
  documentSignature: string;
}): { key: string; scopeId: string; sourceSignature: string } {
  const scopeId = "paper";
  const sourceSignature = `${options.serviceIdentity}:${options.documentSignature}:${PAPER_WIKI_PROTOCOL_VERSION}:thread`;
  return {
    key: buildAnalysisCacheKey(options.paperId, scopeId, "wiki-thread", sourceSignature),
    scopeId,
    sourceSignature,
  };
}

export function buildWikiPartCacheIdentity(options: {
  paperId: string;
  serviceIdentity: string;
  partId: string;
  partSignature: string;
}): { key: string; scopeId: string; sourceSignature: string } {
  const sourceSignature = `${options.serviceIdentity}:${options.partSignature}:${PAPER_WIKI_PROTOCOL_VERSION}:part`;
  return {
    key: buildAnalysisCacheKey(options.paperId, options.partId, "wiki-part", sourceSignature),
    scopeId: options.partId,
    sourceSignature,
  };
}

export function getWikiPartSignature(part: WikiPart, blocks: DocumentBlock[]): string {
  const wanted = new Set(part.blockIds);
  return getDocumentSourceSignature(blocks.filter((block) => wanted.has(block.id)));
}

/** 装配提示词用的部分概览。 */
export interface WikiPartInfo {
  id: string;
  title: string;
  headings: string[];
  firstBlockIds?: string[];
}
