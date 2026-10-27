import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentBlock } from "../../domain/documentBlocks";
import type { CSSProperties } from "react";
import type { PaperRecord } from "../../domain/library";

interface Props {
  paper: PaperRecord;
  selectedBlockId: string | null;
  navigationTarget?: { page: number; blockId?: string; requestId: number };
  readingPage: number;
  onSelect: (block: DocumentBlock) => void;
  onAnalyzeParagraph: (block: DocumentBlock) => void;
  onPosition: (page: number) => void;
  loadImage: (block: DocumentBlock) => Promise<string>;
  /** 框选多段后调用：第一块为锚点，文本为选中块按阅读顺序合并。 */
  onSelectText?: (block: DocumentBlock, text: string) => void;
}

type Slide = { page: number; blocks: DocumentBlock[] };

function groupSlides(blocks: DocumentBlock[]): Slide[] {
  const slides: Slide[] = [];
  for (const block of blocks) {
    const page = Number.isInteger(block.pageNumber) ? block.pageNumber : 1;
    const last = slides[slides.length - 1];
    if (last && last.page === page) last.blocks.push(block);
    else slides.push({ page, blocks: [block] });
  }
  return slides;
}

function boxStyle(block: DocumentBlock): CSSProperties | null {
  const bbox = block.bbox;
  if (!bbox || bbox.length < 4) return null;
  const [x0, y0, x1, y1] = bbox;
  return {
    left: `${Math.max(0, x0 * 100)}%`,
    top: `${Math.max(0, y0 * 100)}%`,
    width: `${Math.max(1, (x1 - x0) * 100)}%`,
    minHeight: `${Math.max(0, (y1 - y0) * 100)}%`,
  };
}

function SlideContent({ block, images }: { block: DocumentBlock; images: Record<string, string> }) {
  if (block.kind === "image") {
    const src = images[block.id];
    return <figure className="deck-figure">
      {src ? <img src={src} alt={block.caption || "幻灯片图片"} /> : <div className="deck-figure-loading">…</div>}
    </figure>;
  }
  if (block.kind === "heading") return <h3 className="deck-heading">{block.text}</h3>;
  if (block.kind === "equation") return <pre className="deck-equation">{block.text}</pre>;
  if (block.kind === "table") return <div className="deck-table">{block.text}</div>;
  return <p className="deck-paragraph">{block.text}</p>;
}

/**
 * 演示文稿阅读（pptx/ppt）：MinerU 块按幻灯片页分组，复用块坐标把内容绝对定位到
 * 16:9 画布上还原原始版面（文字与图片在幻灯片上的真实位置），不重排不改写；
 * 无坐标的块以流式附录补在画布下方。单击选中，双击发起段落理解。
 */
export function DeckView({ paper, selectedBlockId, navigationTarget, readingPage, onSelect, onAnalyzeParagraph, onPosition, loadImage, onSelectText }: Props) {
  const slides = useMemo(() => groupSlides(paper.blockData ?? []), [paper.blockData]);
  const [images, setImages] = useState<Record<string, string>>({});
  const cardRefs = useRef<Record<number, HTMLElement | null>>({});
  // 框选多段：拖出的矩形与块 bbox 相交即选中；选中集合跨页保留，ctrl+点击可增减。
  const [multiSelected, setMultiSelected] = useState<Set<string>>(() => new Set());
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const marqueeState = useRef<{ canvas: HTMLElement; rect: DOMRect; moved: boolean } | null>(null);
  const suppressClickUntil = useRef(0);
  const imageBlocks = useMemo(() => slides.flatMap((slide) => slide.blocks).filter((block) => block.kind === "image"), [slides]);

  useEffect(() => {
    let cancelled = false;
    for (const block of imageBlocks) {
      if (images[block.id]) continue;
      loadImage(block).then((dataUrl) => {
        if (cancelled) return;
        setImages((current) => ({ ...current, [block.id]: dataUrl }));
      }).catch(() => undefined);
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageBlocks.map((block) => block.id).join(",")]);

  useEffect(() => {
    const slide = slides.find((item) => item.page === readingPage) ?? slides[0];
    if (!slide) return;
    cardRefs.current[slide.page]?.scrollIntoView?.({ block: "start" });
  }, [readingPage, slides]);

  useEffect(() => {
    if (!navigationTarget) return;
    const block = slides.flatMap((item) => item.blocks).find((item) => item.id === navigationTarget.blockId);
    if (!block) return;
    cardRefs.current[block.pageNumber]?.scrollIntoView?.({ block: "start" });
    onPosition(block.pageNumber);
  }, [navigationTarget?.requestId]);

  function blockIntersects(block: DocumentBlock, rect: DOMRect, canvasRect: DOMRect): boolean {
    const bbox = block.bbox;
    if (!bbox || bbox.length < 4) return false;
    const [x0, y0, x1, y1] = bbox;
    const bx0 = canvasRect.left + x0 * canvasRect.width;
    const by0 = canvasRect.top + y0 * canvasRect.height;
    const bx1 = bx0 + Math.max(0.01, x1 - x0) * canvasRect.width;
    const by1 = Math.max(by0 + 8, by0 + Math.max(0.01, y1 - y0) * canvasRect.height);
    const mx0 = Math.min(rect.left, rect.right);
    const mx1 = Math.max(rect.left, rect.right);
    const my0 = Math.min(rect.top, rect.bottom);
    const my1 = Math.max(rect.top, rect.bottom);
    return bx0 < mx1 && bx1 > mx0 && by0 < my1 && by1 > my0;
  }

  function onCanvasMouseDown(event: React.MouseEvent<HTMLDivElement>, slide: Slide) {
    if (event.button !== 0 || (event.target as Element).closest(".deck-block")) return;
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const point = { x: event.clientX, y: event.clientY };
    marqueeState.current = { canvas, rect, moved: false };
    setMarquee({ x0: point.x - rect.left, y0: point.y - rect.top, x1: point.x - rect.left, y1: point.y - rect.top });

    const move = (moveEvent: MouseEvent) => {
      const state = marqueeState.current;
      if (!state) return;
      if (Math.abs(moveEvent.clientX - point.x) + Math.abs(moveEvent.clientY - point.y) > 3) state.moved = true;
      setMarquee({ x0: point.x - rect.left, y0: point.y - rect.top, x1: moveEvent.clientX - rect.left, y1: moveEvent.clientY - rect.top });
    };
    const up = (upEvent: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      const moved = marqueeState.current?.moved ?? false;
      marqueeState.current = null;
      setMarquee(null);
      const selectionRect = new DOMRect(
        Math.min(point.x, upEvent.clientX), Math.min(point.y, upEvent.clientY),
        Math.abs(upEvent.clientX - point.x), Math.abs(upEvent.clientY - point.y),
      );
      if (selectionRect.width + selectionRect.height < 6 || !moved) return; // 视为普通点击
      suppressClickUntil.current = Date.now() + 250;
      const picked = slide.blocks.filter((block) => blockIntersects(block, selectionRect, rect));
      setMultiSelected(new Set(picked.map((block) => block.id)));
      if (picked.length && onSelectText) {
        const ordered = [...picked].sort((left, right) => left.order - right.order);
        const joined = ordered.map((block) => block.text.trim()).filter(Boolean).join("\n\n");
        onSelectText(ordered[0], joined);
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  function toggleMulti(block: DocumentBlock, event: React.MouseEvent) {
    event.stopPropagation();
    setMultiSelected((current) => {
      const next = new Set(current);
      if (next.has(block.id)) next.delete(block.id); else next.add(block.id);
      return next;
    });
  }

  const isSelected = (block: DocumentBlock) => block.id === selectedBlockId || multiSelected.has(block.id);

  return <div className="deck-view" role="list" aria-label="演示文稿幻灯片">
    {slides.map((slide) => {
      const positioned = slide.blocks.filter((block) => boxStyle(block));
      const loose = slide.blocks.filter((block) => !boxStyle(block));
      return <section
        key={slide.page}
        role="listitem"
        aria-label={`第 ${slide.page} 页`}
        className="deck-slide"
        ref={(element) => { cardRefs.current[slide.page] = element; }}
        onClick={() => onPosition(slide.page)}
      >
        <div className="deck-canvas" onMouseDown={(event) => onCanvasMouseDown(event, slide)}>
          {marquee ? <div
            className="deck-marquee"
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
            }}
          /> : null}
          {positioned.map((block) => <div
            key={block.id}
            className={`deck-abs deck-block deck-${block.kind} ${isSelected(block) ? "is-selected" : ""}`}
            style={boxStyle(block) ?? undefined}
            title={block.caption}
            onClick={(event) => {
              if (Date.now() < suppressClickUntil.current) return;
              if (event.ctrlKey || event.metaKey) { toggleMulti(block, event); return; }
              setMultiSelected(new Set());
              onSelect(block);
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              onAnalyzeParagraph(block);
            }}
          >
            <SlideContent block={block} images={images} />
          </div>)}
          {loose.length ? <div className="deck-loose">
            {loose.map((block) => <div
              key={block.id}
              className={`deck-block deck-${block.kind} ${isSelected(block) ? "is-selected" : ""}`}
              onClick={(event) => {
                if (Date.now() < suppressClickUntil.current) return;
                if (event.ctrlKey || event.metaKey) { toggleMulti(block, event); return; }
                setMultiSelected(new Set());
                onSelect(block);
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                onAnalyzeParagraph(block);
              }}
            >
              <SlideContent block={block} images={images} />
            </div>)}
          </div> : null}
        </div>
        <header className="deck-slide-head"><span>第 {slide.page} 页</span><span>/ {slides.length}</span></header>
      </section>;
    })}
    {!slides.length ? <p className="deck-empty">这篇演示文稿还没有可显示的内容。</p> : null}
  </div>;
}
