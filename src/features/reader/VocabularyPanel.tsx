import { useMemo, useState } from "react";
import { ArrowUpRight, Search, Sparkles } from "lucide-react";
import type { AcademicTerm } from "../../domain/vocabulary";

export function VocabularyPanel({ terms, onJump, onGuide, aiAvailable, busy, enriched, guideOverview, streamingGuide, error }: {
  terms: AcademicTerm[]; onJump: (blockId: string) => void; onGuide: () => void; aiAvailable: boolean; busy: boolean; enriched: boolean; guideOverview?: string; streamingGuide?: string; error?: string | null;
}) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => terms.filter((term) => `${term.term} ${term.translation}`.toLowerCase().includes(query.trim().toLowerCase())), [terms, query]);
  return <div className="vocabulary-panel">
    <div className="vocabulary-intro"><strong>把陌生词放在一起看</strong>
      {streamingGuide ? <pre className="assistant-streaming-output" aria-live="polite">{streamingGuide}</pre>
        : <p>{guideOverview || "自动识别正文中的学术词，点击原文例句可回到论文。"}</p>}
      {!enriched ? <button className="text-button" disabled={busy} onClick={onGuide}><Sparkles size={14} />{aiAvailable ? "AI 补充本文重点术语" : "配置 AI 补充重点术语"}</button> : <span className="vocabulary-enriched">已结合 AI 阅读指南补充</span>}
      {error ? <p className="assistant-action-error" role="alert">{error}</p> : null}
    </div>
    <label className="vocabulary-search"><Search size={15} /><input aria-label="搜索学术词汇" placeholder="搜索英文或中文" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <p className="vocabulary-count">{visible.length} 个词汇 · 来源为当前论文</p>
    {visible.length ? visible.map((term) => <article className="vocabulary-card" key={term.term.toLowerCase()}>
      <div className="vocabulary-word"><strong>{term.term}</strong><span>{term.count} 次</span></div>
      <span className="vocabulary-meaning">{term.translation}</span>
      <p>{term.definition}</p>
      <button className="vocabulary-example" onClick={() => onJump(term.blockId)}><span>{term.example}</span><small>第 {term.pageNumber} 页原文 <ArrowUpRight size={12} /></small></button>
    </article>) : <div className="assistant-placeholder"><p>{query ? "没有匹配的词汇，换个关键词试试。" : "正文准备好后会自动识别学术词汇。你可以先阅读原始 PDF。"}</p></div>}
  </div>;
}
