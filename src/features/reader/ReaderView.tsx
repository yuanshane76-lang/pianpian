import { ArrowLeft, BookMarked, Check, PanelLeftClose, PanelRightClose, Search, Settings2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { getDocumentOutline, type DocumentBlock } from "../../domain/documentBlocks";
import type { PaperRecord } from "../../domain/library";
import { PdfPreview } from "./PdfPreview";
import { ReaderAssistant } from "./ReaderAssistant";
import { ThemeToggle } from "../settings/ThemeToggle";
import { hasPageBounds } from "../../domain/pdfLayout";
import type { ParagraphOperation } from "../../domain/analysis";
import { formatResearchCitation } from "../../domain/researchCitation";

interface ReaderViewProps {
  researchPanel?: ReactNode;
  onOpenWordbook?: () => void;
  wordbookCount?: number;
  vocabularyBlock?: DocumentBlock | null;
  onSaveTerm?: (term: import("../../domain/vocabulary").AcademicTerm) => void;
  isTermSaved?: (term: import("../../domain/vocabulary").AcademicTerm) => boolean;
  sourceNavigation?: { paperId: string; blockId: string; requestId: number };
  onSourceNavigationConsumed?: (requestId: number) => void;
  paper: PaperRecord;
  selectedBlock: DocumentBlock | null;
  selectionText: string;
  translation: string | null;
  answer: string | null;
  isBusy: boolean;
  onBack: () => void;
  onSelectBlock: (block: DocumentBlock | null) => void;
  onSelectText: (block: DocumentBlock, text: string) => void;
  onAnalyzeParagraph: (block: DocumentBlock) => void;
  onAnalyzeChart?: (block: DocumentBlock) => void;
  onAnalyzeEquation?: (block: DocumentBlock) => void;
  paragraphAnalysisRequestId?: number;
  pendingParagraphActions?: ParagraphOperation[];
  paragraphInsightText?: string;
  onTranslate: () => void;
  onReadChart: () => void;
  chartReading: import("../../domain/learning").ChartReading | null;
  onReadEquation: () => void;
  equationReading: import("../../domain/learning").EquationReading | null;
  onExplain: (force?: boolean) => void;
  explanation: string | null;
  onAsk: (question: string) => void;
  onOpenSettings: () => void;
  actionError: string | null;
  processingStatus: string;
  onReimport: (file: File) => void;
  onPosition: (position: NonNullable<PaperRecord["readingPosition"]>) => void;
  aiAvailable: boolean;
  serviceLabel: string;
  serviceModel: string;
  pendingAction: string | null;
  streamingOutput: { operation: import("../../services/ai").AiRequest["operation"]; text: string } | null;
  insight: { summary: string; role: string } | null;
  onInsight: () => void;
  guide: { overview: string; terms: Array<{ term: string; translation: string; definition: string }> } | null;
  onGuide: () => void;
  vocabulary: import("../../domain/vocabulary").AcademicTerm[];
  paragraphReadingMode?: "standard" | "grandma";
  onParagraphReadingModeChange?: (mode: "standard" | "grandma") => void;
}

function getDefaultReaderPanelWidths() {
  const compactDesktop = typeof window !== "undefined" && window.matchMedia?.("(max-width: 1120px)")?.matches;
  return compactDesktop ? { outline: 145, assistant: 320 } : { outline: 175, assistant: 380 };
}

const panelLimits = { outline: { min: 140, max: 360 }, assistant: { min: 280, max: 560 } };
const documentMinimum = 320;

function fitPanelWidths(widths: { outline: number; assistant: number }, layoutWidth: number, leftOpen: boolean, rightOpen: boolean) {
  if (layoutWidth <= 840) return widths;
  const outline = leftOpen ? widths.outline : 0;
  const assistant = rightOpen ? widths.assistant : 0;
  const overflow = Math.max(0, outline + assistant + documentMinimum - layoutWidth);
  const assistantReduction = rightOpen ? Math.min(overflow, assistant - panelLimits.assistant.min) : 0;
  return {
    outline: leftOpen ? Math.max(panelLimits.outline.min, outline - (overflow - assistantReduction)) : widths.outline,
    assistant: rightOpen ? assistant - assistantReduction : widths.assistant,
  };
}

export function ReaderView(props: ReaderViewProps) {
  const { paper, selectedBlock, answer, isBusy, onBack, onSelectBlock, onTranslate, onAsk, onOpenSettings, actionError } = props;
  const blocks = paper.blockData ?? [];
  const defaultPanelWidths = useMemo(getDefaultReaderPanelWidths, []);
  const [page, setPage] = useState(paper.readingPosition?.page ?? 1);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [preferredOutlineWidth, setOutlineWidth] = useState(defaultPanelWidths.outline);
  const [preferredAssistantWidth, setAssistantWidth] = useState(defaultPanelWidths.assistant);
  const [layoutWidth, setLayoutWidth] = useState(window.innerWidth);
  const { outline: outlineWidth, assistant: assistantWidth } = fitPanelWidths(
    { outline: preferredOutlineWidth, assistant: preferredAssistantWidth }, layoutWidth, leftOpen, rightOpen,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const layoutReady = blocks.some(hasPageBounds);
  const readyNotice = useRef({ paperId: paper.id, announced: false });
  const [toastPaperId, setToastPaperId] = useState<string | null>(null);
  const readerLayoutRef = useRef<HTMLDivElement>(null);
  const assistantToggleRef = useRef<HTMLButtonElement>(null);
  const focusSequence = useRef(0);
  const [focusTarget, setFocusTarget] = useState<{ id: string; requestId: number; pageNumber?: number; regionId?: string; flash?: boolean }>();
  const [navigationTarget, setNavigationTarget] = useState<{ page: number; requestId: number }>();
  const [chartAnalysisRequestId, setChartAnalysisRequestId] = useState<number>();
  const [equationAnalysisRequestId, setEquationAnalysisRequestId] = useState<number>();
  const [draftAppend, setDraftAppend] = useState<{ id: number; text: string }>();
  const draftSequence = useRef(0);
  const outline = useMemo(() => getDocumentOutline(blocks), [blocks]);
  const resizeRef = useRef<{ side: "outline" | "assistant"; startX: number; startWidth: number; pointerId: number }>();
  const widthsRef = useRef(defaultPanelWidths);
  const openRef = useRef({ left: true, right: true });
  widthsRef.current = { outline: outlineWidth, assistant: assistantWidth };
  openRef.current = { left: leftOpen, right: rightOpen };
  const visibleBlocks = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return query ? blocks.filter((block) => block.text.toLocaleLowerCase().includes(query)) : blocks;
  }, [blocks, searchQuery]);

  useEffect(() => {
    const layout = readerLayoutRef.current;
    if (!layout) return;
    const update = () => setLayoutWidth(layout.getBoundingClientRect().width || window.innerWidth);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(layout);
    window.addEventListener("resize", update);
    update();
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, []);

  useEffect(() => {
    if (readyNotice.current.paperId !== paper.id) {
      readyNotice.current = { paperId: paper.id, announced: false };
      setToastPaperId(null);
    }
    if (!layoutReady || readyNotice.current.announced) return;
    readyNotice.current.announced = true;
    setToastPaperId(paper.id);
  }, [paper.id, layoutReady]);

  useEffect(() => {
    if (!toastPaperId) return;
    const timer = window.setTimeout(() => setToastPaperId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toastPaperId]);

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 840px)");
    const layout = readerLayoutRef.current;
    if (!media || !layout) return;
    const document = layout.querySelector<HTMLElement>(".reader-document");
    const outline = layout.querySelector<HTMLElement>(".reader-outline");
    const update = () => {
      const covered = media.matches && rightOpen;
      if (document) document.inert = covered;
      if (outline) outline.inert = media.matches;
      if (covered) layout.querySelector<HTMLElement>('.reader-assistant [role="tab"][aria-selected="true"]')?.focus();
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
      if (document) document.inert = false;
      if (outline) outline.inert = false;
    };
  }, [rightOpen, leftOpen]);

  function toggleAssistant() {
    if (rightOpen) assistantToggleRef.current?.focus();
    setRightOpen((current) => !current);
  }

  function toggleOutline() {
    setLeftOpen((current) => !current);
  }

  useEffect(() => {
    setPage(paper.readingPosition?.page ?? 1);
    setNavigationTarget(undefined);
    setSearchOpen(false);
    setSearchQuery("");
    const target = paper.readingPosition?.blockId;
    setFocusTarget(target ? { id: target, requestId: ++focusSequence.current, pageNumber: paper.readingPosition?.page,
      regionId: paper.readingPosition?.regionId } : undefined);
  }, [paper.id]);

  function original(targetPage: number) {
    setPage(targetPage);
    setFocusTarget(undefined);
    setNavigationTarget({ page: targetPage, requestId: ++focusSequence.current });
    if (selectedBlock?.pageNumber !== targetPage) onSelectBlock(null);
    props.onPosition({ mode: "pdf", page: targetPage });
  }

  useEffect(() => {
    if (!props.sourceNavigation || props.sourceNavigation.paperId !== paper.id) return;
    const block = blocks.find((item) => item.id === props.sourceNavigation!.blockId);
    if (!block) return;
    setPage(block.pageNumber);
    setSearchQuery("");
    setFocusTarget({ id: block.id, requestId: ++focusSequence.current, flash: true });
    setRightOpen(!window.matchMedia?.("(max-width: 840px)").matches);
    props.onSourceNavigationConsumed?.(props.sourceNavigation.requestId);
  }, [props.sourceNavigation, paper.id]);

  function select(block: DocumentBlock, pageNumber = block.pageNumber, regionId?: string) {
    onSelectBlock(block);
    setPage(pageNumber);
    props.onPosition({ mode: "pdf", page: pageNumber, blockId: block.id, ...(regionId ? { regionId } : {}) });
  }

  function navigate(block: DocumentBlock) {
    setSearchQuery("");
    select(block);
    setFocusTarget({ id: block.id, requestId: ++focusSequence.current, flash: true });
  }

  function addToConversation(block: DocumentBlock, text: string) {
    if (!props.researchPanel) return;
    setDraftAppend({
      id: ++draftSequence.current,
      text: formatResearchCitation({ paperTitle: paper.title, pageNumber: block.pageNumber, blockId: block.id, text }),
    });
    setRightOpen(true);
  }

  function clampWidth(side: "outline" | "assistant", value: number) {
    const { min, max } = panelLimits[side];
    const layoutWidth = readerLayoutRef.current?.getBoundingClientRect().width || window.innerWidth;
    const otherWidth = side === "outline"
      ? (openRef.current.right ? widthsRef.current.assistant : 0)
      : (openRef.current.left ? widthsRef.current.outline : 0);
    const available = layoutWidth - otherWidth - documentMinimum;
    return Math.round(Math.min(max, Math.max(min, Math.min(value, available))));
  }

  function resizeBy(side: "outline" | "assistant", delta: number) {
    if (side === "outline") setOutlineWidth(clampWidth(side, outlineWidth + delta));
    else setAssistantWidth(clampWidth(side, assistantWidth - delta));
  }

  function handleResizeKeyDown(side: "outline" | "assistant", event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft") { event.preventDefault(); resizeBy(side, -step); }
    else if (event.key === "ArrowRight") { event.preventDefault(); resizeBy(side, step); }
    else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const value = clampWidth(side, panelLimits[side][event.key === "Home" ? "min" : "max"]);
      if (side === "outline") setOutlineWidth(value); else setAssistantWidth(value);
    }
  }

  function startResize(side: "outline" | "assistant", event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeRef.current = {
      side,
      startX: event.clientX,
      startWidth: side === "outline" ? outlineWidth : assistantWidth,
      pointerId: event.pointerId,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.classList.add("is-reader-resizing");
  }

  useEffect(() => {
    function move(event: PointerEvent) {
      const resize = resizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      const delta = event.clientX - resize.startX;
      const value = resize.side === "outline" ? resize.startWidth + delta : resize.startWidth - delta;
      if (resize.side === "outline") setOutlineWidth(clampWidth(resize.side, value));
      else setAssistantWidth(clampWidth(resize.side, value));
    }
    function stop() {
      if (!resizeRef.current) return;
      resizeRef.current = undefined;
      document.body.classList.remove("is-reader-resizing");
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      resizeRef.current = undefined;
      document.body.classList.remove("is-reader-resizing");
    };
  }, []);

  const layoutStyle = {
    "--reader-outline-width": `${outlineWidth}px`,
    "--reader-assistant-width": `${assistantWidth}px`,
  } as CSSProperties;

  return (
    <div className="reader-shell">
      <header className="reader-topbar">
        <button className="back-button" onClick={onBack} type="button"><ArrowLeft size={17} />返回文献库</button>
        <div className="reader-title"><strong>{paper.title}</strong></div>
        <div className="reader-toolbar">
          <button type="button" className="wordbook-button" aria-label="打开单词表" title="单词表" onClick={props.onOpenWordbook}><BookMarked size={17} /><span>单词表</span><small>{props.wordbookCount ?? 0}</small></button>
          <button className="icon-button" aria-label={leftOpen ? "收起目录" : "展开目录"} onClick={toggleOutline}><PanelLeftClose size={17} /></button>
          <button ref={assistantToggleRef} className="icon-button" aria-label={rightOpen ? "收起助手" : "展开助手"} onClick={toggleAssistant}><PanelRightClose size={17} /></button>
          <ThemeToggle variant="icon" />
          <button className="icon-button" aria-label="服务配置" onClick={onOpenSettings}><Settings2 size={17} /></button>
          <button className="icon-button" aria-label="搜索正文" aria-pressed={searchOpen} onClick={() => setSearchOpen(!searchOpen)}><Search size={17} /></button>
        </div>
      </header>
      {toastPaperId === paper.id ? <div className="reader-ready-toast" role="status">
        <span className="reader-ready-toast-icon"><Check size={17} aria-hidden="true" /></span>
        <div><strong>段落定位已就绪</strong><span>点击原文或划选句子开始理解</span></div>
        <button className="icon-button" aria-label="关闭定位提示" type="button" onClick={() => setToastPaperId(null)}><X size={16} /></button>
      </div> : null}
      {searchOpen ? <div className="reader-searchbar"><Search size={16} /><input autoFocus aria-label="搜索正文内容" onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索正文内容" type="search" value={searchQuery} /><span>{visibleBlocks.length} 个匹配段落</span></div> : null}
      <div ref={readerLayoutRef} className={`reader-layout ${!leftOpen ? "left-collapsed" : ""} ${!rightOpen ? "right-collapsed" : ""}`} style={layoutStyle}>
        {leftOpen ? <aside className="reader-outline">
          <div className="outline-label">论文目录</div>
          {outline.length ? <nav className="outline-sections" aria-label="论文目录">
            {outline.map(({ block, level }) => <button className="outline-heading" data-heading-level={level} key={block.id} onClick={() => navigate(block)} style={{ "--outline-level": level } as CSSProperties} title={block.text}>{block.text}</button>)}
          </nav> : <p className="outline-empty">尚未识别出论文标题</p>}
        </aside> : null}
        {leftOpen ? <div className="reader-resizer reader-resizer-left" role="separator" aria-label="调整目录宽度" title="拖动调整目录宽度" aria-orientation="vertical" aria-valuemin={panelLimits.outline.min} aria-valuemax={clampWidth("outline", panelLimits.outline.max)} aria-valuenow={outlineWidth} tabIndex={0} onKeyDown={(event) => handleResizeKeyDown("outline", event)} onPointerDown={(event) => startResize("outline", event)} /> : null}
        <main className="reader-document is-pdf">
          <PdfPreview paperId={paper.id} originalId={paper.originalId} page={page} onPage={original} navigationTarget={navigationTarget}
            onAnalyzeParagraph={(block, pageNumber = block.pageNumber, regionId) => {
              setPage(pageNumber);
              setRightOpen(true);
              props.onPosition({ mode: "pdf", page: pageNumber, blockId: block.id, ...(regionId ? { regionId } : {}) });
              if (props.aiAvailable) props.onAnalyzeParagraph(block);
              else { select(block, pageNumber, regionId); onOpenSettings(); }
            }}
            onAnalyzeChart={(block, pageNumber = block.pageNumber, regionId) => {
              setChartAnalysisRequestId((current) => (current ?? 0) + 1);
              setPage(pageNumber);
              setRightOpen(true);
              props.onPosition({ mode: "pdf", page: pageNumber, blockId: block.id, ...(regionId ? { regionId } : {}) });
              if (props.aiAvailable) props.onAnalyzeChart?.(block);
              else { select(block, pageNumber, regionId); onOpenSettings(); }
            }}
            onAnalyzeEquation={(block, pageNumber = block.pageNumber, regionId) => {
              setEquationAnalysisRequestId((current) => (current ?? 0) + 1);
              setPage(pageNumber);
              setRightOpen(true);
              props.onPosition({ mode: "pdf", page: pageNumber, blockId: block.id, ...(regionId ? { regionId } : {}) });
              if (props.aiAvailable) props.onAnalyzeEquation?.(block);
              else { select(block, pageNumber, regionId); onOpenSettings(); }
            }}
             onAddToConversation={props.researchPanel ? (block, pageNumber = block.pageNumber, regionId) => {
               select(block, pageNumber, regionId);
               addToConversation(block, selectedBlock?.id === block.id ? props.selectionText || block.text : block.text);
             } : undefined}
            onVisiblePage={(visiblePage) => { setPage(visiblePage); props.onPosition({ mode: "pdf", page: visiblePage }); }}
            onReimport={props.onReimport} blocks={visibleBlocks} activeBlockId={selectedBlock?.id ?? null} onSelect={select} onSelectText={(block, text, pageNumber, regionId) => { select(block, pageNumber, regionId); props.onSelectText(block, text); }} focusTarget={focusTarget} onVisibleBlock={(block, pageNumber = block.pageNumber, regionId) => props.onPosition({ mode: "pdf", page: pageNumber, blockId: block.id, ...(regionId ? { regionId } : {}) })} />
        </main>
        {rightOpen ? <div className="reader-resizer reader-resizer-right" role="separator" aria-label="调整篇篇侧栏宽度" title="拖动调整篇篇侧栏宽度" aria-orientation="vertical" aria-valuemin={panelLimits.assistant.min} aria-valuemax={clampWidth("assistant", panelLimits.assistant.max)} aria-valuenow={assistantWidth} tabIndex={0} onKeyDown={(event) => handleResizeKeyDown("assistant", event)} onPointerDown={(event) => startResize("assistant", event)} /> : null}
          {rightOpen ? <ReaderAssistant chartAnalysisRequestId={chartAnalysisRequestId} equationAnalysisRequestId={equationAnalysisRequestId} researchPanel={props.researchPanel} draftAppend={draftAppend} paragraphReadingMode={props.paragraphReadingMode ?? "standard"} onParagraphReadingModeChange={props.onParagraphReadingModeChange ?? (() => undefined)} vocabularyBlock={props.vocabularyBlock} onSaveTerm={props.onSaveTerm} isTermSaved={props.isTermSaved} originalId={paper.originalId} selectedBlock={selectedBlock} answer={props.streamingOutput?.operation === "qa" ? props.streamingOutput.text : answer} isBusy={isBusy} onTranslate={onTranslate} onReadChart={props.onReadChart} chartReading={props.chartReading} onReadEquation={props.onReadEquation} equationReading={props.equationReading} onExplain={props.onExplain} explanation={props.streamingOutput?.operation === "explain" ? props.streamingOutput.text : props.explanation} onAsk={props.aiAvailable ? onAsk : onOpenSettings} translation={props.streamingOutput?.operation === "translate" ? props.streamingOutput.text : props.translation} selectionText={props.selectionText} serviceLabel={props.serviceLabel} serviceModel={props.serviceModel} aiAvailable={props.aiAvailable} onOpenSettings={onOpenSettings} actionError={actionError} pendingAction={props.pendingAction} pendingParagraphActions={props.pendingParagraphActions} paragraphAnalysisRequestId={props.paragraphAnalysisRequestId} paragraphInsightText={props.paragraphInsightText} streamingOutput={props.streamingOutput} insight={props.insight} onInsight={props.aiAvailable ? props.onInsight : onOpenSettings} guide={props.guide} onGuide={props.aiAvailable ? props.onGuide : onOpenSettings} vocabulary={props.vocabulary} onJump={(id) => { const block = blocks.find((item) => item.id === id); if (block) navigate(block); }} /> : null}
      </div>
    </div>
  );
}
