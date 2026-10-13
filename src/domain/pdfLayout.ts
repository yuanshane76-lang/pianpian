import type { DocumentBlock } from "./documentBlocks";

// Electron converts MinerU's 0–1000 coordinates into top-left page fractions.
function isUnitBox(box: DocumentBlock["bbox"]): boolean {
  return Boolean(Array.isArray(box) && box.length === 4
    && box.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    && box[2] > box[0] && box[3] > box[1]);
}

export function hasPageBounds(block: DocumentBlock): boolean {
  if (!isUnitBox(block.bbox)) return false;
  if (block.pageBounds === undefined) return true;
  return Array.isArray(block.pageBounds) && block.pageBounds.length > 0
    && block.pageBounds.every((region) => region && Number.isInteger(region.pageNumber)
      && region.pageNumber > 0 && isUnitBox(region.bbox))
    && new Set(block.pageBounds.map((region) => JSON.stringify([region.pageNumber, region.bbox]))).size === block.pageBounds.length
    && block.pageBounds.some((region) => region.pageNumber === block.pageNumber
      && region.bbox.every((value, index) => value === block.bbox![index]));
}

/** Geometry projections are for drawing/hit testing only, never cache identity. */
export function getPageBlocks(blocks: DocumentBlock[], pageNumber: number): DocumentBlock[] {
  return blocks.filter(hasPageBounds).flatMap((block) => {
    const bounds = block.pageBounds ?? [{ pageNumber: block.pageNumber, bbox: block.bbox! }];
    return bounds.filter((region) => region.pageNumber === pageNumber).map((region) =>
      block.pageNumber === pageNumber && region.bbox.every((value, index) => value === block.bbox![index])
        ? block : { ...block, pageNumber, bbox: region.bbox });
  });
}

/** Only identifies a drawn region; the canonical block id remains the analysis/cache identity. */
export function getPageBlockRegionId(block: DocumentBlock): string {
  const index = block.pageBounds?.findIndex((region) => region.pageNumber === block.pageNumber
    && region.bbox.every((value, coordinate) => value === block.bbox![coordinate])) ?? 0;
  if (index <= 0) return block.id;
  const samePage = block.pageBounds!.slice(0, index).some((region) => region.pageNumber === block.pageNumber);
  return `${block.id}-page-${block.pageNumber}${samePage ? `-region-${index}` : ""}`;
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
