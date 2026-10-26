import { X } from "lucide-react";

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
}

/** 阅读器多标签条：两篇及以上才显示，中键或 × 关闭。 */
export function ReaderTabs({ tabs, activeId, onSelect, onClose }: Props) {
  if (tabs.length < 2) return null;
  return <div className="reader-tabs" role="tablist" aria-label="打开的论文标签">
    {tabs.map((tab) => {
      const active = tab.id === activeId;
      return <div
        key={tab.id}
        role="tab"
        aria-selected={active}
        tabIndex={0}
        className={`reader-tab ${active ? "is-active" : ""}`}
        title={tab.title}
        onClick={() => onSelect(tab.id)}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            onClose(tab.id);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(tab.id);
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
  </div>;
}
