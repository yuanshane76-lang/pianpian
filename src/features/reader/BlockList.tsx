import { MousePointer2 } from "lucide-react";
import type { DocumentBlock } from "../../domain/documentBlocks";
import { getPageBlockRegionId, hasPageBounds } from "../../domain/pdfLayout";

interface BlockListProps {
  blocks: DocumentBlock[];
  activeBlockId: string | null;
  hoveredBlockId?: string | null;
  onSelect: (block: DocumentBlock) => void;
  onAnalyzeParagraph?: (block: DocumentBlock) => void;
  onAnalyzeChart?: (block: DocumentBlock) => void;
}

const labels = { heading: "标题", paragraph: "段落", equation: "公式", image: "图表", table: "表格" };

export function BlockList({ blocks, activeBlockId, hoveredBlockId, onSelect, onAnalyzeParagraph, onAnalyzeChart }: BlockListProps) {
  return <div className="pdf-block-layer">
    {blocks.filter(hasPageBounds).map((block) => {
      const [left, top, right, bottom] = block.bbox!;
      const paragraph = block.kind === "paragraph" && Boolean(onAnalyzeParagraph);
      const chart = (block.kind === "image" || block.kind === "table") && Boolean(onAnalyzeChart);
      const regionId = getPageBlockRegionId(block);
      const hintId = `pdf-paragraph-hint-${regionId}`;
      return <button
          type="button"
          key={regionId}
          id={`pdf-block-${regionId}`}
          data-block-id={block.id}
          className={`pdf-block-hit-area pdf-block-${block.kind} ${activeBlockId === block.id ? "is-active" : ""} ${hoveredBlockId === block.id ? "is-hovered" : ""}`}
          style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${(right - left) * 100}%`, height: `${(bottom - top) * 100}%` }}
          onClick={(event) => { if (event.detail < 2) onSelect(block); }}
          onDoubleClick={(event) => {
            if (!paragraph && !chart) return;
            event.preventDefault();
            event.stopPropagation();
            if (paragraph) onAnalyzeParagraph?.(block);
            else onAnalyzeChart?.(block);
          }}
          aria-pressed={activeBlockId === block.id}
          aria-describedby={paragraph || chart ? hintId : undefined}
          aria-label={`第 ${block.pageNumber} 页${labels[block.kind]}${block.caption ? `：${block.caption}` : ""}`}
        >
          <span id={paragraph || chart ? hintId : undefined} role={paragraph || chart ? "tooltip" : undefined}
            className={`pdf-block-hover-label ${paragraph || chart ? "pdf-paragraph-hint" : ""} ${top < .06 ? "is-below" : ""}`}>
            {paragraph || chart ? <><MousePointer2 size={13} aria-hidden="true" />{chart ? "双击解读图表" : "双击分析整段"}</> : labels[block.kind]}
          </span>
        </button>;
    })}
  </div>;
}
