import { MessageSquarePlus, MousePointer2 } from "lucide-react";
import { Fragment } from "react";
import type { DocumentBlock } from "../../domain/documentBlocks";
import { getPageBlockRegionId, hasPageBounds } from "../../domain/pdfLayout";

interface BlockListProps {
  blocks: DocumentBlock[];
  activeBlockId: string | null;
  hoveredBlockId?: string | null;
  focusFlashRegionId?: string | null;
  onSelect: (block: DocumentBlock) => void;
  onAnalyzeParagraph?: (block: DocumentBlock) => void;
  onAnalyzeChart?: (block: DocumentBlock) => void;
  onAnalyzeEquation?: (block: DocumentBlock) => void;
  onAddToConversation?: (block: DocumentBlock) => void;
}

const labels = { heading: "标题", paragraph: "段落", equation: "公式", image: "图表", table: "表格" };

export function BlockList({ blocks, activeBlockId, hoveredBlockId, focusFlashRegionId, onSelect, onAnalyzeParagraph, onAnalyzeChart, onAnalyzeEquation, onAddToConversation }: BlockListProps) {
  return <div className="pdf-block-layer">
    {blocks.filter(hasPageBounds).map((block) => {
      const [left, top, right, bottom] = block.bbox!;
      const paragraph = block.kind === "paragraph" && Boolean(onAnalyzeParagraph);
      const chart = (block.kind === "image" || block.kind === "table") && Boolean(onAnalyzeChart);
      const equation = block.kind === "equation" && Boolean(onAnalyzeEquation);
      const canAddToConversation = block.kind === "paragraph" && Boolean(onAddToConversation);
      const regionId = getPageBlockRegionId(block);
      const hintId = `pdf-paragraph-hint-${regionId}`;
      const canAnalyze = paragraph || chart || equation;
      const showActions = activeBlockId === block.id || hoveredBlockId === block.id;
      return <Fragment key={regionId}>
        <button
            type="button"
            id={`pdf-block-${regionId}`}
            data-block-id={block.id}
            className={`pdf-block-hit-area pdf-block-${block.kind} ${activeBlockId === block.id ? "is-active" : ""} ${hoveredBlockId === block.id ? "is-hovered" : ""} ${focusFlashRegionId === regionId ? "is-focus-flash" : ""}`}
            style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${(right - left) * 100}%`, height: `${(bottom - top) * 100}%` }}
            onClick={(event) => { if (event.detail < 2) onSelect(block); }}
            onDoubleClick={(event) => {
              if (!canAnalyze) return;
              event.preventDefault();
              event.stopPropagation();
              if (paragraph) onAnalyzeParagraph?.(block);
              else if (chart) onAnalyzeChart?.(block);
              else onAnalyzeEquation?.(block);
            }}
            aria-pressed={activeBlockId === block.id}
            aria-describedby={canAnalyze ? hintId : undefined}
            aria-label={`第 ${block.pageNumber} 页${labels[block.kind]}${block.caption ? `：${block.caption}` : ""}`}
          >
            {!canAnalyze ? <span className="pdf-block-hover-label">{labels[block.kind]}</span> : null}
          </button>
        {canAnalyze ? <div className="pdf-block-region"
          style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${(right - left) * 100}%`, height: `${(bottom - top) * 100}%` }}>
          <div className={`pdf-block-actions ${showActions ? "is-visible" : ""} ${top < .06 ? "is-below" : ""}`}>
            <span id={hintId} role="tooltip" className="pdf-block-hover-label pdf-paragraph-hint">
              <MousePointer2 size={13} aria-hidden="true" />{chart ? "双击解读图表" : equation ? "双击解读公式" : "双击分析整段"}
            </span>
            {canAddToConversation ? <button
              type="button"
              data-block-action-for={block.id}
              className="pdf-block-citation-action"
              aria-label={`将第 ${block.pageNumber} 页段落加入对话`}
              onClick={(event) => { event.preventDefault(); event.stopPropagation(); onAddToConversation?.(block); }}
            >
              <MessageSquarePlus size={13} aria-hidden="true" />加入对话
            </button> : null}
          </div>
        </div> : null}
      </Fragment>;
    })}
  </div>;
}
