import { useMemo, useState } from "react";
import { ArrowUpRight, BookmarkPlus, Check, LoaderCircle, Search, Sparkles } from "lucide-react";
import type { AcademicTerm } from "../../domain/vocabulary";

export function VocabularyPanel({ terms, onJump, onGuide, aiAvailable, busy, enriched, guideOverview, loading, hasParagraph, onSaveTerm, isTermSaved, error }: {
  terms: AcademicTerm[]; onJump: (blockId: string) => void; onGuide: () => void; aiAvailable: boolean; busy: boolean; enriched: boolean; guideOverview?: string; loading?: boolean; hasParagraph?: boolean;
  onSaveTerm?: (term: AcademicTerm) => void; isTermSaved?: (term: AcademicTerm) => boolean; error?: string | null;
}) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => terms.filter((term) => `${term.term} ${term.translation}`.toLowerCase().includes(query.trim().toLowerCase())), [terms, query]);
  const displayTerms = enriched ? terms : [];
  return <div className="vocabulary-panel">
    <div className="vocabulary-intro"><div className="vocabulary-heading"><Sparkles size={16} /><strong>篇篇选词</strong>
      </div>
      {guideOverview ? <p>{guideOverview}</p> : null}
      {!enriched ? <button className="text-button" disabled={busy || !hasParagraph} onClick={onGuide}>
        {loading ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}
        {loading ? "篇篇正在选词…" : aiAvailable ? "生成本段词汇" : "配置模型服务"}</button> : <span className="vocabulary-enriched">本段词汇已生成</span>}
      {!enriched && !loading ? <p className="vocabulary-opt-in-hint">双击段落后自动精选，也可以现在手动生成。只展示本段原文中有依据的词汇。</p> : null}
      {error ? <p className="assistant-action-error" role="alert">{error}</p> : null}
    </div>
    {enriched && displayTerms.length ? <label className="vocabulary-search"><Search size={15} /><input aria-label="搜索学术词汇" placeholder="搜索英文或中文" value={query} onChange={(event) => setQuery(event.target.value)} /></label> : null}
    <p className="vocabulary-count">{enriched ? `${visible.length} 个词汇 · 来源为当前段落` : loading ? "正在找值得积累的词汇与表达…" : "本段还未选词"}</p>
    {enriched && visible.length ? visible.map((term) => <article className="vocabulary-card" key={term.term.toLowerCase()}>
      <div className="vocabulary-word"><strong>{term.term}</strong>
        {onSaveTerm ? <button type="button" className={`icon-button vocabulary-save ${isTermSaved?.(term) ? "is-saved" : ""}`}
          disabled={isTermSaved?.(term)} aria-label={isTermSaved?.(term) ? `${term.term} 已加入单词表` : `将 ${term.term} 加入单词表`}
          title={isTermSaved?.(term) ? "已加入单词表" : "加入单词表"} onClick={() => onSaveTerm(term)}>
          {isTermSaved?.(term) ? <Check size={16} /> : <BookmarkPlus size={16} />}</button> : <span>{term.count} 次</span>}</div>
      <span className="vocabulary-meaning">{term.translation}</span>
      <p>{term.definition}</p>
      <button className="vocabulary-example" onClick={() => onJump(term.blockId)}><span>{term.example}</span><small>第 {term.pageNumber} 页原文 <ArrowUpRight size={12} /></small></button>
    </article>) : <div className={`assistant-placeholder vocabulary-empty ${loading ? "is-loading" : ""}`} role="status">
      {loading ? <><LoaderCircle className="spin" size={20} /><p>篇篇正在选词…</p><span>翻译和解释会分别完成，你可以先查看其他结果。</span></>
        : <><Sparkles size={22} /><p>{query ? "没有匹配的词汇" : enriched ? "本段没有需要单独学习的词汇" : hasParagraph ? "双击段落，篇篇会从原文里选出值得积累的表达" : "选一段正文，和篇篇一起积累表达"}</p></>}
    </div>}
  </div>;
}
