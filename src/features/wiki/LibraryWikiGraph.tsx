import { drag } from "d3-drag";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type ForceCollide,
  type ForceLink,
  type ForceManyBody,
  type ForceX,
  type ForceY,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import { select, type Selection } from "d3-selection";
import { zoom as createZoom } from "d3-zoom";
import { useEffect, useRef } from "react";
import type { LibraryWikiIndex, LibraryWikiPage } from "../../domain/libraryWiki";

/** 星图显示选项（对齐 Obsidian/Gephi 的常规配置：过滤、力度、显示、编辑）。 */
export interface StarMapSettings {
  showConcept: boolean;
  showMethod: boolean;
  showRelated: boolean;
  /** 隐藏没有任何星座线/关联线的孤星。 */
  hideOrphans: boolean;
  /** 星体大小缩放。 */
  nodeScale: number;
  /** 链接距离缩放。 */
  distanceScale: number;
  /** 节点斥力缩放。 */
  repelScale: number;
  /** 向心引力强度。 */
  gravity: number;
}

export const DEFAULT_STAR_MAP_SETTINGS: StarMapSettings = {
  showConcept: true,
  showMethod: true,
  showRelated: true,
  hideOrphans: false,
  nodeScale: 1,
  distanceScale: 1,
  repelScale: 1,
  gravity: 0.06,
};

interface Props {
  index: LibraryWikiIndex;
  selectedId: string | null;
  /** 显示全部星名；关闭时只给枢纽与高连接度的星。 */
  showAllLabels: boolean;
  settings: StarMapSettings;
  /** 递增以重置布局（清除手动钉住的位置并重新收敛）。 */
  resetSignal: number;
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
  /** mention = 知识星之间的星座线；related = 近似关联线；paper = 论文枢纽与其知识星的星群线。 */
  type: "mention" | "related" | "paper";
}

interface Scene {
  nodes: GraphNode[];
  links: GraphLink[];
  nodeSelection: Selection<SVGGElement, GraphNode, any, unknown>;
  linkSelection: Selection<SVGLineElement, GraphLink, any, unknown>;
  labelWorthy: Set<string>;
  simulation: Simulation<GraphNode, undefined>;
}

/** 确定性伪随机：背景星尘每次渲染位置一致。 */
function seeded(unit: number): number {
  const value = Math.sin(unit * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function truncate(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}

function baseRadius(node: GraphNode): number {
  return node.type === "paper" ? 7 + Math.min(10, node.count * 0.9) : 3.4 + Math.min(6.5, node.count * 1.2);
}

/**
 * 星图：论文是金色枢纽星，它的知识星围绕成星群；知识星之间由星座线相连，
 * 跨论文的共同概念把星群桥接成星座。过滤选项改变结构（重建布局）；
 * 力度/大小滑杆只实时调优力参数不重建；拖拽星体松手钉住。
 */
export function LibraryWikiGraph({ index, selectedId, showAllLabels, settings, resetSignal, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // 过滤影响节点/链接集合，需要重建布局；其余选项实时调优。
  const filtersKey = `${settings.showConcept}|${settings.showMethod}|${settings.showRelated}|${settings.hideOrphans}`;

  // 力/半径访问器实时读取设置 ref，重新赋值即重新初始化。
  const starRadius = (node: GraphNode) => baseRadius(node) * settingsRef.current.nodeScale;
  const linkDistance = (link: GraphLink) =>
    (link.type === "paper" ? 52 : link.type === "related" ? 92 : 78) * settingsRef.current.distanceScale;
  const chargeStrength = (node: GraphNode) => (node.type === "paper" ? -230 : -65) * settingsRef.current.repelScale;

  function applyStarScale(nodeSelection: Selection<SVGGElement, GraphNode, any, unknown>) {
    nodeSelection.select<SVGCircleElement>(".wiki-star-halo").attr("r", (node) => starRadius(node) + 7 + Math.min(12, node.count * 2));
    nodeSelection.select<SVGCircleElement>(".wiki-star-core").attr("r", starRadius);
    nodeSelection.select<SVGCircleElement>(".wiki-star-ring").attr("r", (node) => starRadius(node) + 5);
    nodeSelection.select<SVGTextElement>(".wiki-star-label").attr("y", (node) => starRadius(node) + 13 + Math.min(12, node.count * 2));
  }

  useEffect(() => {
    const svg = svgRef.current;
    const group = groupRef.current;
    if (!svg || !group) return;
    const rect = svg.getBoundingClientRect();
    const width = rect.width || 900;
    const height = rect.height || 640;
    const current = settingsRef.current;

    // 按类型过滤知识星；孤星 = 没有任何星座线/关联线的知识星。
    const connected = new Set<string>();
    for (const [sourceId, targets] of Object.entries(index.links)) {
      if (targets.length) connected.add(sourceId);
      for (const targetId of targets) connected.add(targetId);
    }
    for (const [sourceId, targets] of Object.entries(index.related ?? {})) {
      if (targets.length) connected.add(sourceId);
      for (const targetId of targets) connected.add(targetId);
    }
    const keptPages = index.pages.filter((page) => {
      if (page.kind === "concept" && !current.showConcept) return false;
      if (page.kind !== "concept" && !current.showMethod) return false;
      if (current.hideOrphans && !connected.has(page.id)) return false;
      return true;
    });

    // 论文枢纽：至少留有一个可见知识星才显示。
    const paperCounts = new Map<string, { title: string; count: number }>();
    for (const page of keptPages) {
      for (const occurrence of Object.values(page.occurrences)) {
        const entry = paperCounts.get(occurrence.paperId) ?? { title: occurrence.paperTitle, count: 0 };
        entry.count += 1;
        paperCounts.set(occurrence.paperId, entry);
      }
    }
    const nodes: GraphNode[] = [
      ...keptPages.map((page) => ({
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
    if (current.showRelated) {
      const hasLink = (a: string, b: string) => links.some((link) => link.type !== "paper"
        && (link.source.id === a && link.target.id === b || link.source.id === b && link.target.id === a));
      for (const [sourceId, targets] of Object.entries(index.related ?? {})) {
        for (const targetId of targets) {
          const source = byId.get(sourceId);
          const target = byId.get(targetId);
          if (source && target && !hasLink(sourceId, targetId)) links.push({ source, target, type: "related" });
        }
      }
    }
    for (const page of keptPages) {
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
      star.append("circle").attr("class", "wiki-star-halo");
      star.append("circle").attr("class", "wiki-star-core");
      star.append("circle").attr("class", "wiki-star-ring");
      star.append("text").attr("class", (node) => `wiki-star-label ${node.type === "paper" ? "wiki-star-label-paper" : ""}`)
        .text((node) => truncate(node.title, node.type === "paper" ? 14 : 12));
      return star;
    });
    applyStarScale(nodeSelection);
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

    // 密集星群：短链接 + 弱斥力 + 向心引力。
    const simulation = forceSimulation<GraphNode>(nodes)
      .force("link", forceLink<GraphNode, GraphLink>(links).id((node) => node.id)
        .distance(linkDistance)
        .strength((link) => link.type === "paper" ? 0.7 : link.type === "related" ? 0.15 : 0.35))
      .force("charge", forceManyBody<GraphNode>().strength(chargeStrength))
      .force("collide", forceCollide<GraphNode>((node) => starRadius(node) + 5))
      .force("x", forceX(width / 2).strength(() => settingsRef.current.gravity))
      .force("y", forceY(height / 2).strength(() => settingsRef.current.gravity))
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

    sceneRef.current = { nodes, links, nodeSelection, linkSelection, labelWorthy, simulation };

    return () => {
      simulation.stop();
      select(svg).on(".zoom", null);
      sceneRef.current = null;
    };
  }, [index, filtersKey]);

  // 选中态与标签可见性只更新视觉，不重启布局。
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.nodeSelection.attr("class", (node) => `wiki-star ${node.type === "paper" ? "wiki-star-paper" : node.kind} ${node.id === selectedId ? "is-selected" : ""}`);
    scene.linkSelection.attr("class", (link) => `wiki-star-link wiki-star-link-${link.type} ${link.type !== "paper" && (link.source.id === selectedId || link.target.id === selectedId) ? "is-lit" : ""}`);
    scene.nodeSelection.select<SVGTextElement>(".wiki-star-label")
      .attr("visibility", (node) => (showAllLabels || scene.labelWorthy.has(node.id) ? "visible" : "hidden"));
  }, [selectedId, showAllLabels]);

  // 力度/大小滑杆：重新初始化力参数并轻微加热，不重建布局。
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    applyStarScale(scene.nodeSelection);
    (scene.simulation.force("link") as ForceLink<GraphNode, GraphLink>).distance(linkDistance);
    (scene.simulation.force("charge") as ForceManyBody<GraphNode>).strength(chargeStrength);
    (scene.simulation.force("collide") as ForceCollide<GraphNode>).radius((node: GraphNode) => starRadius(node) + 5);
    (scene.simulation.force("x") as ForceX<GraphNode>).strength(() => settingsRef.current.gravity);
    (scene.simulation.force("y") as ForceY<GraphNode>).strength(() => settingsRef.current.gravity);
    scene.simulation.alpha(0.35).restart();
  }, [settings.nodeScale, settings.distanceScale, settings.repelScale, settings.gravity]);

  // 重置布局：清除拖拽钉住的位置，重新收敛。
  useEffect(() => {
    if (!resetSignal) return;
    const scene = sceneRef.current;
    if (!scene) return;
    for (const node of scene.nodes) {
      node.fx = null;
      node.fy = null;
    }
    scene.simulation.alpha(0.6).restart();
  }, [resetSignal]);

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
