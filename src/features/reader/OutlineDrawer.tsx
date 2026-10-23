import { useMemo, useState } from "react";
import { AlertTriangle, FoldHorizontal, LoaderCircle, Network, RefreshCw, UnfoldVertical, X } from "lucide-react";
import { branchIdsWithChildren, type OutlineMap, type OutlineNode } from "../../domain/outlineMap";
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
  const rootNodeKey = map ? map.nodes.map((node) => node.id).join(",") : "";
  const collapsible = useMemo(() => (map ? branchIdsWithChildren(map.nodes) : []), [map]);
  // 默认收起要在首帧同步生效（不经过 effect）：否则打开面板的第一次视口适配发生在
  // “全展开”状态上，算出极小缩放后才收起，图会缩成一团。
  const [collapseState, setCollapseState] = useState<{ key: string; ids: Set<string> }>({ key: "", ids: new Set() });
  const collapsed = collapseState.key === rootNodeKey ? collapseState.ids : new Set(collapsible);

  function updateCollapsed(ids: Set<string>) {
    setCollapseState({ key: rootNodeKey, ids });
  }

  function toggle(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id); else next.add(id);
    updateCollapsed(next);
  }

  const unlocatable = map ? map.stats.total - map.stats.locatable : 0;
  const coveragePercent = map && map.stats.contentBlocks > 0
    ? Math.round((map.stats.coveredBlocks / map.stats.contentBlocks) * 100)
    : null;
  const generating = progress !== null;

  return <aside className="outline-drawer" aria-label="文章架构">
    <header className="outline-drawer-head">
      <div className="outline-drawer-title">
        <Network size={16} />
        <strong>{map?.title ?? "文章架构"}</strong>
        {map && unlocatable > 0 ? <span className="outline-drawer-note">{unlocatable} 个节点未定位</span> : null}
      </div>
      <div className="outline-drawer-actions">
        <button className="icon-button" type="button" aria-label="重新生成文章架构" title="重新生成全部条目"
          disabled={status === "loading" || generating} onClick={onRegenerate}>
          <RefreshCw size={15} className={status === "loading" || generating ? "spin" : undefined} />
        </button>
        <button className="icon-button" type="button" aria-label="关闭文章架构" title="关闭" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
    </header>
    {map ? <div className="outline-drawer-meta">
      <span>已生成 {map.stats.sectionsGenerated}/{map.stats.sectionsTotal} 部分</span>
      {coveragePercent !== null ? <span>段落覆盖 {coveragePercent}%</span> : null}
      {map.stats.mergedDuplicates > 0 ? <span>合并重复 {map.stats.mergedDuplicates} 个</span> : null}
      {generating ? <span className="outline-drawer-progress">
        <LoaderCircle className="spin" size={11} /> 正在提炼 {progress.done}/{progress.total}
      </span> : collapsible.length ? <span className="outline-drawer-fold">
        <button className="text-button" type="button" onClick={() => updateCollapsed(new Set())}>
          <UnfoldVertical size={12} />展开全部
        </button>
        <button className="text-button" type="button" onClick={() => updateCollapsed(new Set(collapsible))}>
          <FoldHorizontal size={12} />收起全部
        </button>
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
        collapsed={collapsed}
        onToggle={toggle}
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
