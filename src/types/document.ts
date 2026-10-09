import type { DocumentBlock } from "../domain/documentBlocks";

export interface PaperDocument {
  paperId: string;
  blocks: DocumentBlock[];
  extractedAt: string;
}
