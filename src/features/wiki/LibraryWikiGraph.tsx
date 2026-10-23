import { forceCenter, forceLink, forceManyBody, forceSimulation, forceCollide, type SimulationNodeDatum } from "d3-force";
import { select } from "d3-selection";
import { zoom as createZoom } from "d3-zoom";
import { useEffect, useRef } from "react";
import type { LibraryWikiIndex, LibraryWikiPage } from "../../domain/libraryWiki";

interface Props {
  index: LibraryWikiIndex;
  selectedId: string | null;
  onSelect: (page: LibraryWikiPage) => void;
}

interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  count: number;
  kind: string;
}

/** 星图视觉参数 */
const STAR_COLORS: Record<string, { core: string; halo: string }> = {
  concept: { core: "#bae6fd", halo: "#38bdf8" },
  method: { core: "#ddd6fe", halo: "#8b5cf6" },
};

/** 确定性伪随机：背景星尘每次渲染位置一致。 */
function seeded(unit: number): number {
  const value = Math.sin(unit * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function truncate(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}

/** 星图：知识页是发光的星（大小随论文数、双色分概念/方法），链接是星座线。 */
export function LibraryWikiGraph({ index, selectedId, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const groupRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const group = groupRef.current;
    if (!svg || !group) return;
    const rect = svg.getBoundingClientRect();
    const width = rect.width || 900;
    const height = rect.height || 640;

    const nodes: GraphNode[] = index.pages.map((page) => ({
      id: page.id,
      title: page.title,
      count: Object.keys(page.occurrences).length,
      kind: page.kind,
    }));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const links = Object.entries(index.links).flatMap(([source, targets]) =>
      targets.map((target) => ({ source: byId.get(source), target: byId.get(target) }))
        .filter((link): link is { source: GraphNode; target: GraphNode } => Boolean(link.source) && Boolean(link.target)),
    );

    group.textContent = "";
    const stage = select(group);

    // 背景星尘：深空氛围，低亮度微闪。
    const dustCount = Math.round((width * height) / 9000);
    const dust = stage.append("g").attr("class", "wiki-star-dust");
    for (let i = 0; i < dustCount; i += 1) {
      dust.append("circle")
        .attr("cx", seeded(i) * width)
        .attr("cy", seeded(i + 0.73) * height)
        .attr("r", 0.6 + seeded(i + 1.41) * 1.3)
        .attr("class", "wiki-star-dust-dot")
        .style("animation-delay", `${(seeded(i + 2.17) * 6).toFixed(2)}s`)
        .style("animation-duration", `${(2.6 + seeded(i + 3.29) * 4).toFixed(2)}s`);
    }

    const linkSelection = stage.selectAll<SVGLineElement, { source: GraphNode; target: GraphNode }>("line").data(links).join("line")
      .attr("class", (link) => `wiki-star-link ${link.source.id === selectedId || link.target.id === selectedId ? "is-lit" : ""}`);

    const nodeSelection = stage.selectAll<SVGGElement, GraphNode>("g.wiki-star").data(nodes).join((enter) => {
      const star = enter.append("g").attr("class", (node) => `wiki-star ${node.kind} ${node.id === selectedId ? "is-selected" : ""}`)
        .attr("role", "button")
        .attr("aria-label", (node) => `${node.title}（${node.count} 篇论文）`);
      star.append("circle").attr("class", "wiki-star-halo")
        .attr("r", (node) => 10 + Math.min(16, node.count * 3));
      star.append("circle").attr("class", "wiki-star-core")
        .attr("r", (node) => 3.2 + Math.min(6, node.count * 1.1));
      star.append("circle").attr("class", "wiki-star-ring").attr("r", 0);
      star.append("text").attr("class", "wiki-star-label")
        .attr("y", (node) => 16 + Math.min(16, node.count * 3))
        .text((node) => truncate(node.title, 12));
      return star;
    });

    // 标签只给高链接度或选中的星，其余悬停显示，保持星图疏朗。
    const labelWorthy = new Set<string>([...(selectedId ? [selectedId] : [])]);
    const linkedCount: Record<string, number> = {};
    for (const link of links) {
      linkedCount[link.source.id] = (linkedCount[link.source.id] ?? 0) + 1;
      linkedCount[link.target.id] = (linkedCount[link.target.id] ?? 0) + 1;
    }
    for (const node of nodes) {
      if ((linkedCount[node.id] ?? 0) >= 2 || node.count >= 2) labelWorthy.add(node.id);
    }
    nodeSelection.select<SVGTextElement>(".wiki-star-label")
      .attr("aria-hidden", null)
      .attr("visibility", (node) => (labelWorthy.has(node.id) ? "visible" : "hidden"));

    nodeSelection.attr("aria-current", (node) => (node.id === selectedId ? "true" : null));
    nodeSelection.on("click", (_event, node) => {
      const page = index.pages.find((item) => item.id === node.id);
      if (page) onSelect(page);
    });

    const simulation = forceSimulation<GraphNode>(nodes)
      .force("link", forceLink<GraphNode, { source: GraphNode; target: GraphNode }>(links)
        .id((node) => node.id).distance(120).strength(0.35))
      .force("charge", forceManyBody<GraphNode>().strength(-220))
      .force("collide", forceCollide<GraphNode>((node) => 16 + Math.min(16, node.count * 3)))
      .force("center", forceCenter(width / 2, height / 2))
      .on("tick", () => {
        linkSelection
          .attr("x1", (link) => link.source.x ?? 0).attr("y1", (link) => link.source.y ?? 0)
          .attr("x2", (link) => link.target.x ?? 0).attr("y2", (link) => link.target.y ?? 0);
        nodeSelection.attr("transform", (node) => `translate(${node.x ?? 0},${node.y ?? 0})`);
      });

    const zoom = createZoom<SVGSVGElement, unknown>().scaleExtent([0.35, 4])
      .on("zoom", (event) => stage.attr("transform", event.transform.toString()));
    select(svg).call(zoom).on("dblclick.zoom", null);

    return () => {
      simulation.stop();
      select(svg).on(".zoom", null);
    };
  }, [index, selectedId, onSelect]);

  return <svg ref={svgRef} className="wiki-graph" role="img" aria-label="论文知识库星图">
    <defs>
      <filter id="wiki-star-glow" x="-120%" y="-120%" width="340%" height="340%">
        <feGaussianBlur stdDeviation="5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <g ref={groupRef} />
  </svg>;
}
