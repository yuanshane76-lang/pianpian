import { AlertTriangle, ChevronRight, LoaderCircle, Network, RefreshCw, X } from "lucide-react";
import type { OutlineFocusCrumb, OutlineMap, OutlineNode } from "../../domain/outlineMap";
import { OutlineTree } from "./OutlineTree";

interface Props {
  map: OutlineMap | null;
  status: "loading" | "ready" | "error";
  error: string | null;
  focusPath: OutlineFocusCrumb[];
  focusedTitle: string | null;
  selectedId: string | null;
  onSelect: (node: OutlineNode) => void;
  onNavigate: (crumb: OutlineFocusCrumb) => void;
  onEnterSection: (node: OutlineNode) => void;
  onRetrySection: (node: OutlineNode) => void;
  onClose: () => void;
  onRegenerate: () => void;
}

export function OutlineDrawer({
  map, status, error, focusPath, focusedTitle, selectedId,
  onSelect, onNavigate, onEnterSection, onRetrySection, onClose, onRegenerate,
}: Props) {
  const unlocatable = map ? map.stats.total - map.stats.locatable : 0;
  const coveragePercent = map && map.stats.contentBlocks > 0
    ? Math.round((map.stats.coveredBlocks / map.stats.contentBlocks) * 100)
    : null;
  return <aside className="outline-drawer" aria-label="文章架构">
    <header className="outline-drawer-head">
      <div className="outline-drawer-title">
        <Network size={16} />
        <strong>{focusedTitle ?? map?.title ?? "文章架构"}</strong>
        {map && unlocatable > 0 ? <span className="outline-drawer-note">{unlocatable} 个节点未定位</span> : null}
      </div>
      <div className="outline-drawer-actions">
        <button className="icon-button" type="button" aria-label="重新生成文章架构" title={focusedTitle ? "重新生成本章节条目" : "重新生成论证主线"}
          disabled={status === "loading"} onClick={onRegenerate}>
          <RefreshCw size={15} className={status === "loading" ? "spin" : undefined} />
        </button>
        <button className="icon-button" type="button" aria-label="关闭文章架构" title="关闭" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
    </header>
    {map ? <nav className="outline-breadcrumb" aria-label="架构层级">
      {focusPath.map((crumb, index) => <span className="outline-breadcrumb-item" key={crumb.id ?? "root"}>
        {index > 0 ? <ChevronRight size={12} aria-hidden="true" /> : null}
        <button type="button" onClick={() => onNavigate(crumb)} aria-current={index === focusPath.length - 1 ? "page" : undefined}>
          {crumb.title}
        </button>
      </span>)}
    </nav> : null}
    {map ? <div className="outline-drawer-meta">
      <span>已生成 {map.stats.sectionsGenerated}/{map.stats.sectionsTotal} 章</span>
      {coveragePercent !== null ? <span>段落覆盖 {coveragePercent}%</span> : null}
      {map.stats.mergedDuplicates > 0 ? <span>合并重复条目 {map.stats.mergedDuplicates} 个</span> : null}
    </div> : null}
    <div className="outline-drawer-body">
      {status === "loading" && !map ? <div className="outline-status" role="status">
        <LoaderCircle className="spin" size={16} />
        <span>正在提取文章架构…</span>
      </div> : null}
      {status === "error" && !map ? <div className="outline-error" role="alert">
        <AlertTriangle size={16} />
        <span>{error || "文章架构生成失败，请重试。"}</span>
        <button className="text-button" type="button" onClick={onRegenerate}><RefreshCw size={13} />重试</button>
      </div> : null}
      {map ? <OutlineTree
        nodes={map.nodes}
        focusId={focusPath.length > 1 ? focusPath[focusPath.length - 1].id : null}
        selectedId={selectedId}
        onSelect={onSelect}
        onEnterSection={onEnterSection}
        onRetrySection={onRetrySection}
      /> : null}
      {error && map ? <div className="outline-error" role="alert">
        <AlertTriangle size={16} />
        <span>{error}</span>
        <button className="text-button" type="button" onClick={onRegenerate}><RefreshCw size={13} />重试</button>
      </div> : null}
    </div>
  </aside>;
}
