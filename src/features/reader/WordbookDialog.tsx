import { BookMarked, Check, ExternalLink, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WordbookEntry, WordbookSource } from "../../domain/wordbook";

export function WordbookDialog({ entries, error, onClose, onRemove, onToggleMastered, onJump, canJump, onRetry }: {
  entries: WordbookEntry[]; error: string | null; onClose: () => void;
  onRemove: (id: string) => void; onToggleMastered: (id: string) => void;
  onJump: (source: WordbookSource) => void; canJump: (source: WordbookSource) => boolean; onRetry: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current!;
    const surfaces = [...document.querySelectorAll<HTMLElement>(".reader-shell, .workspace-shell")];
    const previousInert = surfaces.map((surface) => surface.inert);
    surfaces.forEach((surface) => { surface.inert = true; });
    dialog.querySelector<HTMLInputElement>("input")?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    dialog.addEventListener("keydown", keyboard);
    return () => {
      dialog.removeEventListener("keydown", keyboard);
      surfaces.forEach((surface, index) => { surface.inert = previousInert[index]; });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  const visible = entries.filter((entry) => (filter === "all" || entry.mastered === (filter === "mastered")) &&
    `${entry.term} ${entry.translation} ${entry.definition} ${entry.sources.map((source) => source.paperTitle).join(" ")}`
      .toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="settings-overlay wordbook-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="wordbook-dialog" role="dialog" aria-modal="true" aria-label="单词表">
      <header className="settings-header"><div><BookMarked size={18} /><h2>单词表</h2><span className="wordbook-total">{entries.length} 个</span></div>
        <button type="button" className="icon-button" aria-label="关闭单词表" title="关闭单词表" onClick={onClose}><X size={18} /></button></header>
      <div className="wordbook-controls">
        <label className="vocabulary-search"><Search size={16} /><input aria-label="搜索单词表" placeholder="搜索英文、中文或论文" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="wordbook-filter"><span className="sr-only">掌握状态</span><select aria-label="掌握状态" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">全部词汇</option><option value="learning">待熟悉</option><option value="mastered">已掌握</option>
        </select></label>
      </div>
      {error ? <div className="wordbook-error" role="alert">{error}<button type="button" className="text-button" onClick={onRetry}><RotateCcw size={14} />重试读取</button></div> : null}
      <div className="wordbook-scroll">
        {visible.length ? visible.map((entry) => <article className="wordbook-entry" key={entry.id}>
          <div className="wordbook-entry-heading"><div><strong>{entry.term}</strong><span className="vocabulary-meaning">{entry.translation}</span></div>
            <div className="wordbook-entry-actions">
              <button type="button" className={`icon-button ${entry.mastered ? "is-mastered" : ""}`} aria-pressed={entry.mastered}
                aria-label={`将 ${entry.term} 标记为${entry.mastered ? "待熟悉" : "已掌握"}`} title={entry.mastered ? "已掌握，点击改为待熟悉" : "标记为已掌握"}
                onClick={() => onToggleMastered(entry.id)}><Check size={17} /></button>
              <button type="button" className="icon-button" aria-label={`从单词表移除 ${entry.term}`} title="移除词汇" onClick={() => onRemove(entry.id)}><Trash2 size={16} /></button>
            </div></div>
          <p className="wordbook-definition">{entry.definition}</p>
          <div className="wordbook-sources">{entry.sources.map((source) => <div className="wordbook-source" key={`${source.paperId}:${source.blockId}:${source.contentSignature}`}>
            <p lang="en">{source.example}</p>
            <button type="button" className="text-button" disabled={!canJump(source)} onClick={() => onJump(source)}>
              <ExternalLink size={13} /><span>{source.paperTitle} · 第 {source.pageNumber} 页{!canJump(source) ? " · 原文不可用" : ""}</span>
            </button>
          </div>)}</div>
        </article>) : <div className="wordbook-empty"><BookMarked size={28} /><p>{entries.length ? "没有匹配的词汇" : "暂无收藏"}</p></div>}
      </div>
    </section>
  </div>;
}
