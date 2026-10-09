import { describe, expect, it } from "vitest";
import { getStandardFontDataUrl } from "../../src/services/pdfAssets";

describe("PDF packaged assets", () => {
  it("resolves fonts in a Vite dev server", () => {
    expect(getStandardFontDataUrl("http://127.0.0.1:4173/")).toBe(
      "http://127.0.0.1:4173/standard_fonts/",
    );
  });

  it("resolves fonts under the packaged app origin", () => {
    expect(getStandardFontDataUrl("zhiyan://app/index.html")).toBe(
      "zhiyan://app/standard_fonts/",
    );
  });
});
