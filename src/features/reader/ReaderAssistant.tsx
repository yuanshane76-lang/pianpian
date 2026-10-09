import { Bot, CornerDownLeft, Languages, LoaderCircle, MessageSquareText, Sparkles, Settings2 } from "lucide-react";
import { useState } from "react";
import type { DocumentBlock } from "../../domain/documentBlocks";
import type { PaperPipelineState } from "../../domain/pipeline";
import type { AcademicTerm } from "../../domain/vocabulary";
import { VocabularyPanel } from "./VocabularyPanel";

interface ReaderAssistantProps {
  selectedBlock: DocumentBlock | null; overview: string | null; answer: string | null; isBusy: boolean;
  onOverview: () => void; onTranslate: () => void; onExplain: () => void; explanation: string | null; onAsk: (question: string) => void;
  translation: string | null; selectionText: string; serviceLabel: string; serviceModel: string; aiAvailable: boolean; onOpenSettings: () => void;
  actionError: string | null; pendingAction: string | null; insight: { summary: string; role: string } | null;
  streamingOutput: { operation: import("../../services/ai").AiRequest["operation"]; text: string } | null;
  onInsight: () => void; guide: { overview: string; terms: Array<{ term: string; translation: string; definition: string }> } | null;
  onGuide: () => void; vocabulary: AcademicTerm[];
  pipeline: PaperPipelineState;
  onPausePipeline: () => void;
  onResumePipeline: () => void;
  onRetryPipeline: () => void;
  onJump: (blockId: string) => void;
}

export function ReaderAssistant({
  selectedBlock, overview, answer, isBusy, onOverview, onTranslate, onExplain, explanation, onAsk,
  translation, selectionText, serviceLabel, serviceModel, aiAvailable, onOpenSettings, actionError, pendingAction,
  streamingOutput, insight, onInsight, guide, onGuide, vocabulary,
  pipeline, onPausePipeline, onResumePipeline, onRetryPipeline, onJump,
}: ReaderAssistantProps) {
  const [question, setQuestion] = useState("");
  const [tab, setTab] = useState<"assist" | "vocabulary">("assist");
  function submitQuestion() {
    const value = question.trim();
    if (!value || isBusy) return;
    onAsk(value); setQuestion("");
  }
  return <aside className="reader-assistant">
    <div className="assistant-heading">
      <div className="assistant-title"><div className="assistant-icon"><Bot size={17} /></div><div><strong>研究助手</strong><span>按需调用 · 本地缓存</span></div></div>
      <span className="local-badge"><span className="status-dot" />{serviceLabel}</span>
    </div>
    <div className="assistant-tabs" role="tablist">
      <button className={tab === "assist" ? "is-active" : ""} role="tab" aria-selected={tab === "assist"} onClick={() => setTab("assist")}>读懂这段</button>
      <button className={tab === "vocabulary" ? "is-active" : ""} role="tab" aria-selected={tab === "vocabulary"} onClick={() => setTab("vocabulary")}>学术词汇 <span>{vocabulary.length}</span></button>
    </div>
    <div className="assistant-scroll">
      <section className="assistant-section pipeline-assistant-section">
        <div className="section-heading"><span>本次导入</span><span className="context-count">{pipeline.translatedCount} 段已翻译</span></div>
        <p className="pipeline-assistant-status">{pipeline.currentLabel || (pipeline.stage === "ready" ? "PDF 已就绪，MinerU 交互层已叠加" : "正在准备阅读内容…")}</p>
        <div className="pipeline-assistant-meta">
          {pipeline.queuedCount > 0 ? <span>队列 {pipeline.queuedCount}</span> : null}
          {pipeline.failedCount > 0 ? <span className="pipeline-assistant-error">{pipeline.failedCount} 段失败</span> : null}
          {pipeline.paused ? <span>后台翻译已暂停</span> : null}
        </div>
        <div className="pipeline-assistant-actions">
          {pipeline.paused ? <button className="text-button" onClick={onResumePipeline} type="button">继续翻译</button> : <button className="text-button" onClick={onPausePipeline} type="button">暂停后台翻译</button>}
          {pipeline.failedCount > 0 ? <button className="text-button" onClick={onRetryPipeline} type="button">重试失败段落</button> : null}
        </div>
      </section>
      {tab === "vocabulary" ? <VocabularyPanel terms={vocabulary} onJump={onJump} onGuide={onGuide} aiAvailable={aiAvailable} busy={pendingAction === "guide"} enriched={Boolean(guide)} guideOverview={guide?.overview} streamingGuide={streamingOutput?.operation === "guide" ? streamingOutput.text : ""} error={pendingAction === "guide" ? null : actionError} /> : <>
        <section className="assistant-section">
          <div className="section-heading"><span>论文摘要</span><Sparkles size={14} /></div>
          {overview ? <p className="assistant-copy">{overview}</p> : <div className="assistant-placeholder"><p>还没有生成摘要。</p><button className="text-button" onClick={aiAvailable ? onOverview : onOpenSettings} disabled={isBusy}>{pendingAction === "overview" ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}{aiAvailable ? "生成 AI 概览" : "配置 AI 服务"}</button></div>}
        </section>
        <section className="assistant-section selected-context">
          <div className="section-heading"><span>{selectionText ? "选中句子" : "段落理解"}</span><span className="context-count">{selectedBlock ? `第 ${selectedBlock.pageNumber} 页` : "未选择"}</span></div>
          {selectedBlock ? <><p className="selected-block-text">{selectionText || selectedBlock.text}</p><div className="context-actions">
            <button className="secondary-button compact" onClick={aiAvailable ? onTranslate : onOpenSettings} disabled={isBusy}>{pendingAction === "translate" ? <LoaderCircle className="spin" size={14} /> : <Languages size={14} />}{aiAvailable ? selectionText ? "翻译选中句子" : "翻译整段" : "配置翻译服务"}</button>
            <button className="text-button" disabled={isBusy} onClick={aiAvailable ? onInsight : onOpenSettings}>{pendingAction === "insight" ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}段落摘要与作用</button>
          </div>
          {translation || streamingOutput?.operation === "translate" ? <div className="assistant-translation" aria-live="polite"><span>{streamingOutput?.operation === "translate" && !translation ? "正在生成中文译文…" : "中文译文"}</span><p>{translation || streamingOutput?.text}</p>{translation ? <button type="button" className="text-button" onClick={() => void navigator.clipboard.writeText(translation)}>复制译文</button> : null}</div> : null}
          {streamingOutput?.operation === "insight" ? <pre className="assistant-streaming-output" aria-live="polite">{streamingOutput.text}</pre>
            : insight ? <div className="assistant-insight"><strong>这段讲什么</strong><p>{insight.summary}</p><strong>在上下文中的作用</strong><p>{insight.role}</p></div> : null}
          <button className="text-button" type="button" disabled={isBusy} onClick={aiAvailable ? onExplain : onOpenSettings}>解释术语与逻辑</button>
          {explanation ? <div className="assistant-explanation" aria-live="polite"><strong>内容解释</strong><p className="assistant-copy">{explanation}</p></div> : null}</>
            : <p className="muted-copy">在 PDF 上点击 MinerU 识别出的段落，默认翻译整段；划选一句或几句后可单独翻译。</p>}
          {!aiAvailable ? <p className="translation-help">翻译、摘要和解释需要配置百炼或 DeepSeek，原文阅读无需密钥。</p> : <p className="translation-help">{serviceLabel} · {serviceModel}</p>}
          {actionError ? <p className="assistant-action-error" role="alert">{actionError}<button type="button" className="text-button" onClick={onOpenSettings}><Settings2 size={13} />检查配置</button></p> : null}
        </section>
        <section className="assistant-section qa-section">
          <div className="section-heading"><span>论文问答</span><MessageSquareText size={14} /></div>
          {answer ? <p className="assistant-copy answer-copy" aria-live="polite">{answer}</p> : null}
          <div className="question-box"><textarea aria-label="向论文提问" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") submitQuestion(); }} placeholder="例如：这篇论文的核心贡献是什么？" rows={3} /><button aria-label="发送问题" className="send-button" disabled={!question.trim() || isBusy || !aiAvailable} onClick={submitQuestion} title="发送问题" type="button"><CornerDownLeft size={16} /></button></div>
          <span className="helper-copy">按快捷键 Ctrl 或 Command + Enter 发送</span>
        </section>
      </>}
    </div>
  </aside>;
}
