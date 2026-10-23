import { THREAD_ENTRY_SECTION_ID, type WikiAnchor, type WikiEntry, type WikiPart, type WikiPartTree, type WikiPoint, type WikiRename } from "./paperWiki";

export type OutlineNodeKind = "section" | "problem" | "method" | "finding" | "limitation" | "background" | "concept";

export interface OutlineAnchor extends WikiAnchor {}

export interface OutlineNode {
  id: string;
  title: string;
  summary?: string;
  /** 支撑点才携带条目类型；结构与要点节点不显示类型标签。 */
  kind?: OutlineNodeKind;
  anchors: OutlineAnchor[];
  /** False when the node has no valid block anchor; the node stays readable but cannot jump. */
  locatable: boolean;
  /** 结构/要点节点：不是带锚点的支撑点，不参与“未定位”提示。 */
  structural?: boolean;
  /** 所属部分 id；部分节点指向自己，其余节点指向来源部分。 */
  sectionId?: string;
  /** 部分要点生成中/失败的状态，仅部分节点携带。 */
  sectionState?: "loading" | "error";
  sectionError?: string;
  children: OutlineNode[];
}

export interface OutlineStats {
  total: number;
  locatable: number;
  droppedAnchors: number;
  mergedDuplicates: number;
  sectionsGenerated: number;
  sectionsTotal: number;
  coveredBlocks: number;
  contentBlocks: number;
}

export interface OutlineMap {
  title: string;
  nodes: OutlineNode[];
  stats: OutlineStats;
}

export interface OutlineProjectionInput {
  paperTitle: string;
  threadTitle?: string;
  parts: WikiPart[];
  renames: Record<string, WikiRename>;
  thread: WikiEntry[];
  partTrees: Record<string, WikiPartTree>;
  partStates: Record<string, { state: "loading" | "error"; error?: string }>;
  coverage: { covered: number; total: number };
  droppedAnchors: number;
  mergedDuplicates: number;
}

function pointNode(point: WikiPoint, partId: string): OutlineNode {
  return {
    id: point.id,
    title: point.title,
    ...(point.statement ? { summary: point.statement } : {}),
    kind: point.kind,
    anchors: point.anchors,
    locatable: point.locatable,
    sectionId: partId,
    children: [],
  };
}

function insightNode(insight: { id: string; title: string; statement?: string; points: WikiPoint[] }, partId: string): OutlineNode {
  return {
    id: insight.id,
    title: insight.title,
    ...(insight.statement ? { summary: insight.statement } : {}),
    anchors: [],
    locatable: false,
    structural: true,
    sectionId: partId,
    children: insight.points.map((point) => pointNode(point, partId)),
  };
}

function partNode(part: WikiPart, input: OutlineProjectionInput): OutlineNode {
  const rename = input.renames[part.id];
  const tree = input.partTrees[part.id];
  const state = input.partStates[part.id];
  return {
    id: part.id,
    title: rename?.title || part.title,
    ...(rename?.summary ? { summary: rename.summary } : {}),
    kind: "section",
    anchors: part.headingBlockId
      ? [{ blockId: part.headingBlockId, pageNumber: part.pageNumber ?? 1, quote: part.title }]
      : [],
    locatable: Boolean(part.headingBlockId),
    structural: true,
    sectionId: part.id,
    ...(tree ? {} : state?.state === "error"
      ? { sectionState: "error" as const, sectionError: state.error }
      : { sectionState: "loading" as const }),
    children: tree ? tree.insights.map((insight) => insightNode(insight, part.id)) : [],
  };
}

function countNodes(nodes: OutlineNode[]): { total: number; locatable: number } {
  let total = 0;
  let locatable = 0;
  for (const node of nodes) {
    total += 1;
    if (node.locatable) locatable += 1;
    const childCount = countNodes(node.children);
    total += childCount.total;
    locatable += childCount.locatable;
  }
  return { total, locatable };
}

export function findOutlineNode(nodes: OutlineNode[], id: string | null): OutlineNode | null {
  if (!id) return null;
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = findOutlineNode(node.children, id);
    if (hit) return hit;
  }
  return null;
}

/** 第一层分支（论证主线、各部分）中有子节点的节点 id，用于“默认收起/收起全部”。 */
export function branchIdsWithChildren(nodes: OutlineNode[]): string[] {
  const ids: string[] = [];
  for (const root of nodes) {
    for (const branch of root.children) {
      if (branch.children.length) ids.push(branch.id);
    }
  }
  return ids;
}

/**
 * 投影：把本地大块划分 + 模型要点树组装成思维导图。
 * 根节点 = 论文标题（最终母节点），其下为论证主线分支与各部分（语义标题）；
 * 要点挂部分之下，支撑点挂要点之下。
 */
export function projectOutlineMap(input: OutlineProjectionInput): OutlineMap {
  const threadBranch: OutlineNode = {
    id: "thread-branch",
    title: "论证主线",
    kind: "section",
    anchors: [],
    locatable: false,
    structural: true,
    sectionId: THREAD_ENTRY_SECTION_ID,
    children: input.thread.map((entry) => ({
      id: entry.id,
      title: entry.title,
      ...(entry.statement ? { summary: entry.statement } : {}),
      kind: entry.kind,
      anchors: entry.anchors,
      locatable: entry.locatable,
      sectionId: THREAD_ENTRY_SECTION_ID,
      children: [],
    })),
  };
  const branches = [
    ...(input.thread.length ? [threadBranch] : []),
    ...input.parts.map((part) => partNode(part, input)),
  ];
  const root: OutlineNode = {
    id: "paper-root",
    title: input.threadTitle?.trim() || input.paperTitle || "文章架构",
    kind: "section",
    anchors: [],
    locatable: false,
    structural: true,
    children: branches,
  };
  const counts = countNodes([root]);
  return {
    title: root.title,
    nodes: [root],
    stats: {
      total: counts.total,
      locatable: counts.locatable,
      droppedAnchors: input.droppedAnchors,
      mergedDuplicates: input.mergedDuplicates,
      sectionsGenerated: input.parts.filter((part) => Boolean(input.partTrees[part.id])).length,
      sectionsTotal: input.parts.length,
      coveredBlocks: input.coverage.covered,
      contentBlocks: input.coverage.total,
    },
  };
}
