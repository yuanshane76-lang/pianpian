import { ArrowLeft, FileText, PanelLeftClose, PanelRightClose, Search, Settings2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentBlock } from "../../domain/documentBlocks";
import type { PaperRecord } from "../../domain/library";
import type { PaperPipelineState } from "../../domain/pipeline";
import { PipelineStatusBar } from "./PipelineStatusBar";
import { PdfPreview } from "./PdfPreview";
import { ReaderAssistant } from "./ReaderAssistant";
import { hasPageBounds } from "../../domain/pdfLayout";

interface ReaderViewProps {
  paper: PaperRecord;
  selectedBlock: DocumentBlock | null;
  selectionText: string;
  translations: Record<string, string>;
  translation: string | null;
  answer: string | null;
  isBusy: boolean;
  onBack: () => void;
  onSelectBlock: (block: DocumentBlock | null) => void;
  onSelectText: (block: DocumentBlock, text: string) => void;
  onOverview: () => void;
  onTranslate: () => void;
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
  onPausePipeline: () => void;
  onResumePipeline: () => void;
  onRetryPipeline: () => void;
}

export function ReaderView(props: ReaderViewProps) {
  const { paper, selectedBlock, translations, answer, isBusy, onBack, onSelectBlock, onOverview, onTranslate, onAsk, onOpenSettings, actionError } = props;
  const blocks = paper.blockData ?? [];
  const [page, setPage] = useState(paper.readingPosition?.page ?? 1);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const focusSequence = useRef(0);
  const [focusTarget, setFocusTarget] = useState<{ id: string; requestId: number }>();
  const visibleBlocks = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return query ? blocks.filter((block) => block.text.toLocaleLowerCase().includes(query)) : blocks;
  }, [blocks, searchQuery]);

  useEffect(() => {
    setPage(paper.readingPosition?.page ?? 1);
    setSearchOpen(false);
    setSearchQuery("");
    const target = paper.readingPosition?.blockId;
    setFocusTarget(target ? { id: target, requestId: ++focusSequence.current } : undefined);
  }, [paper.id]);

  function original(targetPage: number) {
    setPage(targetPage);
    if (selectedBlock?.pageNumber !== targetPage) onSelectBlock(null);
    props.onPosition({ mode: "pdf", page: targetPage });
  }

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
          <button className="icon-button" aria-label={leftOpen ? "收起目录" : "展开目录"} onClick={() => setLeftOpen(!leftOpen)}><PanelLeftClose size={17} /></button>
          <button className="icon-button" aria-label={rightOpen ? "收起助手" : "展开助手"} onClick={() => setRightOpen(!rightOpen)}><PanelRightClose size={17} /></button>
          <button className="icon-button" aria-label="服务配置" onClick={onOpenSettings}><Settings2 size={17} /></button>
          <button className="icon-button" aria-label="搜索正文" aria-pressed={searchOpen} onClick={() => setSearchOpen(!searchOpen)}><Search size={17} /></button>
        </div>
      </header>
      <PipelineStatusBar state={props.pipeline} onPause={props.onPausePipeline} onResume={props.onResumePipeline} onRetry={props.onRetryPipeline} />
      <div className="reader-processing" role="status">
        <span>{props.processingStatus || (blocks.some(hasPageBounds) ? "段落定位已就绪，点击原文或划选句子开始理解" : props.pipeline.source === "mineru" && props.pipeline.stage === "partial" ? "此次结果不含可靠坐标，原文仍可阅读。可重新解析。" : "原文已可阅读，正在准备段落定位…")}</span>
        <button className="text-button" disabled={Boolean(props.processingStatus) || blocks.some(hasPageBounds)} onClick={props.mineruConfigured ? props.onEnhance : onOpenSettings}>{blocks.some(hasPageBounds) ? "定位已就绪" : props.mineruConfigured ? paper.mineruBatchId ? "继续 MinerU 解析" : props.pipeline.source === "mineru" ? "重新 MinerU 解析" : "开始 MinerU 解析" : "配置 MinerU"}</button>
        {paper.parseStatus === "fallback" ? <button className="text-button" onClick={props.onRetryBasic}>重试正文整理</button> : null}
      </div>
      {searchOpen ? <div className="reader-searchbar"><Search size={16} /><input autoFocus aria-label="搜索正文内容" onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索正文内容" type="search" value={searchQuery} /><span>{visibleBlocks.length} 个匹配段落</span></div> : null}
      <div className={`reader-layout ${!leftOpen ? "left-collapsed" : ""} ${!rightOpen ? "right-collapsed" : ""}`}>
        {leftOpen ? <aside className="reader-outline">
          <div className="outline-label">原文页码</div>
          <div className="outline-pages">{Array.from({ length: paper.pageCount ?? 1 }, (_, index) => <button className={page === index + 1 ? "is-active" : ""} key={index} onClick={() => original(index + 1)}>第 {index + 1} 页</button>)}</div>
          <nav className="outline-sections">{blocks.filter((block) => block.kind === "heading").map((block) => <button key={block.id} onClick={() => navigate(block)} title={block.text}>{block.text}</button>)}</nav>
          <div className="outline-hint">PDF 保持原始排版；点击 MinerU 识别出的段落、图表或公式，即可在右侧翻译和理解。</div>
        </aside> : null}
        <main className="reader-document is-pdf">
          <PdfPreview paperId={paper.id} originalId={paper.originalId} page={page} onPage={original} onReimport={props.onReimport} blocks={visibleBlocks} activeBlockId={selectedBlock?.id ?? null} translations={translations} onSelect={select} onSelectText={(block, text) => { select(block); props.onSelectText(block, text); }} focusTarget={focusTarget} onVisibleBlock={(block) => props.onPosition({ mode: "pdf", page: block.pageNumber, blockId: block.id })} />
        </main>
        {rightOpen ? <ReaderAssistant selectedBlock={selectedBlock} overview={props.streamingOutput?.operation === "overview" ? props.streamingOutput.text : paper.overview} answer={props.streamingOutput?.operation === "qa" ? props.streamingOutput.text : answer} isBusy={isBusy} onOverview={props.aiAvailable ? onOverview : onOpenSettings} onTranslate={onTranslate} onExplain={props.onExplain} explanation={props.streamingOutput?.operation === "explain" ? props.streamingOutput.text : props.explanation} onAsk={props.aiAvailable ? onAsk : onOpenSettings} translation={props.streamingOutput?.operation === "translate" ? props.streamingOutput.text : props.translation} selectionText={props.selectionText} serviceLabel={props.serviceLabel} serviceModel={props.serviceModel} aiAvailable={props.aiAvailable} onOpenSettings={onOpenSettings} actionError={actionError} pendingAction={props.pendingAction} streamingOutput={props.streamingOutput} insight={props.insight} onInsight={props.aiAvailable ? props.onInsight : onOpenSettings} guide={props.guide} onGuide={props.aiAvailable ? props.onGuide : onOpenSettings} vocabulary={props.vocabulary} pipeline={props.pipeline} onPausePipeline={props.onPausePipeline} onResumePipeline={props.onResumePipeline} onRetryPipeline={props.onRetryPipeline} onJump={(id) => { const block = blocks.find((item) => item.id === id); if (block) navigate(block); }} /> : null}
      </div>
    </div>
  );
}
