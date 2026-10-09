import { ChevronLeft, ChevronRight, LoaderCircle, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { openPdf } from "../../services/document";
import { readOriginalPdf } from "../../services/originalPdf";
import type { DocumentBlock } from "../../domain/documentBlocks";
import { BlockList } from "./BlockList";
import { findPageBlockAtPoint, hasPageBounds } from "../../domain/pdfLayout";
import { renderPdfTextLayer } from "../../services/pdfTextLayer";

interface Props {
  paperId: string;
  originalId?: string;
  page: number;
  onPage: (page: number) => void;
  onReimport: (file: File) => void;
  blocks: DocumentBlock[];
  activeBlockId: string | null;
  translations: Record<string, string>;
  onSelect: (block: DocumentBlock) => void;
  onSelectText: (block: DocumentBlock, text: string) => void;
  focusTarget?: { id: string; requestId: number };
  onVisibleBlock?: (block: DocumentBlock) => void;
}

export function PdfPreview({ originalId, page, onPage, onReimport, blocks, activeBlockId, onSelect, onSelectText, focusTarget, onVisibleBlock }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>();
  const handledFocus = useRef<number>();
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1.1);
  const [fitWidth, setFitWidth] = useState(true);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [renderedZoom, setRenderedZoom] = useState(1.1);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [geometry, setGeometry] = useState<{ originalId: string; page: number; width: number; height: number } | null>(null);
  const pageBlocks = blocks.filter((block) => block.pageNumber === page);
  const positionedBlocks = pageBlocks.filter(hasPageBounds);
  const interactive = !busy && !error && geometry?.originalId === originalId && geometry?.page === page;

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setAvailableWidth(scroll.clientWidth));
    observer.observe(scroll);
    setAvailableWidth(scroll.clientWidth);
    return () => observer.disconnect();
  }, [originalId]);

  useEffect(() => {
    let active = true;
    setError("");
    setPageCount(0);
    setGeometry(null);
    setHoveredBlockId(null);
    setBusy(true);
    if (!originalId) { setBusy(false); return; }
    void readOriginalPdf(originalId).then(openPdf).then((document) => {
      if (!active) { void document.destroy(); return; }
      documentRef.current = document;
      setPageCount(document.numPages);
    }).catch((cause) => { if (active) { setError(String(cause.message ?? cause)); setBusy(false); } });
    return () => { active = false; const current = documentRef.current; documentRef.current = null; void current?.destroy(); };
  }, [originalId]);

  useEffect(() => {
    const document = documentRef.current;
    const canvas = canvasRef.current;
    if (!document || !canvas || !pageCount) return;
    let active = true;
    let task: RenderTask | undefined;
    let textTask: ReturnType<typeof renderPdfTextLayer> | undefined;
    setBusy(true);
    setError("");
    void document.getPage(Math.min(Math.max(page, 1), pageCount)).then(async (pdfPage) => {
      if (!active) return;
      const scale = fitWidth && availableWidth > 40
        ? Math.min(2.6, Math.max(.4, (availableWidth - 40) / pdfPage.getViewport({ scale: 1 }).width))
        : zoom;
      const viewport = pdfPage.getViewport({ scale });
      setGeometry({ originalId: originalId!, page, width: viewport.width, height: viewport.height });
      setRenderedZoom(scale);
      const density = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * density);
      canvas.height = Math.floor(viewport.height * density);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法绘制 PDF");
      task = pdfPage.render({ canvasContext: context, viewport, transform: density === 1 ? undefined : [density, 0, 0, density, 0, 0] });
      if (textRef.current) {
        textTask = renderPdfTextLayer(pdfPage, viewport, textRef.current);
        // A scanned or malformed text layer must not block the original page.
        void textTask.promise.catch(() => {});
      }
      await task.promise;
      if (active) setBusy(false);
    }).catch((cause) => {
      if (active && cause.name !== "RenderingCancelledException") { setError(String(cause.message ?? cause)); setBusy(false); }
    });
    return () => { active = false; clearTimeout(scrollTimer.current); task?.cancel(); textTask?.cancel(); textRef.current?.replaceChildren(); };
  }, [originalId, page, pageCount, zoom, fitWidth, availableWidth]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [originalId, page]);

  useEffect(() => { handledFocus.current = undefined; }, [originalId]);

  useEffect(() => {
    if (!interactive || !focusTarget || handledFocus.current === focusTarget.requestId) return;
    const elements = stageRef.current?.querySelectorAll<HTMLElement>(".pdf-block-hit-area");
    const target = Array.from(elements || []).find((item) => item.id === `pdf-block-${focusTarget.id}`);
    if (!target) return;
    handledFocus.current = focusTarget.requestId;
    target.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [interactive, focusTarget, blocks]);

  function blockAt(clientX: number, clientY: number) {
    if (!interactive) return null;
    const frame = stageRef.current?.getBoundingClientRect();
    if (!frame?.width || !frame.height) return null;
    return findPageBlockAtPoint(positionedBlocks, (clientX - frame.left) / frame.width, (clientY - frame.top) / frame.height);
  }

  function selectedSentence() {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text || !selection?.rangeCount || !stageRef.current?.contains(selection.anchorNode)) return null;
    const rect = Array.from(selection.getRangeAt(0).getClientRects()).find((item) => item.width && item.height);
    const block = rect ? blockAt(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
    return block ? { block, text } : null;
  }

  if (!originalId) return <div className="pdf-missing">
    <h3>这篇旧记录没有保存原始 PDF</h3>
    <p>重新选择同一份 PDF，应用会保存原件并重新整理正文。</p>
    <label className="secondary-button">重新导入 PDF<input type="file" accept=".pdf" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) onReimport(file); event.currentTarget.value = ""; }} /></label>
  </div>;
  return <section className="pdf-preview" aria-label="论文 PDF 阅读区">
    <div className="pdf-controls">
      <button className="icon-button" aria-label="上一页" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={18} /></button>
      <label>第 <input aria-label="PDF 页码" type="number" min={1} max={pageCount || 1} value={page} onChange={(event) => { const value = Number(event.target.value); if (value >= 1 && value <= pageCount) onPage(value); }} /> / {pageCount || "…"} 页</label>
      <button className="icon-button" aria-label="下一页" disabled={page >= pageCount} onClick={() => onPage(page + 1)}><ChevronRight size={18} /></button>
      <span className="pdf-control-spacer" />
      <button className="icon-button" aria-label="缩小 PDF" disabled={renderedZoom <= .4} onClick={() => { setFitWidth(false); setZoom(Math.max(.4, renderedZoom - .2)); }}><Minus size={17} /></button>
      <span>{Math.round(renderedZoom * 100)}%</span>
      <button className="icon-button" aria-label="放大 PDF" disabled={renderedZoom >= 2.6} onClick={() => { setFitWidth(false); setZoom(Math.min(2.6, renderedZoom + .2)); }}><Plus size={17} /></button>
      <button className="text-button" aria-pressed={fitWidth} onClick={() => setFitWidth(true)}>适应宽度</button>
    </div>
    {busy ? <div className="pdf-feedback" role="status"><LoaderCircle size={16} className="spin" /> 正在加载原页…</div> : null}
    {error ? <div role="alert" className="parse-warning">{error}<button onClick={() => onPage(1)}>返回首页</button></div> : null}
    {!busy && blocks.length > 0 && positionedBlocks.length === 0 ? <div className="pdf-layout-notice" role="status">本页识别内容尚无可靠坐标，原文仍可阅读。</div> : null}
    <div className="pdf-canvas-scroll" ref={scrollRef} onScroll={(event) => {
      clearTimeout(scrollTimer.current);
      if (!interactive || !onVisibleBlock) return;
      const container = event.currentTarget;
      scrollTimer.current = setTimeout(() => {
        const top = container.getBoundingClientRect().top + 45;
        const target = Array.from(container.querySelectorAll<HTMLElement>(".pdf-block-hit-area"))
          .find((element) => element.getBoundingClientRect().bottom >= top);
        const block = target ? positionedBlocks.find((item) => target.id === `pdf-block-${item.id}`) : null;
        if (block) onVisibleBlock(block);
      }, 400);
    }}>
      <div className="pdf-page-stage" ref={stageRef}
        style={geometry ? { width: geometry.width, height: geometry.height } : undefined}
        onPointerMove={(event) => setHoveredBlockId(blockAt(event.clientX, event.clientY)?.id ?? null)}
        onPointerLeave={() => setHoveredBlockId(null)}
        onMouseUp={() => {
          const selected = selectedSentence();
          if (selected) onSelectText(selected.block, selected.text);
        }}
        onClick={(event) => {
          if (!(event.target instanceof Element) || event.target.closest(".pdf-block-hit-area")) return;
          if (!window.getSelection()?.toString().trim()) {
            const block = blockAt(event.clientX, event.clientY);
            if (block) onSelect(block);
          }
        }}
      >
        <canvas ref={canvasRef} aria-label={`论文原文第 ${page} 页，包含原始图表和公式`} />
        <div className="pdf-text-layer" ref={textRef} style={{ visibility: interactive ? "visible" : "hidden" }} />
        {interactive && positionedBlocks.length ? (
          <div className="pdf-structure-overlay" aria-label="MinerU 结构化交互层">
            <BlockList
              blocks={positionedBlocks}
              activeBlockId={activeBlockId}
              hoveredBlockId={hoveredBlockId}
              onSelect={(block) => { window.getSelection()?.removeAllRanges(); onSelect(block); }}
            />
          </div>
        ) : null}
      </div>
    </div>
  </section>;
}
