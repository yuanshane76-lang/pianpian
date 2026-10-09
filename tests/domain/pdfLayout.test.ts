import { describe, expect, it } from "vitest";
import { findPageBlockAtPoint, hasPageBounds } from "../../src/domain/pdfLayout";
import type { DocumentBlock } from "../../src/domain/documentBlocks";

const paragraph: DocumentBlock = { id: "paragraph", kind: "paragraph", text: "Body", order: 0, pageNumber: 5, bbox: [0.169, 0.5, 0.825, 0.6] };
describe("PDF interaction coordinates", () => {
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
