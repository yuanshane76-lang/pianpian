import { AlertTriangle, LoaderCircle, Network, RefreshCw, X } from "lucide-react";
import type { OutlineMap, OutlineNode } from "../../domain/outlineMap";
import { OutlineTree } from "./OutlineTree";

interface Props {
  map: OutlineMap | null;
  status: "loading" | "ready" | "error";
  error: string | null;
  /** 全量生成进度；null 表示不在生成中。 */
  progress: { done: number; total: number } | null;
  fitSignal: number;
  selectedId: string | null;
  onSelect: (node: OutlineNode) => void;
  onRetrySection: (node: OutlineNode) => void;
  onClose: () => void;
  onRegenerate: () => void;
}

export function OutlineDrawer({
  map, status, error, progress, fitSignal, selectedId, onSelect, onRetrySection, onClose, onRegenerate,
}: Props) {
  const unlocatable = map ? map.stats.total - map.stats.locatable : 0;
  const coveragePercent = map && map.stats.contentBlocks > 0
    ? Math.round((map.stats.coveredBlocks / map.stats.contentBlocks) * 100)
    : null;
  return <aside className="outline-drawer" aria-label="文章架构">
    <header className="outline-drawer-head">
      <div className="outline-drawer-title">
        <Network size={16} />
        <strong>{map?.title ?? "文章架构"}</strong>
        {map && unlocatable > 0 ? <span className="outline-drawer-note">{unlocatable} 个节点未定位</span> : null}
      </div>
      <div className="outline-drawer-actions">
        <button className="icon-button" type="button" aria-label="重新生成文章架构" title="重新生成全部条目"
          disabled={status === "loading" || progress !== null} onClick={onRegenerate}>
          <RefreshCw size={15} className={status === "loading" || progress !== null ? "spin" : undefined} />
        </button>
        <button className="icon-button" type="button" aria-label="关闭文章架构" title="关闭" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
    </header>
    {map ? <div className="outline-drawer-meta">
      <span>已生成 {map.stats.sectionsGenerated}/{map.stats.sectionsTotal} 章</span>
      {coveragePercent !== null ? <span>段落覆盖 {coveragePercent}%</span> : null}
      {map.stats.mergedDuplicates > 0 ? <span>合并重复条目 {map.stats.mergedDuplicates} 个</span> : null}
      {progress ? <span className="outline-drawer-progress">
        <LoaderCircle className="spin" size={11} /> 正在提炼章节条目 {progress.done}/{progress.total}
      </span> : null}
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
        selectedId={selectedId}
        fitSignal={fitSignal}
        onSelect={onSelect}
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
