import type { DocumentBlock } from "../domain/documentBlocks";
import type { ParagraphReadingMode } from "../domain/analysis";
import type { PaperRecord } from "../domain/library";
import type { WikiPartInfo } from "../domain/paperWiki";

export interface WikiPartContext {
  id: string;
  title: string;
}

export interface AiRequest {
  operation: "translate" | "qa" | "explain" | "insight" | "guide" | "chart" | "equation" | "vocabulary" | "wiki-thread" | "wiki-part";
  paper: PaperRecord;
  block?: DocumentBlock;
  question?: string;
  imageDataUrl?: string;
  readingMode?: ParagraphReadingMode;
  /** wiki-thread：本地大块划分概览（真值边界），模型在它上面做语义命名与论证主线。 */
  wikiParts?: WikiPartInfo[];
  /** wiki-part：目标部分描述；paper.blockData 只包含该部分的阅读块。 */
  wikiPart?: WikiPartContext;
}
