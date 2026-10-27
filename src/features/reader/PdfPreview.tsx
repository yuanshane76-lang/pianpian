import { ChevronLeft, ChevronRight, LoaderCircle, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import { openPdf } from "../../services/document";
import { readOriginalPdf } from "../../services/originalPdf";
import { createPdfPageLoader } from "../../services/pdfPageLoader";
import type { DocumentBlock } from "../../domain/documentBlocks";
import { getPageBlockRegionId, getPageBlocks, hasPageBounds } from "../../domain/pdfLayout";
import { buildPdfPageLayout, getPdfViewportPages, PDF_SCROLL_PADDING, type PdfPageLayout } from "../../domain/pdfScroll";
import { PdfPageCanvas } from "./PdfPageCanvas";

interface Props {
  paperId: string;
  originalId?: string;
  page: number;
  /** 演示文稿场景：左键拖拽框选多段（替代文本划选）。 */
  deckMode?: boolean;
  onPage: (page: number) => void;
  onVisiblePage?: (page: number) => void;
  navigationTarget?: { page: number; requestId: number };
  onReimport: (file: File) => void;
  blocks: DocumentBlock[];
  activeBlockId: string | null;
  onSelect: (block: DocumentBlock, pageNumber?: number, regionId?: string) => void;
  onSelectText: (block: DocumentBlock, text: string, pageNumber?: number, regionId?: string) => void;
  onAnalyzeParagraph?: (block: DocumentBlock, pageNumber?: number, regionId?: string) => void;
  onAnalyzeChart?: (block: DocumentBlock, pageNumber?: number, regionId?: string) => void;
  onAnalyzeEquation?: (block: DocumentBlock, pageNumber?: number, regionId?: string) => void;
  onAddToConversation?: (block: DocumentBlock, pageNumber?: number, regionId?: string) => void;
  focusTarget?: { id: string; requestId: number; pageNumber?: number; regionId?: string; flash?: boolean };
  onVisibleBlock?: (block: DocumentBlock, pageNumber?: number, regionId?: string) => void;
}
type PdfDocument = Awaited<ReturnType<typeof openPdf>>;
interface PdfSource {
  id: string;
  generation: number;
  document: PdfDocument;
  pages: Array<PDFPageProxy | undefined>;
  sizes: Array<{ width: number; height: number }>;
  pageCount: number;
  loader: ReturnType<typeof createPdfPageLoader>;
}
const EMPTY_PAGES: Array<PDFPageProxy | undefined> = [];

export function PdfPreview(props: Props) {
  const { originalId, page, onPage, onReimport, blocks, activeBlockId, onSelect, onSelectText, navigationTarget, focusTarget, deckMode } = props;

  useEffect(() => {
    if (!deckMode) return;
    function intersects(a: DOMRect, b: { left: number; top: number; right: number; bottom: number }): boolean {
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }
    function move(moveEvent: MouseEvent) {
      const drag = marqueeDrag.current;
      if (!drag) return;
      setMarquee((current) => current ? { ...current, x1: moveEvent.clientX, y1: moveEvent.clientY } : current);
      const rect = { left: Math.min(drag.startX, moveEvent.clientX), top: Math.min(drag.startY, moveEvent.clientY),
        right: Math.max(drag.startX, moveEvent.clientX), bottom: Math.max(drag.startY, moveEvent.clientY) };
      for (const element of scrollRef.current?.querySelectorAll<HTMLElement>("[data-block-id]") ?? []) {
        element.classList.toggle("is-marquee-selected", intersects(element.getBoundingClientRect(), rect));
      }
    }
    function up(upEvent: MouseEvent) {
      const drag = marqueeDrag.current;
      if (!drag) return;
      marqueeDrag.current = null;
      setMarquee(null);
      const rect = { left: Math.min(drag.startX, upEvent.clientX), top: Math.min(drag.startY, upEvent.clientY),
        right: Math.max(drag.startX, upEvent.clientX), bottom: Math.max(drag.startY, upEvent.clientY) };
      if (rect.right - rect.left + rect.bottom - rect.top < 6) return; // 普通点击
      suppressClickUntil.current = Date.now() + 250;
      const picked: DocumentBlock[] = [];
      for (const element of scrollRef.current?.querySelectorAll<HTMLElement>("[data-block-id].is-marquee-selected") ?? []) {
        const block = blocks.find((item) => item.id === element.dataset.blockId);
        if (block) picked.push(block);
      }
      for (const element of scrollRef.current?.querySelectorAll<HTMLElement>(".is-marquee-selected") ?? []) {
        element.classList.remove("is-marquee-selected");
      }
      if (!picked.length || !onSelectText) return;
      const ordered = [...picked].sort((left, right) => left.pageNumber - right.pageNumber || left.order - right.order);
      const joined = ordered.map((item) => item.text.trim()).filter(Boolean).join("\n\n");
      onSelectText(ordered[0], joined);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [deckMode, blocks, onSelectText]);
  // 演示文稿框选：拖出矩形命中段落块即多选，合并文本走划选链路。
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const marqueeDrag = useRef<{ startX: number; startY: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>();
  const focusFlashTimer = useRef<ReturnType<typeof setTimeout>>();
  const propsRef = useRef(props);
  propsRef.current = props;
  const loadedId = useRef<string>();
  const previousLayout = useRef<PdfPageLayout[]>([]);
  const reportedPage = useRef(page);
  const handledNavigation = useRef<number>();
  const handledFocus = useRef<number>();
  const sourceRef = useRef<PdfSource | null>(null);
  const sourceGeneration = useRef(0);
  const [source, setSource] = useState<PdfSource | null>(null);
  sourceRef.current = source;
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1.1);
  const [fitWidth, setFitWidth] = useState(true);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [renderRange, setRenderRange] = useState({ start: 1, end: 3 });
  const [readyPages, setReadyPages] = useState<Record<number, boolean>>({});
  const [focusFlashRegionId, setFocusFlashRegionId] = useState<string | null>(null);
  const pages = source && source.id === originalId ? source.pages : EMPTY_PAGES;
  const sizes = source && source.id === originalId ? source.sizes : [];
  const layout = useMemo(() => buildPdfPageLayout(sizes, zoom, availableWidth, fitWidth), [sizes, zoom, availableWidth, fitWidth]);
  // Capture before React commits smaller slots and the browser clamps scrollTop.
  const scrollTopBeforeLayout = scrollRef.current?.scrollTop ?? 0;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const pageCount = source && source.id === originalId ? source.pageCount : 0;
  // ReaderView assigns both kinds of navigation from one increasing sequence.
  const focusIsLatest = Boolean(focusTarget && (!navigationTarget || focusTarget.requestId >= navigationTarget.requestId));
  const navigationIsLatest = Boolean(navigationTarget && (!focusTarget || navigationTarget.requestId > focusTarget.requestId));
  const focusBlock = focusTarget ? blocks.find((block) => block.id === focusTarget.id) : undefined;
  const pendingFocusPage = focusIsLatest && focusTarget && focusBlock && hasPageBounds(focusBlock) && handledFocus.current !== focusTarget.requestId
    ? focusTarget.pageNumber ?? focusBlock.pageNumber
    : undefined;
  const pendingNavigationPage = navigationIsLatest && navigationTarget && handledNavigation.current !== navigationTarget.requestId
    ? Math.min(Math.max(navigationTarget.page, 1), pageCount || 1) : undefined;
  const pendingPage = pendingFocusPage ?? pendingNavigationPage;
  const renderedZoom = layout[Math.min(Math.max(page - 1, 0), layout.length - 1)]?.scale ?? zoom;
  const canonicalBlocks = useMemo(() => new Map(blocks.map((block) => [block.id, block])), [blocks]);
  const pageBlocks = useMemo(() => {
    const result = new Map<number, DocumentBlock[]>();
    for (const block of blocks.filter(hasPageBounds)) {
      const numbers = new Set(block.pageBounds?.map((region) => region.pageNumber) ?? [block.pageNumber]);
      for (const number of numbers) {
        const current = result.get(number) ?? [];
        current.push(...getPageBlocks([block], number));
        result.set(number, current);
      }
    }
    return result;
  }, [blocks]);

  function regionLocation(block: DocumentBlock, canonical: DocumentBlock): [pageNumber?: number, regionId?: string] {
    // An optional physical identity is only needed when a page has multiple regions.
    if ((block.pageBounds?.filter((region) => region.pageNumber === block.pageNumber).length ?? 0) > 1) {
      return [block.pageNumber, getPageBlockRegionId(block)];
    }
    return block.pageNumber === canonical.pageNumber ? [] : [block.pageNumber];
  }

  function updateViewport(notify: boolean) {
    const scroll = scrollRef.current;
    const currentLayout = layoutRef.current;
    if (!scroll || !currentLayout.length) return;
    const view = getPdfViewportPages(currentLayout, Math.max(0, scroll.scrollTop - PDF_SCROLL_PADDING), scroll.clientHeight || 800);
    setRenderRange((current) => current.start === view.start && current.end === view.end ? current : { start: view.start, end: view.end });
    if (notify && view.page !== reportedPage.current) {
      reportedPage.current = view.page;
      propsRef.current.onVisiblePage?.(view.page);
    }
  }
  function syncVisibleBlock(currentPage: number) {
    const scroll = scrollRef.current;
    const item = layoutRef.current[currentPage - 1];
    if (!scroll || !item) return;
    const viewportTop = scroll.scrollTop - PDF_SCROLL_PADDING;
    const viewportBottom = viewportTop + (scroll.clientHeight || 800);
    const candidates = getPageBlocks(propsRef.current.blocks, currentPage);
    const block = candidates
      .map((candidate) => {
        const [, top, , bottom] = candidate.bbox!;
        const blockTop = item.top + top * item.height, blockBottom = item.top + bottom * item.height;
        const center = (blockTop + blockBottom) / 2;
        return { candidate, distance: Math.abs(center - (viewportTop + viewportBottom) / 2), blockTop, blockBottom };
      })
      .filter(({ blockTop, blockBottom }) => blockBottom > viewportTop && blockTop < viewportBottom)
      .sort((left, right) => left.distance - right.distance)[0]?.candidate;
    if (block) {
      const canonical = propsRef.current.blocks.find((candidate) => candidate.id === block.id)!;
      propsRef.current.onVisibleBlock?.(canonical, ...regionLocation(block, canonical));
    }
  }
  const updateViewportRef = useRef(updateViewport);
  updateViewportRef.current = updateViewport;
  const onReady = useCallback((number: number, ready: boolean) => {
    setReadyPages((current) => current[number] === ready ? current : { ...current, [number]: ready });
  }, []);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (typeof ResizeObserver === "undefined") { setAvailableWidth(scroll.clientWidth); return; }
    const observer = new ResizeObserver(() => {
      setAvailableWidth(scroll.clientWidth);
      updateViewportRef.current(false);
    });
    observer.observe(scroll);
    setAvailableWidth(scroll.clientWidth);
    return () => observer.disconnect();
  }, [originalId]);

  useEffect(() => {
    let active = true;
    const generation = sourceGeneration.current + 1;
    sourceGeneration.current = generation;
    let document: PdfDocument | undefined;
    let loader: ReturnType<typeof createPdfPageLoader> | undefined;
    setSource(null); setReadyPages({}); setError(""); setBusy(true);
    loadedId.current = undefined;
    previousLayout.current = [];
    handledNavigation.current = undefined;
    handledFocus.current = undefined;
    clearTimeout(scrollTimer.current);
    clearTimeout(focusFlashTimer.current);
    setFocusFlashRegionId(null);
    if (!originalId) { setBusy(false); return; }
    void (async () => {
      const data = await readOriginalPdf(originalId);
      if (!active) return;
      document = await openPdf(data);
      if (!active) { await document.destroy(); return; }
      const firstPage = await document.getPage(1);
      if (!active) { await document.destroy(); return; }
      const viewport = firstPage.getViewport({ scale: 1 });
      loader = createPdfPageLoader(document, (number, pdfPage) => {
        setSource((previous) => {
          if (!previous || previous.id !== originalId || previous.generation !== generation) return previous;
          const pages = [...previous.pages];
          const sizes = [...previous.sizes];
          pages[number - 1] = pdfPage;
          const size = pdfPage.getViewport({ scale: 1 });
          sizes[number - 1] = { width: size.width, height: size.height };
          return { ...previous, pages, sizes };
        });
      }, (cause) => {
        if (active) setError(String(cause instanceof Error ? cause.message : cause));
      });
      setSource({
        id: originalId,
        generation,
        document,
        pages: [firstPage, ...new Array(document.numPages - 1)],
        sizes: Array.from({ length: document.numPages }, () => ({ width: viewport.width, height: viewport.height })),
        pageCount: document.numPages,
        loader,
      });
      setBusy(false);
    })().catch((cause) => { if (active) { setError(String(cause?.message ?? cause)); setBusy(false); } });
    return () => { active = false; loader?.dispose(); clearTimeout(scrollTimer.current); void document?.destroy(); };
  }, [originalId]);

  useEffect(() => () => clearTimeout(focusFlashTimer.current), []);

  useEffect(() => {
    const current = sourceRef.current;
    if (!current || current.id !== originalId) return;
    const targets = [pendingPage ?? Math.min(Math.max(page, 1), current.pageCount)];
    for (let number = renderRange.start; number <= renderRange.end; number += 1) {
      if (number >= 1 && number <= current.pageCount) targets.push(number);
    }
    current.loader.request(targets);
  }, [originalId, page, pendingPage, renderRange.start, renderRange.end, source?.generation]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !layout.length || !originalId) return;
    const oldLayout = previousLayout.current;
    if (loadedId.current !== originalId) {
      const initialPage = Math.min(Math.max(propsRef.current.page, 1), layout.length);
      scroll.scrollTop = PDF_SCROLL_PADDING + layout[initialPage - 1].top;
      reportedPage.current = initialPage;
      loadedId.current = originalId;
    } else if (oldLayout.length) {
      const top = Math.max(0, scrollTopBeforeLayout - PDF_SCROLL_PADDING);
      const anchor = [...oldLayout].reverse().find((item) => item.top <= top) ?? oldLayout[0];
      const destination = layout[anchor.pageNumber - 1];
      const fraction = Math.min(1, Math.max(0, (top - anchor.top) / anchor.height));
      const gapOffset = anchor.pageNumber < oldLayout.length ? Math.max(0, top - anchor.top - anchor.height) : 0;
      if (destination) scroll.scrollTop = PDF_SCROLL_PADDING + destination.top + fraction * destination.height + gapOffset;
    }
    previousLayout.current = layout;
    updateViewportRef.current(false);
  }, [layout, originalId]);

  useLayoutEffect(() => {
    if (!navigationIsLatest || !navigationTarget || !layout.length || handledNavigation.current === navigationTarget.requestId) return;
    const destination = layout[Math.min(Math.max(navigationTarget.page - 1, 0), layout.length - 1)];
    if (!scrollRef.current || !destination) return;
    scrollRef.current.scrollTop = PDF_SCROLL_PADDING + destination.top;
    reportedPage.current = destination.pageNumber;
    updateViewportRef.current(false);
    if (readyPages[destination.pageNumber]) handledNavigation.current = navigationTarget.requestId;
  }, [navigationIsLatest, navigationTarget, layout, readyPages]);

  useLayoutEffect(() => {
    if (!focusIsLatest || !focusTarget || !layout.length || handledFocus.current === focusTarget.requestId) return;
    const canonical = blocks.find((item) => item.id === focusTarget.id);
    if (!canonical || !hasPageBounds(canonical)) return;
    const regions = getPageBlocks([canonical], focusTarget.pageNumber ?? propsRef.current.page);
    const block = regions.find((region) => getPageBlockRegionId(region) === focusTarget.regionId) ?? regions[0] ?? canonical;
    const target = layout[block.pageNumber - 1];
    const scroll = scrollRef.current;
    if (!target || !scroll) return;
    scroll.scrollTop = Math.max(0, PDF_SCROLL_PADDING + target.top + (block.bbox![1] + block.bbox![3]) / 2 * target.height - (scroll.clientHeight || 800) / 2);
    updateViewportRef.current(false);
    if (!readyPages[block.pageNumber]) return;
    const element = [...scroll.querySelectorAll<HTMLElement>(`.pdf-page-stage[data-page-number="${block.pageNumber}"] [data-block-id]`)]
      .find((region) => region.id === `pdf-block-${getPageBlockRegionId(block)}`);
    if (!element) return;
    handledFocus.current = focusTarget.requestId;
    element.scrollIntoView?.({ behavior: "auto", block: "center" });
    updateViewportRef.current(false);
    clearTimeout(focusFlashTimer.current);
    if (!focusTarget.flash) {
      setFocusFlashRegionId(null);
      return;
    }
    const regionId = getPageBlockRegionId(block);
    setFocusFlashRegionId(regionId);
    focusFlashTimer.current = setTimeout(() => {
      setFocusFlashRegionId((current) => current === regionId ? null : current);
      focusFlashTimer.current = undefined;
    }, 1600);
  }, [focusIsLatest, focusTarget, layout, blocks, readyPages]);

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
    {busy ? <div className="pdf-feedback" role="status"><LoaderCircle size={16} className="spin" />正在准备 PDF 长画布…</div> : null}
    {error ? <div role="alert" className="parse-warning">{error}</div> : null}
    <div className="pdf-canvas-scroll" ref={scrollRef} tabIndex={0} role="region" aria-label="PDF 页面滚动区"
      onMouseDown={deckMode ? (event) => {
        if (event.button !== 0) return;
        marqueeDrag.current = { startX: event.clientX, startY: event.clientY };
        setMarquee({ x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY });
      } : undefined}
      onDoubleClick={deckMode ? (event) => {
        if (Date.now() < suppressClickUntil.current) { event.stopPropagation(); event.preventDefault(); }
      } : undefined}
      onClick={deckMode ? (event) => {
        if (Date.now() < suppressClickUntil.current) { event.stopPropagation(); event.preventDefault(); }
      } : undefined}
      onScroll={(event) => {
      updateViewportRef.current(true);
      clearTimeout(scrollTimer.current);
      const container = event.currentTarget;
      scrollTimer.current = setTimeout(() => {
        const currentPage = getPdfViewportPages(layoutRef.current, Math.max(0, container.scrollTop - PDF_SCROLL_PADDING), container.clientHeight || 800).page;
        syncVisibleBlock(currentPage);
      }, 250);
    }}>
      {marquee ? <div className="pdf-marquee" style={{
        left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1),
        width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0),
      }} /> : null}
      <div className="pdf-page-stack">
        {layout.map((item) => <div className="pdf-page-slot" key={`${originalId}:${item.pageNumber}`} data-page-number={item.pageNumber}
          style={{ width: item.width, height: item.height }}>
          {item.pageNumber === pendingPage || (item.pageNumber >= renderRange.start && item.pageNumber <= renderRange.end)
            ? <PdfPageCanvas pdfPage={pages[item.pageNumber - 1]} layout={item} blocks={pageBlocks.get(item.pageNumber) ?? []}
              activeBlockId={activeBlockId} focusFlashRegionId={focusFlashRegionId} onSelect={(block) => {
                const canonical = canonicalBlocks.get(block.id)!;
                onSelect(canonical, ...regionLocation(block, canonical));
              }} onSelectText={(block, text) => {
                const canonical = canonicalBlocks.get(block.id)!;
                onSelectText(canonical, text, ...regionLocation(block, canonical));
              }}
              onAnalyzeParagraph={props.onAnalyzeParagraph ? (block) => {
                const canonical = canonicalBlocks.get(block.id)!;
                props.onAnalyzeParagraph?.(canonical, ...regionLocation(block, canonical));
              } : undefined}
              onAnalyzeChart={props.onAnalyzeChart ? (block) => {
                const canonical = canonicalBlocks.get(block.id)!;
                props.onAnalyzeChart?.(canonical, ...regionLocation(block, canonical));
               } : undefined}
              onAnalyzeEquation={props.onAnalyzeEquation ? (block) => {
                const canonical = canonicalBlocks.get(block.id)!;
                props.onAnalyzeEquation?.(canonical, ...regionLocation(block, canonical));
               } : undefined}
               onAddToConversation={props.onAddToConversation ? (block) => {
                 const canonical = canonicalBlocks.get(block.id)!;
                 props.onAddToConversation?.(canonical, ...regionLocation(block, canonical));
               } : undefined} onReady={onReady} />
            : <div className="pdf-page-placeholder" aria-label={`论文原文第 ${item.pageNumber} 页`} />}
        </div>)}
      </div>
    </div>
  </section>;
}
