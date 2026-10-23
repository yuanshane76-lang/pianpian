import { buildAnalysisCacheKey } from "./analysis";
import { getDocumentSourceSignature, inferHeadingLevel, type DocumentBlock, type HeadingLevel } from "./documentBlocks";

/**
 * 单论文知识库（wiki-lite）：骨架来自本地标题块（真值，不经过模型），
 * 论证主线与章节条目由模型生成，但只允许返回阅读块 ID；页码与引文一律本地解析。
 */
export const PAPER_WIKI_PROTOCOL_VERSION = "paper-wiki-v1";
export const WIKI_PRELUDE_SECTION_ID = "sec-pre";
export const WIKI_FULL_SECTION_ID = "sec-full";

export const THREAD_MAX_ENTRIES = 8;
export const SECTION_MAX_ENTRIES = 12;
export const ENTRY_MAX_ANCHORS = 2;

export type WikiEntryKind = "problem" | "method" | "finding" | "limitation" | "background" | "concept";

const ENTRY_KINDS: WikiEntryKind[] = ["problem", "method", "finding", "limitation", "background", "concept"];

export const THREAD_ENTRY_SECTION_ID = "thread";

export interface WikiSection {
  id: string;
  title: string;
  level: number;
  headingBlockId: string | null;
  /** 标题块所在页码；合成章节（开篇/全文）为 null。 */
  pageNumber: number | null;
  blockIds: string[];
  children: WikiSection[];
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

export interface WikiEntryParseStats {
  total: number;
  locatable: number;
  droppedAnchors: number;
  mergedDuplicates: number;
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

function headingLevelOf(block: DocumentBlock): HeadingLevel {
  if (Number.isInteger(block.headingLevel) && Number(block.headingLevel) >= 1 && Number(block.headingLevel) <= 6) {
    return block.headingLevel as HeadingLevel;
  }
  return inferHeadingLevel(block.text) ?? 1;
}

/**
 * 论文骨架完全由标题块构建：MinerU 已经给出真实章节，顶层结构不经过模型。
 * 没有标题时退化为单一“全文”章节，保证功能可用。
 */
export function buildSectionSkeleton(blocks: DocumentBlock[]): WikiSection[] {
  const hasHeading = blocks.some((block) => block.kind === "heading");
  if (!hasHeading) {
    const blockIds = blocks.filter((block) => block.kind !== "heading").map((block) => block.id);
    return blockIds.length
      ? [{ id: WIKI_FULL_SECTION_ID, title: "全文", level: 1, headingBlockId: null, pageNumber: null, blockIds, children: [] }]
      : [];
  }

  const roots: WikiSection[] = [];
  const stack: WikiSection[] = [];
  const preludeIds: string[] = [];

  for (const block of blocks) {
    if (block.kind !== "heading") {
      if (stack.length) stack[stack.length - 1].blockIds.push(block.id);
      else preludeIds.push(block.id);
      continue;
    }
    const level = headingLevelOf(block);
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const section: WikiSection = {
      id: block.id,
      title: clean(block.text, 60) || "未命名章节",
      level,
      headingBlockId: block.id,
      pageNumber: block.pageNumber,
      blockIds: [],
      children: [],
    };
    if (stack.length) stack[stack.length - 1].children.push(section);
    else roots.push(section);
    stack.push(section);
  }

  if (preludeIds.length) {
    roots.unshift({ id: WIKI_PRELUDE_SECTION_ID, title: "开篇", level: 1, headingBlockId: null, pageNumber: null, blockIds: preludeIds, children: [] });
  }
  return roots;
}

export function flattenSections(sections: WikiSection[]): WikiSection[] {
  const flat: WikiSection[] = [];
  function walk(list: WikiSection[]) {
    for (const section of list) {
      flat.push(section);
      walk(section.children);
    }
  }
  walk(sections);
  return flat;
}

export function getWikiSectionSignature(section: WikiSection, blocks: DocumentBlock[]): string {
  const wanted = new Set<string>([section.id, ...section.blockIds]);
  return getDocumentSourceSignature(blocks.filter((block) => wanted.has(block.id)));
}

/** 从顶层到目标章节的标题路径，如 "3 方法 / 3.2 数据预处理"；找不到返回章节自身标题。 */
export function getWikiSectionPath(sections: WikiSection[], sectionId: string): string {
  const trail: string[] = [];
  function walk(list: WikiSection[]): WikiSection | null {
    for (const section of list) {
      trail.push(section.title);
      if (section.id === sectionId) return section;
      const hit = walk(section.children);
      if (hit) return hit;
      trail.pop();
    }
    return null;
  }
  const found = walk(sections);
  return found ? trail.join(" / ") : "";
}

/** 同级章节标题（不含自身），供章节条目提示词区分边界。 */
export function getWikiSiblingTitles(sections: WikiSection[], sectionId: string): string[] {
  function walk(list: WikiSection[]): string[] | null {
    for (const section of list) {
      if (section.id === sectionId) return list.filter((item) => item.id !== sectionId).map((item) => item.title);
      const hit = walk(section.children);
      if (hit) return hit;
    }
    return null;
  }
  return walk(sections) ?? [];
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

/** “扩展而非新建”：同一章节内的近似重复条目就地合并，锚点取并集。纯本地，不调模型。 */
export function mergeDuplicateEntries(entries: WikiEntry[]): { entries: WikiEntry[]; merged: number } {
  const kept: WikiEntry[] = [];
  let merged = 0;
  for (const entry of entries) {
    const duplicate = kept.find((candidate) => candidate.sectionId === entry.sectionId && isNearDuplicateTitle(candidate.title, entry.title));
    if (!duplicate) {
      kept.push(entry);
      continue;
    }
    merged += 1;
    duplicate.anchors = duplicate.anchors
      .concat(entry.anchors.filter((anchor) => !duplicate.anchors.some((existing) => existing.blockId === anchor.blockId)))
      .slice(0, ENTRY_MAX_ANCHORS);
    duplicate.locatable = duplicate.anchors.length > 0;
  }
  return { entries: kept, merged };
}

interface RawEntry {
  kind?: unknown;
  title?: unknown;
  statement?: unknown;
  anchorBlockIds?: unknown;
  anchors?: unknown;
}

function readAnchorIds(source: RawEntry): unknown[] {
  if (Array.isArray(source.anchorBlockIds)) return source.anchorBlockIds;
  if (Array.isArray(source.anchors)) return source.anchors;
  return [];
}

function normalizeKind(value: unknown): WikiEntryKind {
  return typeof value === "string" && (ENTRY_KINDS as string[]).includes(value) ? value as WikiEntryKind : "background";
}

function quoteOf(block: DocumentBlock): string {
  return clean(block.text, 160);
}

function collectEntries(
  raw: unknown[],
  sectionId: string,
  allowed: Set<string>,
  blockMap: Map<string, DocumentBlock>,
  cap: number,
  stats: WikiEntryParseStats,
): WikiEntry[] {
  const entries: WikiEntry[] = [];
  for (const item of raw) {
    if (entries.length >= cap) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const source = item as RawEntry;
    const title = clean(source.title, 40);
    if (!title) continue;

    const anchors: WikiAnchor[] = [];
    const seen = new Set<string>();
    for (const candidate of readAnchorIds(source)) {
      const blockId = typeof candidate === "string" ? candidate.trim() : "";
      if (!blockId || seen.has(blockId)) continue;
      seen.add(blockId);
      const block = blockMap.get(blockId);
      if (!block || !allowed.has(blockId)) {
        stats.droppedAnchors += 1;
        continue;
      }
      anchors.push({ blockId, pageNumber: block.pageNumber, quote: quoteOf(block) });
      if (anchors.length >= ENTRY_MAX_ANCHORS) break;
    }

    const statement = clean(source.statement, 120);
    entries.push({
      id: `${sectionId}:e${entries.length + 1}`,
      sectionId,
      kind: normalizeKind(source.kind),
      title,
      ...(statement ? { statement } : {}),
      anchors,
      locatable: anchors.length > 0,
    });
  }
  return entries;
}

function parseRawEntries(text: string): { container: Record<string, unknown> | null; rawEntries: unknown[] } {
  const parsed = JSON.parse(extractJsonText(text)) as unknown;
  const container = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  const rawEntries = Array.isArray(parsed)
    ? parsed
    : container && Array.isArray(container.entries)
      ? container.entries
      : container && Array.isArray(container.nodes)
        ? container.nodes
        : [];
  return { container, rawEntries };
}

/** 论证主线：跨章节条目，锚点允许指向全文任意块。 */
export function parseThreadEntries(text: string, blocks: DocumentBlock[]): { title: string; entries: WikiEntry[]; stats: WikiEntryParseStats } {
  const { container, rawEntries } = parseRawEntries(text);
  if (!rawEntries.length) throw new Error("模型没有返回论证主线条目，请重试");
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  const allowed = new Set(blockMap.keys());
  const stats: WikiEntryParseStats = { total: 0, locatable: 0, droppedAnchors: 0, mergedDuplicates: 0 };
  const entries = collectEntries(rawEntries, THREAD_ENTRY_SECTION_ID, allowed, blockMap, THREAD_MAX_ENTRIES, stats);
  const deduped = mergeDuplicateEntries(entries);
  stats.total = deduped.entries.length;
  stats.locatable = deduped.entries.filter((entry) => entry.locatable).length;
  stats.mergedDuplicates = deduped.merged;
  if (!stats.total) throw new Error("模型没有返回可用的主线条目，请重试");
  if (!stats.locatable) throw new Error("模型没有给出可用的原文锚点，请重试");
  const title = container ? clean(container.title, 80) : "";
  return { title, entries: deduped.entries, stats };
}

/** 章节条目：锚点必须落在本章节的阅读块内，跨章节引用按幻觉丢弃。 */
export function parseSectionEntries(text: string, section: WikiSection, blocks: DocumentBlock[]): { entries: WikiEntry[]; stats: WikiEntryParseStats } {
  const { rawEntries } = parseRawEntries(text);
  if (!rawEntries.length) throw new Error("模型没有返回本章节的条目，请重试");
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  const allowed = new Set(section.blockIds);
  const stats: WikiEntryParseStats = { total: 0, locatable: 0, droppedAnchors: 0, mergedDuplicates: 0 };
  const entries = collectEntries(rawEntries, section.id, allowed, blockMap, SECTION_MAX_ENTRIES, stats);
  const deduped = mergeDuplicateEntries(entries);
  stats.total = deduped.entries.length;
  stats.locatable = deduped.entries.filter((entry) => entry.locatable).length;
  stats.mergedDuplicates = deduped.merged;
  if (!stats.total) throw new Error("模型没有返回可用的章节条目，请重试");
  if (!stats.locatable) throw new Error("模型没有给出本章节可用的原文锚点，请重试");
  return { entries: deduped.entries, stats };
}

/** 覆盖率只统计已生成章节的正文块，未生成章节不计入分母，避免误导。 */
export function computeWikiCoverage(
  entriesBySection: Record<string, WikiEntry[]>,
  sections: WikiSection[],
  blocks: DocumentBlock[],
): { covered: number; total: number } {
  const loadedIds = new Set(Object.keys(entriesBySection));
  const loadedSectionIds = new Set(flattenSections(sections).filter((section) => loadedIds.has(section.id)).map((section) => section.id));
  const contentBlocks = blocks.filter((block) => block.kind !== "heading" && block.text.trim());
  const inScope = contentBlocks.filter((block) => {
    const owner = flattenSections(sections).find((section) => section.blockIds.includes(block.id));
    return owner ? loadedSectionIds.has(owner.id) : false;
  });
  const anchored = new Set<string>();
  for (const entries of Object.values(entriesBySection)) {
    for (const entry of entries) for (const anchor of entry.anchors) anchored.add(anchor.blockId);
  }
  let covered = 0;
  for (const block of inScope) if (anchored.has(block.id)) covered += 1;
  return { covered, total: inScope.length };
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

export function buildWikiSectionCacheIdentity(options: {
  paperId: string;
  serviceIdentity: string;
  sectionId: string;
  sectionSignature: string;
}): { key: string; scopeId: string; sourceSignature: string } {
  const sourceSignature = `${options.serviceIdentity}:${options.sectionSignature}:${PAPER_WIKI_PROTOCOL_VERSION}:section`;
  return {
    key: buildAnalysisCacheKey(options.paperId, options.sectionId, "wiki-section", sourceSignature),
    scopeId: options.sectionId,
    sourceSignature,
  };
}
