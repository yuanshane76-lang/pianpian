import { buildAnalysisCacheKey } from "./analysis";
import type { DocumentBlock } from "./documentBlocks";

export const OUTLINE_PROTOCOL_VERSION = "outline-v1";
export const OUTLINE_MAX_DEPTH = 3;
export const OUTLINE_MAX_NODES = 40;
export const OUTLINE_MAX_ANCHORS = 2;

export type OutlineNodeKind = "section" | "problem" | "method" | "finding" | "limitation" | "background";

const KINDS: OutlineNodeKind[] = ["section", "problem", "method", "finding", "limitation", "background"];

export interface OutlineAnchor {
  blockId: string;
  pageNumber: number;
  quote: string;
}

export interface OutlineNode {
  id: string;
  title: string;
  summary?: string;
  kind: OutlineNodeKind;
  anchors: OutlineAnchor[];
  /** False when the model named a block that does not exist; the node stays readable but cannot jump. */
  locatable: boolean;
  children: OutlineNode[];
}

export interface OutlineMap {
  title: string;
  nodes: OutlineNode[];
  stats: { total: number; locatable: number; droppedAnchors: number };
}

interface Stats {
  total: number;
  locatable: number;
  droppedAnchors: number;
}

function clean(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maximum);
}

function extractJsonText(text: string): string {
  if (typeof text !== "string" || !text.trim()) throw new Error("模型没有返回大纲内容，请重试");
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
  if (!starts.length) throw new Error("模型返回的大纲结构无法解析，请重试");
  const start = Math.min(...starts);
  const closer = body[start] === "{" ? "}" : "]";
  const end = body.lastIndexOf(closer);
  if (end <= start) throw new Error("模型返回的大纲结构无法解析，请重试");
  const candidate = body.slice(start, end + 1);
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    throw new Error("模型返回的大纲结构无法解析，请重试");
  }
}

function readAnchorIds(source: Record<string, unknown>): unknown[] {
  if (Array.isArray(source.anchorBlockIds)) return source.anchorBlockIds;
  if (Array.isArray(source.anchors)) return source.anchors;
  if (typeof source.anchorBlockId === "string") return [source.anchorBlockId];
  return [];
}

function normalizeKind(value: unknown): OutlineNodeKind {
  return typeof value === "string" && (KINDS as string[]).includes(value) ? value as OutlineNodeKind : "section";
}

function quoteOf(block: DocumentBlock): string {
  return clean(block.text, 160);
}

/**
 * The model only returns block ids; page numbers and quotes are resolved locally so a
 * hallucinated page or coordinate cannot reach the reader.
 */
export function parseOutlineMap(text: string, blocks: DocumentBlock[]): OutlineMap {
  const parsed = JSON.parse(extractJsonText(text)) as unknown;
  const container = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const rawNodes = Array.isArray(parsed)
    ? parsed
    : container && Array.isArray(container.nodes)
      ? container.nodes
      : container && Array.isArray(container.outline)
        ? container.outline
        : [];
  if (!rawNodes.length) throw new Error("模型没有返回可用的大纲节点，请重试");

  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  const stats: Stats = { total: 0, locatable: 0, droppedAnchors: 0 };

  function build(raw: unknown, path: string, depth: number): OutlineNode | null {
    if (stats.total >= OUTLINE_MAX_NODES) return null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const source = raw as Record<string, unknown>;
    const title = clean(source.title, 120);
    if (!title) return null;

    const anchors: OutlineAnchor[] = [];
    const seen = new Set<string>();
    for (const candidate of readAnchorIds(source)) {
      const blockId = typeof candidate === "string" ? candidate.trim() : "";
      if (!blockId || seen.has(blockId)) continue;
      seen.add(blockId);
      const block = blockMap.get(blockId);
      if (!block) {
        stats.droppedAnchors += 1;
        continue;
      }
      anchors.push({ blockId, pageNumber: block.pageNumber, quote: quoteOf(block) });
      if (anchors.length >= OUTLINE_MAX_ANCHORS) break;
    }

    const id = clean(source.id, 40) || path;
    const summary = clean(source.summary, 240);
    const node: OutlineNode = {
      id,
      title,
      ...(summary ? { summary } : {}),
      kind: normalizeKind(source.kind),
      anchors,
      locatable: anchors.length > 0,
      children: [],
    };
    stats.total += 1;
    if (node.locatable) stats.locatable += 1;

    if (depth + 1 < OUTLINE_MAX_DEPTH && Array.isArray(source.children)) {
      const children: OutlineNode[] = [];
      for (const [index, child] of source.children.entries()) {
        const next = build(child, `${path}.${index + 1}`, depth + 1);
        if (next) children.push(next);
        if (stats.total >= OUTLINE_MAX_NODES) break;
      }
      node.children = children;
    }
    return node;
  }

  const nodes: OutlineNode[] = [];
  for (const [index, raw] of rawNodes.entries()) {
    const node = build(raw, String(index + 1), 0);
    if (node) nodes.push(node);
    if (stats.total >= OUTLINE_MAX_NODES) break;
  }
  if (!nodes.length) throw new Error("模型没有返回可用的大纲节点，请重试");
  if (!stats.locatable) throw new Error("模型没有给出可用的原文锚点，请重试");

  const title = container ? clean(container.title, 200) : "";
  return {
    title: title || "文章架构",
    nodes,
    stats,
  };
}

export function buildOutlineCacheIdentity(options: {
  paperId: string;
  serviceIdentity: string;
  documentSignature: string;
}): { key: string; scopeId: string; sourceSignature: string } {
  const scopeId = "paper";
  const sourceSignature = `${options.serviceIdentity}:${options.documentSignature}:${OUTLINE_PROTOCOL_VERSION}`;
  return {
    key: buildAnalysisCacheKey(options.paperId, scopeId, "outline", sourceSignature),
    scopeId,
    sourceSignature,
  };
}
