import type { DocumentBlock } from "../domain/documentBlocks";
import type { ParagraphReadingMode } from "../domain/analysis";
import type { PaperRecord } from "../domain/library";

export interface AiRequest {
  operation: "translate" | "qa" | "explain" | "insight" | "guide" | "chart" | "equation" | "vocabulary" | "outline";
  paper: PaperRecord;
  block?: DocumentBlock;
  question?: string;
  imageDataUrl?: string;
  readingMode?: ParagraphReadingMode;
}
