import { flattenSections, THREAD_ENTRY_SECTION_ID, type WikiAnchor, type WikiEntry, type WikiSection } from "./paperWiki";

export type OutlineNodeKind = "section" | "problem" | "method" | "finding" | "limitation" | "background" | "concept";

export interface OutlineAnchor extends WikiAnchor {}

export interface OutlineNode {
  id: string;
  title: string;
  summary?: string;
  kind: OutlineNodeKind;
  anchors: OutlineAnchor[];
  /** False when the node has no valid block anchor; the node stays readable but cannot jump. */
  locatable: boolean;
  /** 结构节点（主线/章节分支、章节骨架），不是模型条目，不参与“未定位”提示。 */
  structural?: boolean;
  /** 所属章节；章节节点指向自己，条目节点指向来源章节。 */
  sectionId?: string;
  /** 章节条目生成中/失败的状态，仅章节节点携带；一次性全量生成下没有“待生成”。 */
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
  sections: WikiSection[];
  threadEntries: WikiEntry[];
  sectionEntries: Record<string, WikiEntry[]>;
  sectionStates: Record<string, { state: "loading" | "error"; error?: string }>;
  coverage: { covered: number; total: number };
  droppedAnchors: number;
  mergedDuplicates: number;
}

function entryNode(entry: WikiEntry): OutlineNode {
  return {
    id: entry.id,
    title: entry.title,
    ...(entry.statement ? { summary: entry.statement } : {}),
    kind: entry.kind,
    anchors: entry.anchors,
    locatable: entry.locatable,
    sectionId: entry.sectionId === THREAD_ENTRY_SECTION_ID ? undefined : entry.sectionId,
    children: [],
  };
}

function sectionNode(section: WikiSection, input: OutlineProjectionInput): OutlineNode {
  const entries = input.sectionEntries[section.id] ?? [];
  const state = input.sectionStates[section.id];
  const children = [
    ...section.children.map((child) => sectionNode(child, input)),
    ...entries.map(entryNode),
  ];
  return {
    id: section.id,
    title: section.title,
    kind: "section",
    anchors: section.headingBlockId
      ? [{ blockId: section.headingBlockId, pageNumber: section.pageNumber ?? 1, quote: section.title }]
      : [],
    locatable: Boolean(section.headingBlockId),
    structural: true,
    sectionId: section.id,
    ...(entries.length ? {} : state?.state === "error"
      ? { sectionState: "error" as const, sectionError: state.error }
      : { sectionState: "loading" as const }),
    children,
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

/**
 * 投影：把本地骨架 + 模型条目组装成思维导图树。视图无关，领域层不依赖渲染。
 * 顶层 = 论证主线分支 + 各一级章节；全量生成期间章节保持“生成中”直至条目就位。
 */
export function projectOutlineMap(input: OutlineProjectionInput): OutlineMap {
  const threadBranch: OutlineNode = {
    id: "thread-branch",
    title: "论证主线",
    kind: "section",
    anchors: [],
    locatable: false,
    structural: true,
    children: input.threadEntries.map(entryNode),
  };
  const nodes = [
    ...(input.threadEntries.length ? [threadBranch] : []),
    ...input.sections.map((section) => sectionNode(section, input)),
  ];
  const counts = countNodes(nodes);
  const flat = flattenSections(input.sections);
  return {
    title: input.threadTitle?.trim() || input.paperTitle || "文章架构",
    nodes,
    stats: {
      total: counts.total,
      locatable: counts.locatable,
      droppedAnchors: input.droppedAnchors,
      mergedDuplicates: input.mergedDuplicates,
      sectionsGenerated: flat.filter((section) => Boolean(input.sectionEntries[section.id]?.length)).length,
      sectionsTotal: flat.length,
      coveredBlocks: input.coverage.covered,
      contentBlocks: input.coverage.total,
    },
  };
}
