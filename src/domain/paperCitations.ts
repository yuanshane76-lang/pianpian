import type { PaperRecord } from "./library";

export interface PaperCitation {
  blockId: string;
}

/** A reference may navigate only to an existing block of the current paper. */
export function currentPaperCitations(paper: PaperRecord, candidates: unknown): PaperCitation[] {
  if (!Array.isArray(candidates)) return [];
  const blocks = new Map((paper.blockData ?? []).map((block) => [block.id, block]));
  const result = new Map<string, PaperCitation>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const source = candidate as Record<string, unknown>;
    if (source.paperId !== paper.id || typeof source.blockId !== "string") continue;
    const block = blocks.get(source.blockId);
    if (!block) continue;
    if (!result.has(block.id)) result.set(block.id, { blockId: block.id });
  }
  return [...result.values()];
}
