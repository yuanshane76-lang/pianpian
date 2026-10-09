export const PDF_PAGE_GAP = 24;
export const PDF_SCROLL_PADDING = 20;
export interface PdfPageSize { width: number; height: number }
export interface PdfPageLayout extends PdfPageSize { pageNumber: number; scale: number; top: number }

export function buildPdfPageLayout(sizes: PdfPageSize[], zoom: number, availableWidth: number, fitWidth: boolean): PdfPageLayout[] {
  let top = 0;
  return sizes.map((size, index) => {
    const scale = fitWidth && availableWidth > PDF_SCROLL_PADDING * 2
      ? Math.min(2.6, Math.max(.4, (availableWidth - PDF_SCROLL_PADDING * 2) / size.width)) : zoom;
    const page = { pageNumber: index + 1, scale, width: size.width * scale, height: size.height * scale, top };
    top += page.height + PDF_PAGE_GAP;
    return page;
  });
}

export function getPdfViewportPages(layout: PdfPageLayout[], scrollTop: number, height: number) {
  if (!layout.length) return { page: 1, start: 1, end: 1 };
  const bottom = scrollTop + Math.max(1, height);
  let first = layout.findIndex((item) => item.top + item.height > scrollTop);
  if (first < 0) first = layout.length - 1;
  let last = first, predominant = first, largestOverlap = -1;
  for (let index = first; index < layout.length && layout[index].top < bottom; index++) {
    last = index;
    const overlap = Math.min(bottom, layout[index].top + layout[index].height) - Math.max(scrollTop, layout[index].top);
    if (overlap > largestOverlap) { largestOverlap = overlap; predominant = index; }
  }
  return { page: predominant + 1, start: Math.max(1, first), end: Math.min(layout.length, last + 2) };
}
