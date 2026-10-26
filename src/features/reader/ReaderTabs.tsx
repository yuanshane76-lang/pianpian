import { Plus, X } from "lucide-react";

export interface ReaderTabItem {
  id: string;
  title: string;
  /** 解析状态：ready 就绪 / pending 解析中 / failed 失败。 */
  status: "ready" | "pending" | "failed";
}

interface Props {
  tabs: ReaderTabItem[];
  activeId: string;
  onSelect: (paperId: string) => void;
  onClose: (paperId: string) => void;
  /** 加号新建：模仿浏览器，去文献库挑选一篇打开。 */
  onAdd: () => void;
}

/** 阅读器标签条：常显；中键或 × 关闭，加号前往文献库开新论文。 */
export function ReaderTabs({ tabs, activeId, onSelect, onClose, onAdd }: Props) {
  return <nav className="reader-tabs" aria-label="打开的论文标签">
    {tabs.map((tab) => {
      const active = tab.id === activeId;
      return <div
        key={tab.id}
        className={`reader-tab ${active ? "is-active" : ""}`}
        aria-current={active ? "true" : undefined}
        title={tab.title}
        onClick={() => onSelect(tab.id)}
        onDoubleClick={(event) => {
          event.preventDefault();
          onClose(tab.id);
        }}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            onClose(tab.id);
          }
        }}
      >
        <span className={`reader-tab-status is-${tab.status}`} aria-hidden="true" />
        <span className="reader-tab-title">{tab.title}</span>
        <button
          type="button"
          className="reader-tab-close"
          aria-label={`关闭 ${tab.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onClose(tab.id);
          }}
        >
          <X size={12} />
        </button>
      </div>;
    })}
    <button type="button" className="reader-tab-add" aria-label="打开新论文" title="打开新论文（前往文献库）" onClick={onAdd}>
      <Plus size={14} />
    </button>
  </nav>;
}
