import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
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
    expect(ignored("brand.json")).toBe(false);
    expect(ignored("electron/brand.cjs")).toBe(false);
    expect(ignored("assets/brand/pianpian.ico")).toBe(false);
    expect(ignored("dist/brand/pianpian-avatar.webp")).toBe(false);
    expect(ignored("dist/brand/pianpian-reading.webp")).toBe(false);
    expect(ignored("dist/brand/private.svg")).toBe(true);
    expect(ignored("output/imagegen/pianpian-character-sheet-v1.png")).toBe(true);
    expect(ignored("tmp/imagegen/pianpian-character-v1.txt")).toBe(true);
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
    expect(ignored("electron/deepseek-web.cjs")).toBe(false);
    expect(ignored("electron/semantic-scholar.cjs")).toBe(false);
    expect(ignored("electron/external-links.cjs")).toBe(false);
    expect(ignored("electron/pi-agent.cjs")).toBe(false);
    expect(ignored("electron/research-agent-runtime.cjs")).toBe(false);
    expect(ignored("node_modules/@earendil-works/pi-coding-agent/dist/index.js")).toBe(false);
    expect(ignored("node_modules/vitest/vitest.mjs")).toBe(true);
    expect(ignored("dist/index.html")).toBe(false);
    expect(ignored("dist/pdf.worker.min.mjs")).toBe(false);
    expect(ignored("dist/assets/index-123.js")).toBe(false);
    expect(ignored("dist/assets/pdf.worker-123.mjs")).toBe(false);
    expect(ignored("dist/assets/KaTeX_Main-Regular-123.woff2")).toBe(false);
    expect(ignored("dist/assets/KaTeX_Math-Italic-123.woff")).toBe(false);
    expect(ignored("dist/assets/KaTeX_Size1-Regular-123.ttf")).toBe(false);
    expect(ignored("dist/standard_fonts/FoxitSans.pfb")).toBe(false);
  });

  it("ships both sides of the Pi worker boundary", () => {
    expect(ignored("electron/pi-worker-session.cjs")).toBe(false);
    expect(ignored("electron/pi-agent-worker.cjs")).toBe(false);
  });

  it("includes every local module required by the shipped Electron modules", () => {
    for (const name of readdirSync(path.resolve("electron"))) {
      const file = `electron/${name}`;
      if (!name.endsWith(".cjs") || ignored(file)) continue;
      const source = readFileSync(path.resolve(file), "utf8");
      for (const match of source.matchAll(/require\(["'](\.\.?\/[^"']+)["']\)/g)) {
        const dependency = path.posix.normalize(path.posix.join("electron", match[1]));
        expect(ignored(dependency), `${file} requires ${dependency}`).toBe(false);
      }
    }
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

  it("includes the shipped research workflows but excludes unregistered skill files", () => {
    expect(ignored("electron/research-skills.cjs")).toBe(false);
    expect(ignored("skills/research/manifest.json")).toBe(false);
    for (const name of ["paper-deep-reading", "literature-search-review", "literature-comparison-notes"]) {
      expect(ignored(`skills/research/${name}/SKILL.md`)).toBe(false);
      expect(ignored(`skills/research/${name}/private.pdf`)).toBe(true);
    }
    expect(ignored("skills/research/private-skill/SKILL.md")).toBe(true);
    expect(ignored("skills/personal/SKILL.md")).toBe(true);
  });
});
