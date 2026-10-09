import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { PDFPageProxy, RenderTask } from "pdfjs-dist";
import type { DocumentBlock } from "../../domain/documentBlocks";
import type { PdfPageLayout } from "../../domain/pdfScroll";
import { findPageBlockAtPoint, hasPageBounds } from "../../domain/pdfLayout";
import { renderPdfTextLayer } from "../../services/pdfTextLayer";
import { BlockList } from "./BlockList";

export function PdfPageCanvas({ pdfPage, layout, blocks, activeBlockId, onSelect, onSelectText, onAnalyzeParagraph, onReady }: {
  pdfPage: PDFPageProxy; layout: PdfPageLayout; blocks: DocumentBlock[]; activeBlockId: string | null;
  onSelect: (block: DocumentBlock) => void; onSelectText: (block: DocumentBlock, text: string) => void;
  onReady: (page: number, ready: boolean) => void;
  onAnalyzeParagraph?: (block: DocumentBlock) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [readyScale, setReadyScale] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const positionedBlocks = blocks.filter(hasPageBounds);
  const interactive = readyScale === layout.scale && !error;

  useEffect(() => {
    const canvas = canvasRef.current;
    const text = textRef.current;
    if (!canvas || !text) return;
    let active = true;
    let task: RenderTask | undefined;
    let textTask: ReturnType<typeof renderPdfTextLayer> | undefined;
    setReadyScale(null); setError(""); onReady(layout.pageNumber, false);
    const viewport = pdfPage.getViewport({ scale: layout.scale });
    const density = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(layout.width * density);
    canvas.height = Math.floor(layout.height * density);
    canvas.style.width = `${layout.width}px`;
    canvas.style.height = `${layout.height}px`;
    void (async () => {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法绘制 PDF");
      task = pdfPage.render({ canvasContext: context, viewport, transform: density === 1 ? undefined : [density, 0, 0, density, 0, 0] });
      textTask = renderPdfTextLayer(pdfPage, viewport, text);
      void textTask.promise.catch(() => {});
      await task.promise;
      if (active) { setReadyScale(layout.scale); onReady(layout.pageNumber, true); }
    })().catch((cause) => {
      if (active && cause?.name !== "RenderingCancelledException") setError(String(cause?.message ?? cause));
    });
    return () => { active = false; task?.cancel(); textTask?.cancel(); text.replaceChildren(); onReady(layout.pageNumber, false); canvas.width = 0; canvas.height = 0; };
  }, [pdfPage, layout.scale, layout.width, layout.height, layout.pageNumber, onReady]);

  function blockAt(clientX: number, clientY: number) {
    if (!interactive) return null;
    const frame = stageRef.current?.getBoundingClientRect();
    if (!frame?.width || !frame.height) return null;
    return findPageBlockAtPoint(positionedBlocks, (clientX - frame.left) / frame.width, (clientY - frame.top) / frame.height);
  }

  function selectedSentence() {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!interactive || !text || !selection?.rangeCount || !stageRef.current?.contains(selection.anchorNode)) return null;
    const range = selection.getRangeAt(0);
    const rect = Array.from(range.getClientRects()).find((item) => item.width && item.height);
    const block = rect ? blockAt(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
    return block ? { block, text } : null;
  }

  function analyzeParagraph(block: DocumentBlock) {
    if (block.kind !== "paragraph" || !onAnalyzeParagraph) return;
    window.getSelection()?.removeAllRanges();
    onAnalyzeParagraph(block);
  }

  return <div className="pdf-page-stage" ref={stageRef} data-page-number={layout.pageNumber}
    data-rendered={interactive ? "true" : "false"} style={{ width: layout.width, height: layout.height }}
    onPointerMove={(event) => setHoveredBlockId(blockAt(event.clientX, event.clientY)?.id ?? null)}
    onPointerLeave={() => setHoveredBlockId(null)}
    onMouseDown={(event) => {
      if (event.detail > 1 && onAnalyzeParagraph && blockAt(event.clientX, event.clientY)?.kind === "paragraph") event.preventDefault();
    }}
    onMouseUp={(event) => {
      if (event.detail > 1 && onAnalyzeParagraph && blockAt(event.clientX, event.clientY)?.kind === "paragraph") return;
      const selected = selectedSentence(); if (selected) onSelectText(selected.block, selected.text);
    }}
    onClick={(event) => {
      if (event.detail > 1 || !(event.target instanceof Element) || event.target.closest(".pdf-block-hit-area")) return;
      if (!window.getSelection()?.toString().trim()) { const block = blockAt(event.clientX, event.clientY); if (block) onSelect(block); }
    }}
    onDoubleClick={(event) => {
      const block = blockAt(event.clientX, event.clientY);
      if (block?.kind !== "paragraph" || !onAnalyzeParagraph) return;
      event.preventDefault();
      analyzeParagraph(block);
    }}>
    <canvas ref={canvasRef} aria-label={`论文原文第 ${layout.pageNumber} 页，包含原始图表和公式`} />
    <div className="pdf-text-layer" ref={textRef} style={{ visibility: interactive ? "visible" : "hidden" }} />
    {interactive && positionedBlocks.length ? <div className="pdf-structure-overlay" aria-label={`第 ${layout.pageNumber} 页 MinerU 结构化交互层`}>
      <BlockList blocks={positionedBlocks} activeBlockId={activeBlockId} hoveredBlockId={hoveredBlockId}
        onSelect={(block) => { window.getSelection()?.removeAllRanges(); onSelect(block); }}
        onAnalyzeParagraph={onAnalyzeParagraph ? analyzeParagraph : undefined} />
    </div> : null}
    {!interactive ? <div className="pdf-page-loading" role={error ? "alert" : "status"}>
      {error || <><LoaderCircle size={16} className="spin" />正在加载第 {layout.pageNumber} 页…</>}
    </div> : null}
  </div>;
}
