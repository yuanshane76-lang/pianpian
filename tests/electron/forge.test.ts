import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../../forge.config.cjs") as {
  packagerConfig: { ignore: (filePath: string) => boolean; prune: boolean };
};
const ignored = (relative: string) =>
  config.packagerConfig.ignore(`/${relative.replaceAll("\\", "/")}`);

describe("portable package contents", () => {
  it("includes only runtime entry points and built assets", () => {
    expect(ignored("package.json")).toBe(false);
    expect(ignored("electron/main.cjs")).toBe(false);
    expect(ignored("electron/preload.cjs")).toBe(false);
    expect(ignored("electron/resource.cjs")).toBe(false);
    expect(ignored("electron/secret-store.cjs")).toBe(false);
    expect(ignored("electron/settings.cjs")).toBe(false);
    expect(ignored("electron/ipc-security.cjs")).toBe(false);
    expect(ignored("electron/ai.cjs")).toBe(false);
    expect(ignored("electron/ai-stream-ipc.cjs")).toBe(false);
    expect(ignored("electron/document-store.cjs")).toBe(false);
    expect(ignored("electron/document-tasks.cjs")).toBe(false);
    expect(ignored("electron/mineru.cjs")).toBe(false);
    expect(ignored("dist/index.html")).toBe(false);
    expect(ignored("dist/pdf.worker.min.mjs")).toBe(false);
    expect(ignored("dist/assets/index-123.js")).toBe(false);
    expect(ignored("dist/assets/pdf.worker-123.mjs")).toBe(false);
    expect(ignored("dist/assets/KaTeX_Main-Regular-123.woff2")).toBe(false);
    expect(ignored("dist/assets/KaTeX_Math-Italic-123.woff")).toBe(false);
    expect(ignored("dist/assets/KaTeX_Size1-Regular-123.ttf")).toBe(false);
    expect(ignored("dist/standard_fonts/FoxitSans.pfb")).toBe(false);
  });

  it("excludes secrets, documents, tests, caches, and unexpected build files", () => {
    expect(config.packagerConfig.prune).toBe(false);
    for (const file of [
      ".env",
      ".env.production",
      "data/library.sqlite",
      "private.pdf",
      "docs/产品设想.md",
      "tests/electron/forge.test.ts",
      "node_modules/.vite/cache.bin",
      "dist/private.pdf",
      "dist/assets/secret.env",
      "dist/standard_fonts/private.pdf",
    ]) {
      expect(ignored(file), file).toBe(true);
    }
  });
});
