import type { DocumentBlock } from "./documentBlocks";

// Electron converts MinerU's 0–1000 coordinates into top-left page fractions.
export function hasPageBounds(block: DocumentBlock): boolean {
  const box = block.bbox;
  return Boolean(box && box.length === 4
    && box.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    && box[2] > box[0] && box[3] > box[1]);
}

export function findPageBlockAtPoint(blocks: DocumentBlock[], x: number, y: number): DocumentBlock | null {
  return blocks.filter(hasPageBounds).filter((block) => {
    const [left, top, right, bottom] = block.bbox!;
    return x >= left && x <= right && y >= top && y <= bottom;
  }).sort((left, right) => {
    const area = (block: DocumentBlock) => (block.bbox![2] - block.bbox![0]) * (block.bbox![3] - block.bbox![1]);
    return area(left) - area(right);
  })[0] ?? null;
}
