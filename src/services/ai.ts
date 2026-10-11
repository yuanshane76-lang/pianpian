import type { DocumentBlock } from "../domain/documentBlocks";
import type { PaperRecord } from "../domain/library";

export interface AiRequest {
  operation: "translate" | "qa" | "explain" | "insight" | "guide" | "chart" | "vocabulary";
  paper: PaperRecord;
  block?: DocumentBlock;
  question?: string;
  imageDataUrl?: string;
}
