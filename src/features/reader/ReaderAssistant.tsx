import { BookOpen, MessageCircle, Check, Copy, Languages, LoaderCircle, MessageSquareText, Radar, RotateCcw, Send, Sparkles, Settings2 } from "lucide-react";
import { Pianpian } from "../../brand/Pianpian";
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import type { DocumentBlock } from "../../domain/documentBlocks";
import type { AcademicTerm } from "../../domain/vocabulary";
import { VocabularyPanel } from "./VocabularyPanel";
import { isVisualBlock } from "../../domain/readingFlow";
import { ChartContext } from "./ChartContext";
import { EquationContext } from "./EquationContext";
import { TranslationContent } from "./TranslationContent";
import { MarkdownContent } from "./MarkdownContent";
import { previewParagraphInsight } from "../../domain/learning";
import type { ParagraphOperation } from "../../domain/analysis";

interface ReaderAssistantProps {
  researchPanel?: ReactNode;
  radarPanel?: ReactNode;
  originalId?: string; chartReading: import("../../domain/learning").ChartReading | null; onReadChart: () => void;
  equationReading: import("../../domain/learning").EquationReading | null; onReadEquation: () => void;
  selectedBlock: DocumentBlock | null; answer: string | null; isBusy: boolean;
  onTranslate: () => void; onExplain: (force?: boolean) => void; explanation: string | null; onAsk: (question: string) => void;
  translation: string | null; selectionText: string; serviceLabel: string; serviceModel: string; aiAvailable: boolean; onOpenSettings: () => void;
  actionError: string | null; pendingAction: string | null; insight: { summary: string; role: string } | null;
  pendingParagraphActions?: ParagraphOperation[];
  paragraphAnalysisRequestId?: number;
  chartAnalysisRequestId?: number;
  equationAnalysisRequestId?: number;
  paragraphInsightText?: string;
  streamingOutput: { operation: import("../../services/ai").AiRequest["operation"]; text: string } | null;
  onInsight: () => void; guide: { overview: string; terms: Array<{ term: string; translation: string; definition: string }> } | null;
  onGuide: () => void; vocabulary: AcademicTerm[];
  vocabularyBlock?: DocumentBlock | null;
  onSaveTerm?: (term: AcademicTerm) => void;
  isTermSaved?: (term: AcademicTerm) => boolean;
  onJump: (blockId: string) => void;
  paragraphReadingMode?: "standard" | "grandma";
  onParagraphReadingModeChange?: (mode: "standard" | "grandma") => void;
  draftAppend?: { id: number; text: string };
  /** 演示文稿场景：助手只保留解释与问答。 */
  deckMode?: boolean;
}

const PARAGRAPH_TABS = [
  { operation: "translate", label: "翻译", icon: Languages },
  { operation: "insight", label: "摘要与作用", icon: Sparkles },
  { operation: "explain", label: "解释", icon: MessageSquareText },
] as const;
type ParagraphTab = typeof PARAGRAPH_TABS[number]["operation"];

export function ReaderAssistant({
  selectedBlock, answer, isBusy, onTranslate, onExplain, explanation, onAsk,
  translation, selectionText, serviceLabel, serviceModel, aiAvailable, onOpenSettings, actionError, pendingAction,
  streamingOutput, insight, onInsight, guide, onGuide, vocabulary,
  onJump,
  originalId, chartReading, onReadChart,
  equationReading, onReadEquation,
  pendingParagraphActions = [], paragraphAnalysisRequestId, paragraphInsightText,
  chartAnalysisRequestId, equationAnalysisRequestId,
  vocabularyBlock, onSaveTerm, isTermSaved,
  researchPanel,
  radarPanel,
  paragraphReadingMode = "standard", onParagraphReadingModeChange = () => undefined, draftAppend, deckMode = false,
}: ReaderAssistantProps) {
  const [question, setQuestion] = useState("");
  const [tab, setTab] = useState<"assist" | "vocabulary" | "radar" | "research">("assist");
  const [researchMounted, setResearchMounted] = useState(false);
  const [radarMounted, setRadarMounted] = useState(false);
  const tabOrder: Array<"assist" | "vocabulary" | "radar" | "research"> = ["assist", "vocabulary"];
  if (radarPanel) tabOrder.push("radar");
  if (researchPanel) tabOrder.push("research");
  const tabIndex = (name: "assist" | "vocabulary" | "radar" | "research") => tabOrder.indexOf(name);
  const scrollTab = tab === "vocabulary" ? "vocabulary" : "assist";
  // 演示文稿场景只保留解释：初始页签随之调整。
  const [paragraphTab, setParagraphTab] = useState<ParagraphTab>(deckMode ? "explain" : "translate");
  useEffect(() => {
    if (deckMode && paragraphTab === "translate") setParagraphTab("explain");
  }, [deckMode, paragraphTab]);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [questionSequence, setQuestionSequence] = useState(0);
  const id = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLElement>(null);
  const revealedQuestion = useRef(-1);
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const paragraphTabsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  const copyRequest = useRef(0);
  const visual = isVisualBlock(selectedBlock);
  const equation = selectedBlock?.kind === "equation";
  const translating = pendingAction === "translate" || pendingParagraphActions.includes("translate");
  const explaining = pendingAction === "explain" || pendingParagraphActions.includes("explain");
  const translationText = translation || (streamingOutput?.operation === "translate" ? streamingOutput.text : "");
  const chartStreamingText = streamingOutput?.operation === "chart" ? streamingOutput.text : "";
  const equationStreamingText = streamingOutput?.operation === "equation" ? streamingOutput.text : "";
  const insightLoading = pendingAction === "insight" || pendingParagraphActions.includes("insight");
  const vocabularyLoading = pendingAction === "vocabulary" || pendingParagraphActions.includes("vocabulary");
  const displayedInsight = paragraphInsightText !== undefined ? previewParagraphInsight(paragraphInsightText)
    : insight ?? (streamingOutput?.operation === "insight" ? previewParagraphInsight(streamingOutput.text) : null);
  const activeResearchPanel = researchPanel && isValidElement(researchPanel) && typeof researchPanel.type !== "string"
    ? cloneElement(researchPanel as ReactElement<{ active?: boolean; draftAppend?: { id: number; text: string } }>, {
      active: tab === "research", draftAppend,
    })
    : researchPanel;
  useEffect(() => {
    if (paragraphAnalysisRequestId === undefined) return;
    setTab("assist");
    setParagraphTab("translate");
  }, [paragraphAnalysisRequestId]);
  useEffect(() => {
    if (!draftAppend) return;
    setResearchMounted(true);
    setTab("research");
  }, [draftAppend]);
  useEffect(() => {
    if (pendingAction === "chart") setTab("assist");
  }, [pendingAction]);
  useEffect(() => {
    if (pendingAction === "equation") setTab("assist");
  }, [pendingAction]);
  useEffect(() => {
    if (chartAnalysisRequestId !== undefined) setTab("assist");
  }, [chartAnalysisRequestId]);
  useEffect(() => {
    if (equationAnalysisRequestId !== undefined) setTab("assist");
  }, [equationAnalysisRequestId]);
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, [selectedBlock?.id, selectionText, tab, paragraphTab]);
  useEffect(() => {
    const scroller = scrollRef.current;
    const result = answerRef.current;
    if ((!questionSequence && pendingAction !== "qa") || revealedQuestion.current === questionSequence || !scroller || !result) return;
    const top = scroller.scrollTop + result.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTo?.({ top, behavior: "auto" });
    revealedQuestion.current = questionSequence;
  }, [questionSequence, pendingAction, tab, Boolean(answer)]);
  useEffect(() => {
    copyRequest.current++;
    setCopyState("idle");
    return () => {
      copyRequest.current++;
      clearTimeout(copyTimer.current);
    };
  }, [selectedBlock?.id, translationText]);

  async function copyTranslation() {
    const request = ++copyRequest.current;
    clearTimeout(copyTimer.current);
    try {
      await navigator.clipboard.writeText(translationText);
      if (request !== copyRequest.current) return;
      setCopyState("copied");
      copyTimer.current = setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      if (request === copyRequest.current) setCopyState("failed");
    }
  }

  function changeTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    const count = tabOrder.length;
    if (event.key === "ArrowRight") next = (index + 1) % count;
    else if (event.key === "ArrowLeft") next = (index + count - 1) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else return;
    event.preventDefault();
    const nextTab = tabOrder[next] ?? "assist";
    if (nextTab === "research") setResearchMounted(true);
    if (nextTab === "radar") setRadarMounted(true);
    setTab(nextTab);
    tabsRef.current[next]?.focus();
  }

  function openRadar() {
    setRadarMounted(true);
    setTab("radar");
  }

  function openResearch() {
    setResearchMounted(true);
    setTab("research");
  }

  function runParagraphAction(operation: ParagraphTab, force = false) {
    if (isBusy) return;
    if (!aiAvailable) { onOpenSettings(); return; }
    const source = scrollRef.current?.querySelector(".paragraph-result");
    if (source?.contains(document.activeElement)) {
      const index = PARAGRAPH_TABS.findIndex((item) => item.operation === operation);
      paragraphTabsRef.current[index]?.focus();
    }
    if (operation === "translate") onTranslate();
    else if (operation === "insight") onInsight();
    else onExplain(force);
  }

  function selectParagraphTab(operation: ParagraphTab, generate = true) {
    setParagraphTab(operation);
    const existing = operation === "translate" ? translationText : operation === "insight" ? insight : explanation;
    if (generate && !existing) runParagraphAction(operation);
  }

  function changeParagraphTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % PARAGRAPH_TABS.length;
    else if (event.key === "ArrowLeft") next = (index + PARAGRAPH_TABS.length - 1) % PARAGRAPH_TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = PARAGRAPH_TABS.length - 1;
    else return;
    event.preventDefault();
    selectParagraphTab(PARAGRAPH_TABS[next].operation, false);
    paragraphTabsRef.current[next]?.focus();
  }

  function submitQuestion() {
    const value = question.trim();
    if (!value || isBusy || !aiAvailable) return;
    setTab("assist");
    setQuestionSequence((current) => current + 1);
    onAsk(value);
    setQuestion("");
  }

  return <aside className="reader-assistant" aria-label="篇篇阅读伙伴">
    <div className="assistant-heading">
      <div className="assistant-title"><div className="assistant-icon"><Pianpian /></div><div><strong>篇篇</strong><span>{deckMode ? "陪你把 PPT 读明白" : "陪你把论文读明白"}</span></div></div>
      <div className="assistant-heading-tools">
        <label className="assistant-grandma" title="人话模式：翻译、解释、词汇、读图表、读公式都用通俗表达生成">
          <span>人话模式</span>
          <input type="checkbox" role="switch" aria-label="人话模式" checked={paragraphReadingMode === "grandma"} onChange={(event) => onParagraphReadingModeChange(event.target.checked ? "grandma" : "standard")} />
        </label>
        <button className={`assistant-service ${!aiAvailable ? "is-unavailable" : ""}`} type="button" onClick={onOpenSettings} title={aiAvailable ? `${serviceLabel} · ${serviceModel} · 服务配置` : "配置 AI 服务"} aria-label="助手服务配置"><span className="status-dot" /><span>{serviceLabel}</span><Settings2 size={13} /></button>
      </div>
    </div>
    <div className="assistant-tabs" role="tablist" aria-label="篇篇阅读视图">
      <button ref={(element) => { tabsRef.current[tabIndex("assist")] = element; }} id={`${id}-assist-tab`} aria-controls={`${id}-assist-panel`} tabIndex={tab === "assist" ? 0 : -1} className={tab === "assist" ? "is-active" : ""} role="tab" aria-selected={tab === "assist"} onKeyDown={(event) => changeTab(event, tabIndex("assist"))} onClick={() => setTab("assist")} type="button"><BookOpen size={15} />{equation ? "解读公式" : visual ? "读图表" : "读懂这段"}</button>
      {!deckMode ? <button ref={(element) => { tabsRef.current[tabIndex("vocabulary")] = element; }} id={`${id}-vocabulary-tab`} aria-controls={`${id}-vocabulary-panel`} tabIndex={tab === "vocabulary" ? 0 : -1} className={tab === "vocabulary" ? "is-active" : ""} role="tab" aria-selected={tab === "vocabulary"} onKeyDown={(event) => changeTab(event, tabIndex("vocabulary"))} onClick={() => setTab("vocabulary")} type="button">{vocabularyLoading ? <LoaderCircle className="spin" size={15} /> : <Languages size={15} />}学术词汇 <span>{vocabulary.length}</span></button> : null}
      {!deckMode && radarPanel ? <button ref={(element) => { tabsRef.current[tabIndex("radar")] = element; }} id={`${id}-radar-tab`} aria-controls={`${id}-radar-panel`} tabIndex={tab === "radar" ? 0 : -1} className={tab === "radar" ? "is-active" : ""} role="tab" aria-selected={tab === "radar"} onKeyDown={(event) => changeTab(event, tabIndex("radar"))} onClick={openRadar} type="button"><Radar size={15} />相似论文</button> : null}
      {researchPanel ? <button ref={(element) => { tabsRef.current[tabIndex("research")] = element; }} id={`${id}-research-tab`} aria-controls={`${id}-research-panel`} tabIndex={tab === "research" ? 0 : -1} className={tab === "research" ? "is-active" : ""} role="tab" aria-selected={tab === "research"} onKeyDown={(event) => changeTab(event, tabIndex("research"))} onClick={openResearch} type="button"><MessageCircle size={15} />聊聊</button> : null}
    </div>
    <div ref={scrollRef} hidden={tab !== "assist" && tab !== "vocabulary"} className="assistant-scroll" id={`${id}-${scrollTab}-panel`} role="tabpanel" aria-labelledby={`${id}-${scrollTab}-tab`} tabIndex={0}>
      {tab === "vocabulary" ? <VocabularyPanel key={vocabularyBlock?.id ?? selectedBlock?.id ?? "none"} terms={vocabulary} onJump={onJump} onGuide={onGuide} aiAvailable={aiAvailable} busy={isBusy} enriched={Boolean(guide)} guideOverview={guide?.overview}
        loading={vocabularyLoading} hasParagraph={(vocabularyBlock ?? selectedBlock)?.kind === "paragraph"}
        onSaveTerm={onSaveTerm} isTermSaved={isTermSaved} /> : <>
        <section className="assistant-section selected-context">
          <div className="section-heading">
            <h2>{equation ? "公式理解" : visual ? selectedBlock?.kind === "table" ? "表格理解" : "图表理解" : selectionText ? "选中句子" : "段落理解"}</h2>
            <div className="paragraph-context-actions">
              <span className="context-count">{selectedBlock ? `第 ${selectedBlock.pageNumber} 页` : "未选择"}</span>
            </div>
          </div>
          {selectedBlock && visual ? equation
            ? <EquationContext block={selectedBlock} reading={equationReading} streamingText={equationStreamingText} busy={isBusy} loading={pendingAction === "equation"} aiAvailable={aiAvailable} onRead={onReadEquation} onOpenSettings={onOpenSettings} />
            : <ChartContext originalId={originalId} block={selectedBlock} reading={chartReading} streamingText={chartStreamingText} busy={isBusy} loading={pendingAction === "chart"} aiAvailable={aiAvailable} onRead={onReadChart} onOpenSettings={onOpenSettings} />
            : selectedBlock ? <>
          <div className="paragraph-tabs" role="tablist" aria-label="段落分析">
            {(deckMode ? PARAGRAPH_TABS.filter(({ operation }) => operation === "explain") : PARAGRAPH_TABS).map(({ operation, label, icon: Icon }, index) => <button key={operation} type="button"
              ref={(element) => { paragraphTabsRef.current[index] = element; }} data-operation={operation}
              id={`${id}-${operation}-tab`} aria-controls={`${id}-${operation}-panel`} role="tab"
              aria-selected={paragraphTab === operation} tabIndex={paragraphTab === operation ? 0 : -1}
              className={paragraphTab === operation ? "is-active" : ""}
              onClick={() => selectParagraphTab(operation)} onKeyDown={(event) => changeParagraphTab(event, index)}>
              {pendingAction === operation || pendingParagraphActions.includes(operation)
                ? <LoaderCircle className="spin" size={14} /> : <Icon size={14} />}{label}
            </button>)}
          </div>
          <div className="paragraph-result" id={`${id}-${paragraphTab}-panel`} role="tabpanel" aria-labelledby={`${id}-${paragraphTab}-tab`} tabIndex={0}>
          {paragraphTab === "translate" ? translationText || translating ? <div className="assistant-translation" aria-live="polite" aria-busy={translating}>
            <div className="assistant-result-heading"><h3>中文译文</h3>
              {translating ? <span className="assistant-result-state"><LoaderCircle className="spin" size={12} />翻译中</span>
                : <button type="button" className="assistant-copy-button" aria-label={copyState === "copied" ? "已复制译文" : "复制译文"} title={copyState === "copied" ? "已复制译文" : "复制译文"} onClick={() => void copyTranslation()}>{copyState === "copied" ? <Check size={15} /> : <Copy size={15} />}</button>}
            </div>
            {translationText ? <TranslationContent text={translationText} /> : <p className="muted-copy">正在生成中文译文…</p>}
            {copyState !== "idle" ? <span className={`assistant-copy-status ${copyState === "failed" ? "is-error" : ""}`} role="status">{copyState === "copied" ? "已复制" : "复制失败，请重试"}</span> : null}
          </div> : deckMode ? null : <div className="paragraph-empty"><p className="muted-copy">尚无译文</p><button type="button" className="secondary-button compact" disabled={isBusy} onClick={() => runParagraphAction("translate")}><Languages size={14} />{aiAvailable ? selectionText ? "翻译选中句子" : "翻译整段" : "配置翻译服务"}</button></div> : null}
          {paragraphTab === "insight" ? displayedInsight ? <div className="assistant-insight" aria-live="polite" aria-busy={insightLoading}>
            <div className="assistant-result-heading"><h3>这段讲什么</h3>{insightLoading ? <span className="assistant-result-state"><LoaderCircle className="spin" size={12} />生成中</span> : null}</div>
            {displayedInsight.summary ? <MarkdownContent text={displayedInsight.summary} /> : null}<h3>在上下文中的作用</h3>
            {displayedInsight.role ? <MarkdownContent text={displayedInsight.role} /> : insightLoading ? <p className="muted-copy">正在生成上下文作用…</p> : null}</div>
            : insightLoading ? <p className="muted-copy paragraph-progress" role="status"><LoaderCircle className="spin" size={14} />正在生成摘要与作用…</p>
            : <div className="paragraph-empty"><p className="muted-copy">尚无段落摘要</p><button type="button" className="secondary-button compact" aria-label="段落摘要与作用" disabled={isBusy} onClick={() => runParagraphAction("insight")}><Sparkles size={14} />{aiAvailable ? "生成摘要与作用" : "配置 AI 服务"}</button></div> : null}
          {paragraphTab === "explain" ? explanation || explaining ? <div className="assistant-explanation" aria-live="polite" aria-busy={explaining}><div className="assistant-result-heading"><h3>术语与逻辑</h3>{explaining ? <LoaderCircle className="spin" size={13} /> : <button type="button" className="assistant-copy-button" aria-label="重新生成解释" title="重新生成解释" disabled={isBusy} onClick={() => runParagraphAction("explain", true)}><RotateCcw size={14} /></button>}</div><MarkdownContent text={explanation || "正在生成解释…"} /></div>
            : <div className="paragraph-empty"><p className="muted-copy">尚无内容解释</p><button type="button" className="secondary-button compact" aria-label="解释术语与逻辑" disabled={isBusy} onClick={() => runParagraphAction("explain")}><MessageSquareText size={14} />{aiAvailable ? "生成解释" : "配置 AI 服务"}</button></div> : null}
          </div></>
            : <div className="assistant-empty"><BookOpen size={24} /><p className="muted-copy">未选择阅读内容</p></div>}
          {!aiAvailable ? <button className="text-button assistant-configure" type="button" onClick={onOpenSettings}><Settings2 size={14} />配置 AI 服务</button> : null}
        </section>
        {answer || pendingAction === "qa" ? <section ref={answerRef} className="assistant-section qa-section">
          <div className="section-heading"><h2>论文回答</h2>{pendingAction === "qa" ? <LoaderCircle className="spin" size={14} /> : <MessageSquareText size={14} />}</div>
          <div className="answer-copy" aria-live="polite" aria-busy={pendingAction === "qa"}><MarkdownContent text={answer || "正在生成回答…"} /></div>
        </section> : null}
      </>}
    </div>
    {activeResearchPanel && researchMounted ? <div hidden={tab !== "research"} className="research-tab-panel" id={`${id}-research-panel`} role="tabpanel" aria-labelledby={`${id}-research-tab`}>{activeResearchPanel}</div> : null}
    {radarPanel && radarMounted ? <div hidden={tab !== "radar"} className="radar-tab-panel" id={`${id}-radar-panel`} role="tabpanel" aria-labelledby={`${id}-radar-tab`}>{radarPanel}</div> : null}
    {researchPanel && actionError && tab !== "research" ? <div className="assistant-action-error" role="alert">{actionError}<button type="button" className="text-button" onClick={onOpenSettings}><Settings2 size={13} />检查配置</button></div> : null}
    {researchPanel ? tab !== "research" && tab !== "radar" ? <button type="button" className="research-entry-button" onClick={openResearch}><MessageCircle size={16} /><span>问问篇篇 · 读论文、找文献</span><Send size={14} /></button> : null : <div className="assistant-composer">
      <div className="assistant-composer-heading"><label htmlFor={`${id}-question`}>论文问答</label><MessageSquareText size={14} /></div>
      <div className="question-box"><textarea id={`${id}-question`} aria-label="向论文提问" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (!event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submitQuestion(); } }} placeholder="这篇论文的核心贡献是什么？" rows={2} /><button aria-label="发送问题" className="send-button" disabled={!question.trim() || isBusy || !aiAvailable} onClick={submitQuestion} title="发送问题 (Ctrl / Command + Enter)" type="button">{pendingAction === "qa" ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}</button></div>
      {actionError ? <div className="assistant-action-error" role="alert">{actionError}<button type="button" className="text-button" onClick={onOpenSettings}><Settings2 size={13} />检查配置</button></div> : null}
    </div>}
  </aside>;
}
