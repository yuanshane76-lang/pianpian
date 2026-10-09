import { describe, expect, it } from "vitest";
import { buildPdfPageLayout, getPdfViewportPages } from "../../src/domain/pdfScroll";

describe("continuous PDF scroll geometry", () => {
  it("reserves actual scaled dimensions with fixed gaps including mixed-size pages", () => {
    const layout = buildPdfPageLayout([{ width: 600, height: 800 }, { width: 800, height: 600 }], 1, 0, false);
    expect(layout).toEqual([
      { pageNumber: 1, width: 600, height: 800, scale: 1, top: 0 },
      { pageNumber: 2, width: 800, height: 600, scale: 1, top: 824 },
    ]);
    const fit = buildPdfPageLayout([{ width: 600, height: 800 }, { width: 800, height: 600 }], 1, 940, true);
    expect(fit.map((page) => page.width)).toEqual([900, 900]);
  });
  it("identifies the predominant visible page and nearby rasterization range across a seam", () => {
    const layout = buildPdfPageLayout(Array.from({ length: 20 }, () => ({ width: 600, height: 800 })), 1, 0, false);
    expect(getPdfViewportPages(layout, 740, 500)).toMatchObject({ page: 2, start: 1, end: 3 });
    expect(getPdfViewportPages(layout, 9000, 500).start).toBeGreaterThan(8);
    expect(getPdfViewportPages(layout, 0, 500).page).toBe(1);
  });
});
