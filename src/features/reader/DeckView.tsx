import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentBlock } from "../../domain/documentBlocks";
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

function SlideBlock({ block, images, selected, onSelect, onAnalyzeParagraph }: {
  block: DocumentBlock;
  images: Record<string, string>;
  selected: boolean;
  onSelect: (block: DocumentBlock) => void;
  onAnalyzeParagraph: (block: DocumentBlock) => void;
}) {
  if (block.kind === "image") {
    const src = images[block.id];
    return <figure className={`deck-block deck-figure ${selected ? "is-selected" : ""}`} onClick={() => onSelect(block)}>
      {src ? <img src={src} alt={block.caption || "幻灯片图片"} /> : <div className="deck-figure-loading">图片加载中…</div>}
      {block.caption ? <figcaption>{block.caption}</figcaption> : null}
    </figure>;
  }
  if (block.kind === "equation") {
    return <pre className={`deck-block deck-equation ${selected ? "is-selected" : ""}`}
      onClick={() => onSelect(block)} onDoubleClick={() => onAnalyzeParagraph(block)}>{block.text}</pre>;
  }
  if (block.kind === "table") {
    return <div className={`deck-block deck-table ${selected ? "is-selected" : ""}`}
      onClick={() => onSelect(block)} onDoubleClick={() => onAnalyzeParagraph(block)}>{block.text}</div>;
  }
  if (block.kind === "heading") {
    return <h3 className={`deck-block deck-heading ${selected ? "is-selected" : ""}`}
      onClick={() => onSelect(block)} onDoubleClick={() => onAnalyzeParagraph(block)}>{block.text}</h3>;
  }
  return <p className={`deck-block deck-paragraph ${selected ? "is-selected" : ""}`}
    onClick={() => onSelect(block)} onDoubleClick={() => onAnalyzeParagraph(block)}>{block.text}</p>;
}

/** 演示文稿阅读：MinerU 转换后的块按幻灯片分组为卡片流；单击选中、双击发起段落理解。 */
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
    {slides.map((slide) => <section
      key={slide.page}
      role="listitem"
      aria-label={`第 ${slide.page} 页`}
      className="deck-slide"
      ref={(element) => { cardRefs.current[slide.page] = element; }}
      onClick={() => onPosition(slide.page)}
    >
      <header className="deck-slide-head"><span>第 {slide.page} 页</span><span>/ {slides.length}</span></header>
      <div className="deck-slide-body">
        {slide.blocks.map((block) => <SlideBlock key={block.id} block={block} images={images}
          selected={block.id === selectedBlockId} onSelect={onSelect} onAnalyzeParagraph={onAnalyzeParagraph} />)}
      </div>
    </section>)}
    {!slides.length ? <p className="deck-empty">这篇演示文稿还没有可显示的内容。</p> : null}
  </div>;
}
