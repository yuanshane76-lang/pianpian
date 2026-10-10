import { ArrowLeft, BookMarked, Check, FileText, PanelLeftClose, PanelRightClose, Search, Settings2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentBlock } from "../../domain/documentBlocks";
import type { PaperRecord } from "../../domain/library";
import type { PaperPipelineState } from "../../domain/pipeline";
import { PipelineStatusBar } from "./PipelineStatusBar";
import { PdfPreview } from "./PdfPreview";
import { ReaderAssistant } from "./ReaderAssistant";
import { hasPageBounds } from "../../domain/pdfLayout";

interface ReaderViewProps {
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
  paragraphAnalysisRequestId?: number;
  pendingParagraphActions?: Array<"translate" | "explain">;
  onOverview: () => void;
  onTranslate: () => void;
  onReadChart: () => void;
  chartReading: import("../../domain/learning").ChartReading | null;
  onExplain: () => void;
  explanation: string | null;
  onAsk: (question: string) => void;
  onOpenSettings: () => void;
  actionError: string | null;
  processingStatus: string;
  onEnhance: () => void;
  onRetryBasic: () => void;
  onReimport: (file: File) => void;
  onPosition: (position: NonNullable<PaperRecord["readingPosition"]>) => void;
  aiAvailable: boolean;
  serviceLabel: string;
  serviceModel: string;
  mineruConfigured: boolean;
  pendingAction: string | null;
  streamingOutput: { operation: import("../../services/ai").AiRequest["operation"]; text: string } | null;
  insight: { summary: string; role: string } | null;
  onInsight: () => void;
  guide: { overview: string; terms: Array<{ term: string; translation: string; definition: string }> } | null;
  onGuide: () => void;
  vocabulary: import("../../domain/vocabulary").AcademicTerm[];
  pipeline: PaperPipelineState;
}

export function ReaderView(props: ReaderViewProps) {
  const { paper, selectedBlock, answer, isBusy, onBack, onSelectBlock, onOverview, onTranslate, onAsk, onOpenSettings, actionError } = props;
  const blocks = paper.blockData ?? [];
  const [page, setPage] = useState(paper.readingPosition?.page ?? 1);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const layoutReady = blocks.some(hasPageBounds);
  const readyNotice = useRef({ paperId: paper.id, announced: false });
  const [toastPaperId, setToastPaperId] = useState<string | null>(null);
  const readerLayoutRef = useRef<HTMLDivElement>(null);
  const assistantToggleRef = useRef<HTMLButtonElement>(null);
  const focusSequence = useRef(0);
  const [focusTarget, setFocusTarget] = useState<{ id: string; requestId: number }>();
  const [navigationTarget, setNavigationTarget] = useState<{ page: number; requestId: number }>();
  const visibleBlocks = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return query ? blocks.filter((block) => block.text.toLocaleLowerCase().includes(query)) : blocks;
  }, [blocks, searchQuery]);

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

  useEffect(() => {
    setPage(paper.readingPosition?.page ?? 1);
    setNavigationTarget(undefined);
    setSearchOpen(false);
    setSearchQuery("");
    const target = paper.readingPosition?.blockId;
    setFocusTarget(target ? { id: target, requestId: ++focusSequence.current } : undefined);
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
    setFocusTarget({ id: block.id, requestId: ++focusSequence.current });
    setRightOpen(!window.matchMedia?.("(max-width: 840px)").matches);
    props.onSourceNavigationConsumed?.(props.sourceNavigation.requestId);
  }, [props.sourceNavigation, paper.id]);

  function select(block: DocumentBlock) {
    onSelectBlock(block);
    setPage(block.pageNumber);
    props.onPosition({ mode: "pdf", page: block.pageNumber, blockId: block.id });
  }

  function navigate(block: DocumentBlock) {
    setSearchQuery("");
    select(block);
    setFocusTarget({ id: block.id, requestId: ++focusSequence.current });
  }

  return (
    <div className="reader-shell">
      <header className="reader-topbar">
        <button className="back-button" onClick={onBack} type="button"><ArrowLeft size={17} />返回文献库</button>
        <div className="reader-title"><span className="reader-title-mark">PDF 阅读</span><strong>{paper.title}</strong></div>
        <div className="reader-surface-label"><FileText size={15} />原始排版 · MinerU 交互层</div>
        <div className="reader-toolbar">
          <button type="button" className="wordbook-button" aria-label="打开单词表" title="单词表" onClick={props.onOpenWordbook}><BookMarked size={17} /><span>单词表</span><small>{props.wordbookCount ?? 0}</small></button>
          <button className="icon-button" aria-label={leftOpen ? "收起目录" : "展开目录"} onClick={() => setLeftOpen(!leftOpen)}><PanelLeftClose size={17} /></button>
          <button ref={assistantToggleRef} className="icon-button" aria-label={rightOpen ? "收起助手" : "展开助手"} onClick={toggleAssistant}><PanelRightClose size={17} /></button>
          <button className="icon-button" aria-label="服务配置" onClick={onOpenSettings}><Settings2 size={17} /></button>
          <button className="icon-button" aria-label="搜索正文" aria-pressed={searchOpen} onClick={() => setSearchOpen(!searchOpen)}><Search size={17} /></button>
        </div>
      </header>
      <PipelineStatusBar state={props.pipeline} context={{
        originalAvailable: Boolean(paper.originalId), layoutReady,
        mineruConfigured: props.mineruConfigured,
        mineruPending: Boolean(paper.mineruBatchId), localParseFailed: paper.parseStatus === "fallback",
      }} onEnhance={props.onEnhance} onRetryBasic={props.onRetryBasic} onOpenSettings={onOpenSettings} />
      {toastPaperId === paper.id ? <div className="reader-ready-toast" role="status">
        <span className="reader-ready-toast-icon"><Check size={17} aria-hidden="true" /></span>
        <div><strong>段落定位已就绪</strong><span>点击原文或划选句子开始理解</span></div>
        <button className="icon-button" aria-label="关闭定位提示" type="button" onClick={() => setToastPaperId(null)}><X size={16} /></button>
      </div> : null}
      {searchOpen ? <div className="reader-searchbar"><Search size={16} /><input autoFocus aria-label="搜索正文内容" onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索正文内容" type="search" value={searchQuery} /><span>{visibleBlocks.length} 个匹配段落</span></div> : null}
      <div ref={readerLayoutRef} className={`reader-layout ${!leftOpen ? "left-collapsed" : ""} ${!rightOpen ? "right-collapsed" : ""}`}>
        {leftOpen ? <aside className="reader-outline">
          <div className="outline-label">原文页码</div>
          <div className="outline-pages">{Array.from({ length: paper.pageCount ?? 1 }, (_, index) => <button className={page === index + 1 ? "is-active" : ""} key={index} onClick={() => original(index + 1)}>第 {index + 1} 页</button>)}</div>
          <nav className="outline-sections">{blocks.filter((block) => block.kind === "heading").map((block) => <button key={block.id} onClick={() => navigate(block)} title={block.text}>{block.text}</button>)}</nav>
        </aside> : null}
        <main className="reader-document is-pdf">
          <PdfPreview paperId={paper.id} originalId={paper.originalId} page={page} onPage={original} navigationTarget={navigationTarget}
            onAnalyzeParagraph={(block) => {
              setPage(block.pageNumber);
              setRightOpen(true);
              props.onPosition({ mode: "pdf", page: block.pageNumber, blockId: block.id });
              if (props.aiAvailable) props.onAnalyzeParagraph(block);
              else { select(block); onOpenSettings(); }
            }}
            onVisiblePage={(visiblePage) => { setPage(visiblePage); props.onPosition({ mode: "pdf", page: visiblePage }); }}
            onReimport={props.onReimport} blocks={visibleBlocks} activeBlockId={selectedBlock?.id ?? null} onSelect={select} onSelectText={(block, text) => { select(block); props.onSelectText(block, text); }} focusTarget={focusTarget} onVisibleBlock={(block) => props.onPosition({ mode: "pdf", page: block.pageNumber, blockId: block.id })} />
        </main>
        {rightOpen ? <ReaderAssistant vocabularyBlock={props.vocabularyBlock} onSaveTerm={props.onSaveTerm} isTermSaved={props.isTermSaved} originalId={paper.originalId} selectedBlock={selectedBlock} overview={props.streamingOutput?.operation === "overview" ? props.streamingOutput.text : paper.overview} answer={props.streamingOutput?.operation === "qa" ? props.streamingOutput.text : answer} isBusy={isBusy} onOverview={props.aiAvailable ? onOverview : onOpenSettings} onTranslate={onTranslate} onReadChart={props.onReadChart} chartReading={props.chartReading} onExplain={props.onExplain} explanation={props.streamingOutput?.operation === "explain" ? props.streamingOutput.text : props.explanation} onAsk={props.aiAvailable ? onAsk : onOpenSettings} translation={props.streamingOutput?.operation === "translate" ? props.streamingOutput.text : props.translation} selectionText={props.selectionText} serviceLabel={props.serviceLabel} serviceModel={props.serviceModel} aiAvailable={props.aiAvailable} onOpenSettings={onOpenSettings} actionError={actionError} pendingAction={props.pendingAction} pendingParagraphActions={props.pendingParagraphActions} paragraphAnalysisRequestId={props.paragraphAnalysisRequestId} streamingOutput={props.streamingOutput} insight={props.insight} onInsight={props.aiAvailable ? props.onInsight : onOpenSettings} guide={props.guide} onGuide={props.aiAvailable ? props.onGuide : onOpenSettings} vocabulary={props.vocabulary} onJump={(id) => { const block = blocks.find((item) => item.id === id); if (block) navigate(block); }} /> : null}
      </div>
    </div>
  );
}
