import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const scriptPath = path.resolve("scripts/copy-pdf-worker.cjs");

describe("PDF.js worker preparation", () => {
  it("copies a real worker file into the public runtime path", () => {
    execFileSync(process.execPath, [scriptPath], { cwd: path.resolve(".") });
    const workerPath = path.resolve("public/pdf.worker.min.mjs");
    expect(fs.existsSync(workerPath)).toBe(true);
    expect(fs.statSync(workerPath).size).toBeGreaterThan(100_000);
  });

  it("exports a validation helper for the worker source", () => {
    const script = require(scriptPath) as { validateWorker?: (filePath: string) => void };
    expect(script.validateWorker).toBeTypeOf("function");
    expect(() => script.validateWorker?.(path.join("missing", "pdf.worker.min.mjs"))).toThrow(/not found/i);
  });
});
