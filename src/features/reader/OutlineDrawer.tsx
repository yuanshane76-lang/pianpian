import { AlertTriangle, LoaderCircle, Network, RefreshCw, X } from "lucide-react";
import type { OutlineMap, OutlineNode } from "../../domain/outlineMap";
import { OutlineTree } from "./OutlineTree";

interface Props {
  map: OutlineMap | null;
  status: "loading" | "ready" | "error";
  error: string | null;
  selectedId: string | null;
  onSelect: (node: OutlineNode) => void;
  onClose: () => void;
  onRegenerate: () => void;
}

export function OutlineDrawer({ map, status, error, selectedId, onSelect, onClose, onRegenerate }: Props) {
  const unlocatable = map ? map.stats.total - map.stats.locatable : 0;
  return <aside className="outline-drawer" aria-label="文章架构">
    <header className="outline-drawer-head">
      <div className="outline-drawer-title">
        <Network size={16} />
        <strong>文章架构</strong>
        {map && unlocatable > 0 ? <span className="outline-drawer-note">{unlocatable} 个节点未定位</span> : null}
      </div>
      <div className="outline-drawer-actions">
        <button className="icon-button" type="button" aria-label="重新生成文章架构" title="重新生成" disabled={status === "loading"} onClick={onRegenerate}>
          <RefreshCw size={15} className={status === "loading" ? "spin" : undefined} />
        </button>
        <button className="icon-button" type="button" aria-label="关闭文章架构" title="关闭" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
    </header>
    <div className="outline-drawer-body">
      {status === "loading" ? <div className="outline-status" role="status">
        <LoaderCircle className="spin" size={16} />
        <span>正在提取文章架构…</span>
      </div> : null}
      {status === "error" ? <div className="outline-error" role="alert">
        <AlertTriangle size={16} />
        <span>{error || "文章架构生成失败，请重试。"}</span>
        <button className="text-button" type="button" onClick={onRegenerate}><RefreshCw size={13} />重试</button>
      </div> : null}
      {status === "ready" && map ? <OutlineTree nodes={map.nodes} selectedId={selectedId} onSelect={onSelect} /> : null}
    </div>
  </aside>;
}
