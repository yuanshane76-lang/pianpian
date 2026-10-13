import { describe, expect, it } from "vitest";
import { findPageBlockAtPoint, hasPageBounds, getPageBlocks } from "../../src/domain/pdfLayout";
import { getDocumentBlockSignature } from "../../src/domain/documentBlocks";
import type { DocumentBlock } from "../../src/domain/documentBlocks";

const paragraph: DocumentBlock = { id: "paragraph", kind: "paragraph", text: "Body", order: 0, pageNumber: 5, bbox: [0.169, 0.5, 0.825, 0.6] };
describe("PDF interaction coordinates", () => {
  it("projects disjoint columns of the same paragraph without covering the gutter", () => {
    const merged: DocumentBlock = { ...paragraph, bbox: [.1, .8, .45, .9], pageBounds: [
      { pageNumber: 5, bbox: [.1, .8, .45, .9] },
      { pageNumber: 5, bbox: [.55, .1, .9, .4] },
    ] };
    expect(hasPageBounds(merged)).toBe(true);
    const regions = getPageBlocks([merged], 5);
    expect(regions).toHaveLength(2);
    expect(findPageBlockAtPoint(regions, .7, .2)?.id).toBe(merged.id);
    expect(findPageBlockAtPoint(regions, .25, .85)?.id).toBe(merged.id);
    expect(findPageBlockAtPoint(regions, .5, .5)).toBeNull();
    expect(hasPageBounds({ ...merged, pageBounds: [merged.pageBounds![0], merged.pageBounds![0]] })).toBe(false);
  });
  it("projects the continuation onto its own page while keeping the canonical paragraph identity", () => {
    const merged = { ...paragraph, pageBounds: [
      { pageNumber: 5, bbox: paragraph.bbox! },
      { pageNumber: 6, bbox: [0.169, 0.2, 0.825, 0.4] as [number, number, number, number] },
    ] };
    const continued = getPageBlocks([merged], 6);
    expect(continued).toHaveLength(1);
    expect(continued[0]).toMatchObject({ id: merged.id, text: merged.text, pageNumber: 6, bbox: [0.169, 0.2, 0.825, 0.4] });
    expect(findPageBlockAtPoint(continued, .4, .3)?.id).toBe(merged.id);
    expect(getDocumentBlockSignature(merged)).toBe(getDocumentBlockSignature(paragraph));
    expect(getPageBlocks([merged], 7)).toEqual([]);
  });
  it("rejects a claimed continuation with invalid page coordinates", () => {
    expect(hasPageBounds({ ...paragraph, pageBounds: [
      { pageNumber: 5, bbox: paragraph.bbox! },
      { pageNumber: 6, bbox: [0.1, 0.2, 2, 0.4] },
    ] })).toBe(false);
  });
  it("uses top-left page fractions for pointer hit testing, including small nested formulas", () => {
    const equation: DocumentBlock = { ...paragraph, id: "formula", kind: "equation", bbox: [0.4, 0.52, 0.5, 0.55] };
    expect(findPageBlockAtPoint([paragraph, equation], 0.45, 0.54)).toBe(equation);
    expect(findPageBlockAtPoint([paragraph, equation], 0.2, 0.57)).toBe(paragraph);
    expect(findPageBlockAtPoint([paragraph], 0.02, 0.57)).toBeNull();
  });
  it("rejects missing, reversed, nonfinite and out-of-page boxes", () => {
    for (const bbox of [undefined, [0, 0, 2, 0.4], [0.4, 0.3, 0.1, 0.8], [0, NaN, 1, 1]]) {
      expect(hasPageBounds({ ...paragraph, bbox: bbox as DocumentBlock["bbox"] })).toBe(false);
    }
  });
});
