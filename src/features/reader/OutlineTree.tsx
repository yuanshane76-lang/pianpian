import { hierarchy, tree } from "d3-hierarchy";
import { select } from "d3-selection";
import { zoom as createZoom, zoomIdentity } from "d3-zoom";
import { useEffect, useRef } from "react";
import type { OutlineNode, OutlineNodeKind } from "../../domain/outlineMap";

interface Props {
  nodes: OutlineNode[];
  selectedId: string | null;
  /** 需要收起子树的节点 id 集合（支撑点默认收起，由抽屉层管理）。 */
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  /** 批量生成完成等需要重新适配视口的时机，由上层递增。 */
  fitSignal: number;
  onSelect: (node: OutlineNode) => void;
  onRetrySection: (node: OutlineNode) => void;
}

interface TreeDatum {
  id: string;
  node: OutlineNode | null;
  children: TreeDatum[];
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 50;
const ROW_GAP = 56;
const COLUMN_GAP = 280;

const KIND_LABEL: Record<OutlineNodeKind, string> = {
  section: "章节",
  problem: "问题",
  method: "方法",
  finding: "发现",
  limitation: "局限",
  background: "背景",
  concept: "概念",
};

function truncate(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}

function visibleChildren(nodes: OutlineNode[], collapsed: Set<string>): TreeDatum[] {
  return nodes.map((node) => ({
    id: node.id,
    node,
    children: collapsed.has(node.id) ? [] : visibleChildren(node.children, collapsed),
  }));
}

function linkPath(source: { x: number; y: number }, target: { x: number; y: number }): string {
  const x1 = source.y + NODE_WIDTH;
  const y1 = source.x;
  const x2 = target.y;
  const y2 = target.x;
  const middle = (x1 + x2) / 2;
  return `M${x1},${y1}C${middle},${y1} ${middle},${y2} ${x2},${y2}`;
}

export function OutlineTree({ nodes, selectedId, collapsed, onToggle, fitSignal, onSelect, onRetrySection }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const rootNodeKey = nodes.map((node) => node.id).join(",");

  const layout = (() => {
    const rootDatum: TreeDatum = { id: "__root__", node: null, children: visibleChildren(nodes, collapsed) };
    const root = hierarchy<TreeDatum>(rootDatum, (datum) => datum.children);
    const engine = tree<TreeDatum>().nodeSize([ROW_GAP, COLUMN_GAP]);
    const laid = engine(root);
    return {
      points: laid.descendants().filter((point) => point.data.node),
      links: laid.links().filter((link) => link.source.data.node),
    };
  })();

  useEffect(() => {
    const svg = svgRef.current;
    const group = groupRef.current;
    if (!svg || !group) return;
    const zoom = createZoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 2.2])
      .on("zoom", (event) => {
        select(group).attr("transform", event.transform.toString());
      });
    const selection = select(svg);
    selection.call(zoom).on("dblclick.zoom", null);

    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && layout.points.length) {
      const xs = layout.points.map((point) => point.x);
      const ys = layout.points.map((point) => point.y);
      const minX = Math.min(...xs) - NODE_HEIGHT;
      const maxX = Math.max(...xs) + NODE_HEIGHT;
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys) + NODE_WIDTH;
      const contentWidth = maxY - minY + 64;
      const contentHeight = maxX - minX + 64;
      const scale = Math.max(0.05, Math.min(1, (rect.width - 24) / contentWidth, (rect.height - 24) / contentHeight));
      const translateX = (rect.width - contentWidth * scale) / 2 - minY * scale + 12;
      const translateY = (rect.height - contentHeight * scale) / 2 - minX * scale + 12;
      selection.call(zoom.transform, zoomIdentity.translate(translateX, translateY).scale(scale));
    }
    return () => { selection.on(".zoom", null); };
    // 顶层结构变化或全量生成完成时重新适配视口；折叠展开和要点陆续就位保持当前视口。
  }, [rootNodeKey, fitSignal]);

  return <svg ref={svgRef} className="outline-tree" role="img" aria-label="文章架构思维导图">
    <g ref={groupRef}>
      {layout.links.map((link) => <path
        key={`${link.source.data.id}->${link.target.data.id}`}
        className="outline-link"
        d={linkPath(link.source, link.target)}
      />)}
      {layout.points.map((point) => {
        const node = point.data.node!;
        const selected = node.id === selectedId;
        const hasChildren = node.children.length > 0;
        const isCollapsed = collapsed.has(node.id);
        const secondLine = node.sectionState === "loading"
          ? "要点生成中…"
          : node.sectionState === "error"
            ? "生成失败 · 点击重试"
            : node.kind
              ? KIND_LABEL[node.kind] + (node.structural || node.locatable ? "" : " · 未定位")
              : truncate(node.summary ?? "", 22);
        return <g
          key={node.id}
          className={`outline-node ${selected ? "is-selected" : ""} ${node.structural ? "is-structural" : ""} `
            + `${node.locatable ? "" : "is-unlocatable"} ${node.sectionState ? `is-${node.sectionState}` : ""}`}
          transform={`translate(${point.y},${point.x})`}
          onClick={() => {
            if (node.sectionState === "error") onRetrySection(node);
            else onSelect(node);
          }}
        >
          <title>{[node.title, node.summary].filter(Boolean).join("\n")}</title>
          <rect x={0} y={-NODE_HEIGHT / 2} width={NODE_WIDTH} height={NODE_HEIGHT} rx={8} />
          <text className="outline-node-title" x={12} y={-3}>{truncate(node.title, 20)}</text>
          <text className="outline-node-kind" x={12} y={15}>{secondLine}</text>
          {hasChildren ? <g
            className="outline-node-toggle"
            onClick={(event) => { event.stopPropagation(); onToggle(node.id); }}
          >
            <circle cx={NODE_WIDTH - 18} cy={0} r={9} />
            <text x={NODE_WIDTH - 18} y={4}>{isCollapsed ? "+" : "−"}</text>
          </g> : null}
        </g>;
      })}
      {!layout.points.length ? <text className="outline-tree-empty" x={24} y={40}>
        还没有可展示的架构
      </text> : null}
    </g>
  </svg>;
}
