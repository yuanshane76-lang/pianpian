import type { DocumentBlock } from "../../domain/documentBlocks";
import { hasPageBounds } from "../../domain/pdfLayout";

interface BlockListProps {
  blocks: DocumentBlock[];
  activeBlockId: string | null;
  hoveredBlockId?: string | null;
  onSelect: (block: DocumentBlock) => void;
}

const labels = { heading: "标题", paragraph: "段落", equation: "公式", image: "图表", table: "表格" };

export function BlockList({ blocks, activeBlockId, hoveredBlockId, onSelect }: BlockListProps) {
  return <div className="pdf-block-layer">
    {blocks.filter(hasPageBounds).map((block) => {
      const [left, top, right, bottom] = block.bbox!;
      return <button
          type="button"
          key={block.id}
          id={`pdf-block-${block.id}`}
          className={`pdf-block-hit-area pdf-block-${block.kind} ${activeBlockId === block.id ? "is-active" : ""} ${hoveredBlockId === block.id ? "is-hovered" : ""}`}
          style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${(right - left) * 100}%`, height: `${(bottom - top) * 100}%` }}
          onClick={() => onSelect(block)}
          aria-pressed={activeBlockId === block.id}
          aria-label={`第 ${block.pageNumber} 页${labels[block.kind]}${block.caption ? `：${block.caption}` : ""}`}
        >
          <span className="pdf-block-hover-label">{labels[block.kind]}</span>
        </button>;
    })}
  </div>;
}
