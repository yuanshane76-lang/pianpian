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
export function DeckView({ paper, selectedBlockId, navigationTarget, readingPage, onSelect, onAnalyzeParagraph, onPosition, loadImage }: Props) {
  const slides = useMemo(() => groupSlides(paper.blockData ?? []), [paper.blockData]);
  const [images, setImages] = useState<Record<string, string>>({});
  const cardRefs = useRef<Record<number, HTMLElement | null>>({});
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
        <div className="deck-canvas">
          {positioned.map((block) => <div
            key={block.id}
            className={`deck-abs deck-block deck-${block.kind} ${block.id === selectedBlockId ? "is-selected" : ""}`}
            style={boxStyle(block) ?? undefined}
            title={block.caption}
            onClick={() => onSelect(block)}
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
              className={`deck-block deck-${block.kind} ${block.id === selectedBlockId ? "is-selected" : ""}`}
              onClick={() => onSelect(block)}
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
