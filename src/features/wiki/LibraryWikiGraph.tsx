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

const KIND_LABEL: Record<string, string> = { concept: "概念", method: "方法" };

function truncate(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}

/** 化用 Obsidian 图谱：节点为知识页（大小随出现论文数），连线为双链，点击选中页面。 */
export function LibraryWikiGraph({ index, selectedId, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const groupRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const group = groupRef.current;
    if (!svg || !group) return;
    const rect = svg.getBoundingClientRect();
    const width = rect.width || 800;
    const height = rect.height || 600;

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
    const linkSelection = select(group).selectAll<SVGLineElement, { source: GraphNode; target: GraphNode }>("line").data(links).join("line")
      .attr("class", "wiki-graph-link");
    const nodeSelection = select(group).selectAll<SVGGElement, GraphNode>("g").data(nodes).join("g")
      .attr("class", (node) => `wiki-graph-node ${node.kind} ${node.id === selectedId ? "is-selected" : ""}`)
      .attr("role", "button")
      .attr("aria-label", (node) => `${node.title}（${KIND_LABEL[node.kind] ?? node.kind}，${node.count} 篇论文）`);

    const simulation = forceSimulation<GraphNode>(nodes)
      .force("link", forceLink<GraphNode, { source: GraphNode; target: GraphNode }>(links)
        .id((node) => node.id).distance(90).strength(0.4))
      .force("charge", forceManyBody<GraphNode>().strength(-160))
      .force("collide", forceCollide<GraphNode>((node) => 12 + Math.min(14, node.count * 3)))
      .force("center", forceCenter(width / 2, height / 2))
      .on("tick", () => {
        linkSelection
          .attr("x1", (link) => link.source.x ?? 0).attr("y1", (link) => link.source.y ?? 0)
          .attr("x2", (link) => link.target.x ?? 0).attr("y2", (link) => link.target.y ?? 0);
        nodeSelection.attr("transform", (node) => `translate(${node.x ?? 0},${node.y ?? 0})`);
      });

    nodeSelection.append("circle").attr("r", (node) => 7 + Math.min(12, node.count * 2.5));
    nodeSelection.append("text")
      .attr("class", "wiki-graph-label")
      .attr("y", (node) => 13 + Math.min(12, node.count * 2.5))
      .text((node) => truncate(node.title, 12));
    nodeSelection.on("click", (_event, node) => {
      const page = index.pages.find((item) => item.id === node.id);
      if (page) onSelect(page);
    });

    const zoom = createZoom<SVGSVGElement, unknown>().scaleExtent([0.3, 3])
      .on("zoom", (event) => select(group).attr("transform", event.transform.toString()));
    select(svg).call(zoom).on("dblclick.zoom", null);

    return () => {
      simulation.stop();
      select(svg).on(".zoom", null);
    };
  }, [index, selectedId, onSelect]);

  return <svg ref={svgRef} className="wiki-graph" role="img" aria-label="论文知识库图谱">
    <g ref={groupRef} />
  </svg>;
}
