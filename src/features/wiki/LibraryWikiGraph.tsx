import { drag } from "d3-drag";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { select, type Selection } from "d3-selection";
import { zoom as createZoom } from "d3-zoom";
import { useEffect, useRef } from "react";
import type { LibraryWikiIndex, LibraryWikiPage } from "../../domain/libraryWiki";

interface Props {
  index: LibraryWikiIndex;
  selectedId: string | null;
  /** 显示全部星名；关闭时只给枢纽与高连接度的星。 */
  showAllLabels: boolean;
  onSelect: (page: LibraryWikiPage) => void;
}

interface GraphNode extends SimulationNodeDatum {
  id: string;
  /** paper = 论文枢纽星（金色，把它的知识星聚成星群）；page = 知识星。 */
  type: "page" | "paper";
  title: string;
  count: number;
  kind: string;
}

interface GraphLink {
  source: GraphNode;
  target: GraphNode;
  /** mention = 星座线（提及）；related = 近似关联线（标题相近的同类概念）；paper = 星群线。 */
  type: "mention" | "related" | "paper";
}

interface Scene {
  nodes: GraphNode[];
  links: GraphLink[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodeSelection: Selection<SVGGElement, GraphNode, any, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  linkSelection: Selection<SVGLineElement, GraphLink, any, unknown>;
  labelWorthy: Set<string>;
}

/** 确定性伪随机：背景星尘每次渲染位置一致。 */
function seeded(unit: number): number {
  const value = Math.sin(unit * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function truncate(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}

function starRadius(node: GraphNode): number {
  return node.type === "paper" ? 7 + Math.min(10, node.count * 0.9) : 3.4 + Math.min(6.5, node.count * 1.2);
}

/**
 * 星图：论文是金色枢纽星，它的知识星围绕成星群；知识星之间由星座线相连，
 * 跨论文的共同概念把星群桥接成星座。布局只随数据重建，选星/改标签只更新视觉。
 */
export function LibraryWikiGraph({ index, selectedId, showAllLabels, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const svg = svgRef.current;
    const group = groupRef.current;
    if (!svg || !group) return;
    const rect = svg.getBoundingClientRect();
    const width = rect.width || 900;
    const height = rect.height || 640;

    // 论文枢纽：每篇贡献过知识的论文一颗金色星。
    const paperCounts = new Map<string, { title: string; count: number }>();
    for (const page of index.pages) {
      for (const occurrence of Object.values(page.occurrences)) {
        const entry = paperCounts.get(occurrence.paperId) ?? { title: occurrence.paperTitle, count: 0 };
        entry.count += 1;
        paperCounts.set(occurrence.paperId, entry);
      }
    }
    const nodes: GraphNode[] = [
      ...index.pages.map((page) => ({
        id: page.id,
        type: "page" as const,
        title: page.title,
        count: Object.keys(page.occurrences).length,
        kind: page.kind,
      })),
      ...Array.from(paperCounts.entries()).map(([paperId, entry]) => ({
        id: `paper:${paperId}`,
        type: "paper" as const,
        title: entry.title,
        count: entry.count,
        kind: "paper",
      })),
    ];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const links: GraphLink[] = [];
    for (const [sourceId, targets] of Object.entries(index.links)) {
      for (const targetId of targets) {
        const source = byId.get(sourceId);
        const target = byId.get(targetId);
        if (source && target) links.push({ source, target, type: "mention" });
      }
    }
    for (const [sourceId, targets] of Object.entries(index.related ?? {})) {
      for (const targetId of targets) {
        const source = byId.get(sourceId);
        const target = byId.get(targetId);
        if (source && target && !links.some((link) => link.type !== "paper"
          && (link.source.id === sourceId && link.target.id === targetId
            || link.source.id === targetId && link.target.id === sourceId))) {
          links.push({ source, target, type: "related" });
        }
      }
    }
    for (const page of index.pages) {
      const target = byId.get(page.id)!;
      for (const paperId of Object.keys(page.occurrences)) {
        const hub = byId.get(`paper:${paperId}`);
        if (hub) links.push({ source: hub, target, type: "paper" });
      }
    }

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

    const linkSelection = stage.selectAll<SVGLineElement, GraphLink>("line").data(links).join("line")
      .attr("class", (link) => `wiki-star-link wiki-star-link-${link.type}`);

    const nodeSelection = stage.selectAll<SVGGElement, GraphNode>("g.wiki-star").data(nodes).join((enter) => {
      const star = enter.append("g").attr("class", (node) => `wiki-star ${node.type === "paper" ? "wiki-star-paper" : node.kind}`)
        .attr("role", "button")
        .attr("aria-label", (node) => node.type === "paper"
          ? `论文《${node.title}》的星群（${node.count} 个知识点）`
          : `${node.title}（${node.count} 篇论文）`);
      star.append("circle").attr("class", "wiki-star-halo").attr("r", (node) => starRadius(node) + 7 + Math.min(12, node.count * 2));
      star.append("circle").attr("class", "wiki-star-core").attr("r", starRadius);
      star.append("circle").attr("class", "wiki-star-ring").attr("r", 0);
      star.append("text").attr("class", (node) => `wiki-star-label ${node.type === "paper" ? "wiki-star-label-paper" : ""}`)
        .attr("y", (node) => starRadius(node) + 13 + Math.min(12, node.count * 2))
        .text((node) => truncate(node.title, node.type === "paper" ? 14 : 12));
      return star;
    });
    nodeSelection.on("click", (_event, node) => {
      if (node.type === "paper") return;
      const page = index.pages.find((item) => item.id === node.id);
      if (page) onSelectRef.current(page);
    });

    const labelWorthy = new Set<string>(nodes.filter((node) => node.type === "paper").map((node) => node.id));
    const linkedCount: Record<string, number> = {};
    for (const link of links) {
      if (link.type === "paper") continue;
      linkedCount[link.source.id] = (linkedCount[link.source.id] ?? 0) + 1;
      linkedCount[link.target.id] = (linkedCount[link.target.id] ?? 0) + 1;
    }
    for (const node of nodes) {
      if (node.type === "page" && ((linkedCount[node.id] ?? 0) >= 2 || node.count >= 2)) labelWorthy.add(node.id);
    }

    // 密集星群：短链接 + 弱斥力 + 向心引力，星与星群彼此靠拢。
    const simulation = forceSimulation<GraphNode>(nodes)
      .force("link", forceLink<GraphNode, GraphLink>(links).id((node) => node.id)
        .distance((link) => link.type === "paper" ? 52 : link.type === "related" ? 92 : 78)
        .strength((link) => link.type === "paper" ? 0.7 : link.type === "related" ? 0.15 : 0.35))
      .force("charge", forceManyBody<GraphNode>().strength((node) => (node.type === "paper" ? -230 : -65)))
      .force("collide", forceCollide<GraphNode>((node) => starRadius(node) + 5))
      .force("x", forceX(width / 2).strength(0.06))
      .force("y", forceY(height / 2).strength(0.06))
      .force("center", forceCenter(width / 2, height / 2))
      .on("tick", () => {
        linkSelection
          .attr("x1", (link) => link.source.x ?? 0).attr("y1", (link) => link.source.y ?? 0)
          .attr("x2", (link) => link.target.x ?? 0).attr("y2", (link) => link.target.y ?? 0);
        nodeSelection.attr("transform", (node) => `translate(${node.x ?? 0},${node.y ?? 0})`);
      });

    // 基本拖拽：按住星星拖动，松手钉在原地，用户可自行排版星图。
    const dragBehavior = drag<SVGGElement, GraphNode>()
      .on("start", (event, node) => {
        event.sourceEvent.stopPropagation();
        if (!event.active) simulation.alphaTarget(0.25).restart();
        node.fx = node.x;
        node.fy = node.y;
      })
      .on("drag", (event, node) => {
        node.fx = event.x;
        node.fy = event.y;
      })
      .on("end", (event) => {
        if (!event.active) simulation.alphaTarget(0);
      });
    nodeSelection.call(dragBehavior);

    const zoom = createZoom<SVGSVGElement, unknown>().scaleExtent([0.3, 4])
      .on("zoom", (event) => stage.attr("transform", event.transform.toString()));
    select(svg).call(zoom).on("dblclick.zoom", null);

    sceneRef.current = { nodes, links, nodeSelection, linkSelection, labelWorthy };

    return () => {
      simulation.stop();
      select(svg).on(".zoom", null);
      sceneRef.current = null;
    };
  }, [index]);

  // 选中态与标签可见性只更新视觉，不重启布局。
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.nodeSelection.attr("class", (node) => `wiki-star ${node.type === "paper" ? "wiki-star-paper" : node.kind} ${node.id === selectedId ? "is-selected" : ""}`);
    scene.linkSelection.attr("class", (link) => `wiki-star-link wiki-star-link-${link.type} ${link.type !== "paper" && (link.source.id === selectedId || link.target.id === selectedId) ? "is-lit" : ""}`);
    scene.nodeSelection.select<SVGTextElement>(".wiki-star-label")
      .attr("visibility", (node) => (showAllLabels || scene.labelWorthy.has(node.id) ? "visible" : "hidden"));
  }, [selectedId, showAllLabels]);

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
