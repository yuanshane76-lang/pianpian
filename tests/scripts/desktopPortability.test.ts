import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop verification portability", () => {
  const scripts = readdirSync(path.resolve("scripts")).filter((file) => file.endsWith("-e2e.cjs"));

  it.each(scripts)("uses project-owned runtime dependencies: %s", (file) => {
    const source = readFileSync(path.resolve("scripts", file), "utf8");
    expect(source).toContain('require("playwright")');
    if (file === "packaged-research-skills-e2e.cjs") {
      expect(source).toContain('const executable = path.resolve(process.argv[2]');
      expect(source).toContain('path.basename(executable) === "Pianpian.exe"');
      expect(source).toContain("executablePath: executable");
    } else {
      expect(source).toContain('executablePath: require("electron")');
    }
    expect(source).not.toMatch(/require\(["'][A-Z]:[\\/]/i);
  });

  it("keeps credential and worker preparation checks in the verification entry point", () => {
    const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));
    expect(packageJson.devDependencies.playwright).toBeTruthy();
    expect(packageJson.dependencies.katex).toBeTruthy();
    expect(packageJson.scripts.check).toContain("check:credentials");
    expect(packageJson.scripts.check).toContain("prepare:pdf-worker");
  });

  it("verifies the current desktop shell without the removed reader mode switch", () => {
    const source = readFileSync(path.resolve("scripts/desktop-e2e.cjs"), "utf8");
    expect(source).toContain('app.setPath("userData"');
    expect(source).not.toContain("reader-mode-switch");
    expect(source).not.toContain('name: "阅读版"');
    expect(source).not.toContain('name: "原始 PDF"');
  });

  it("measures PDF coordinates within the selected continuous page", () => {
    const source = readFileSync(path.resolve("scripts/pdf-layout-e2e.cjs"), "utf8");
    expect(source).toContain('element.closest(".pdf-page-stage")');
    expect(source).not.toContain('document.querySelector(".pdf-page-stage canvas")');
  });
});
