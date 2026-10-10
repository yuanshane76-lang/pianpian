import { useMemo, useState } from "react";
import { ArrowUpRight, BookmarkPlus, Check, LoaderCircle, Search, Sparkles } from "lucide-react";
import type { AcademicTerm } from "../../domain/vocabulary";

export function VocabularyPanel({ terms, onJump, onGuide, aiAvailable, busy, enriched, guideOverview, loading, hasParagraph, pageNumber, onSaveTerm, isTermSaved, error }: {
  terms: AcademicTerm[]; onJump: (blockId: string) => void; onGuide: () => void; aiAvailable: boolean; busy: boolean; enriched: boolean; guideOverview?: string; loading?: boolean; hasParagraph?: boolean; pageNumber?: number;
  onSaveTerm?: (term: AcademicTerm) => void; isTermSaved?: (term: AcademicTerm) => boolean; error?: string | null;
}) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => terms.filter((term) => `${term.term} ${term.translation}`.toLowerCase().includes(query.trim().toLowerCase())), [terms, query]);
  return <div className="vocabulary-panel">
    <div className="vocabulary-intro"><strong>当前段落词汇{hasParagraph && pageNumber ? ` · 第 ${pageNumber} 页` : ""}</strong>
      {guideOverview ? <p>{guideOverview}</p> : null}
      {!enriched ? <button className="text-button" disabled={busy || !hasParagraph} onClick={onGuide}>
        {loading ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}
        {loading ? "正在挑选段落词汇…" : aiAvailable ? "AI 精选本段词汇" : "配置 AI 服务"}</button> : <span className="vocabulary-enriched">本段词汇已生成</span>}
      {error ? <p className="assistant-action-error" role="alert">{error}</p> : null}
    </div>
    <label className="vocabulary-search"><Search size={15} /><input aria-label="搜索学术词汇" placeholder="搜索英文或中文" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <p className="vocabulary-count">{visible.length} 个词汇 · {hasParagraph ? "来源为当前段落" : "未选择段落"}</p>
    {visible.length ? visible.map((term) => <article className="vocabulary-card" key={term.term.toLowerCase()}>
      <div className="vocabulary-word"><strong>{term.term}</strong>
        {onSaveTerm ? <button type="button" className={`icon-button vocabulary-save ${isTermSaved?.(term) ? "is-saved" : ""}`}
          disabled={isTermSaved?.(term)} aria-label={isTermSaved?.(term) ? `${term.term} 已加入单词表` : `将 ${term.term} 加入单词表`}
          title={isTermSaved?.(term) ? "已加入单词表" : "加入单词表"} onClick={() => onSaveTerm(term)}>
          {isTermSaved?.(term) ? <Check size={16} /> : <BookmarkPlus size={16} />}</button> : <span>{term.count} 次</span>}</div>
      <span className="vocabulary-meaning">{term.translation}</span>
      <p>{term.definition}</p>
      <button className="vocabulary-example" onClick={() => onJump(term.blockId)}><span>{term.example}</span><small>第 {term.pageNumber} 页原文 <ArrowUpRight size={12} /></small></button>
    </article>) : <div className="assistant-placeholder"><p>{query ? "没有匹配的词汇" : hasParagraph ? "本段暂无匹配词汇" : "未选择正文段落"}</p></div>}
  </div>;
}
