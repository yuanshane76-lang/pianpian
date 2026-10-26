import { describe, expect, it } from "vitest";
import { looksLikeSlideDeck } from "../../src/services/library";

describe("slide deck detection from PDF page sizes", () => {
  it("treats uniformly landscape wide pages as a deck", () => {
    const slides = Array.from({ length: 8 }, () => ({ width: 960, height: 540 }));
    expect(looksLikeSlideDeck(slides)).toBe(true);
    expect(looksLikeSlideDeck([{ width: 1280, height: 720 }])).toBe(true); // 单页横版也算
  });

  it("keeps portrait papers and mixed landscape-figure papers as pdf", () => {
    const paper = Array.from({ length: 10 }, () => ({ width: 612, height: 792 }));
    expect(looksLikeSlideDeck(paper)).toBe(false);
    // 论文中偶尔一张横置图版页：占比不足
    const mixed = [...Array.from({ length: 9 }, () => ({ width: 612, height: 792 })), { width: 792, height: 612 }];
    expect(looksLikeSlideDeck(mixed)).toBe(false);
    expect(looksLikeSlideDeck([])).toBe(false);
  });
});
