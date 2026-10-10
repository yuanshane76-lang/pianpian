import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { auditRepository, credentialKinds } = require("../../scripts/check-credentials.cjs") as {
  auditRepository: (cwd: string) => { source: string; file: string; kinds: string[] }[];
  credentialKinds: (text: string) => string[];
};

describe("credential audit", () => {
  it("supports deleted tracked files while still auditing history and deleted staged credentials", () => {
    const temporary = mkdtempSync(path.join(os.tmpdir(), "zhiyan-audit-deletion-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: temporary, stdio: "pipe" });
    const fakeKey = "sk-" + "a".repeat(32);
    try {
      git("init");
      git("config", "user.name", "Audit test");
      git("config", "user.email", "audit@example.invalid");
      writeFileSync(path.join(temporary, "removed.ts"), "export const value = 1;");
      git("add", "removed.ts");
      git("commit", "-m", "clean fixture");
      unlinkSync(path.join(temporary, "removed.ts"));
      expect(auditRepository(temporary)).toEqual([]);
      writeFileSync(path.join(temporary, "staged.md"), fakeKey);
      git("add", "staged.md");
      unlinkSync(path.join(temporary, "staged.md"));
      expect(auditRepository(temporary)).toContainEqual({ source: "index", file: "staged.md", kinds: ["service-key"] });
      git("commit", "-m", "fixture key in history");
      expect(auditRepository(temporary)).toContainEqual({ source: "history", file: "staged.md", kinds: ["service-key"] });
      expect(JSON.stringify(auditRepository(temporary))).not.toContain(fakeKey);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
  it("accepts empty service configuration and identifies token formats without returning values", () => {
    expect(credentialKinds('apiKey: "", apiKey: "sk-test"')).toEqual([]);
    expect(credentialKinds("sk-" + "a".repeat(32))).toEqual(["service-key"]);
    expect(credentialKinds("ghp_" + "b".repeat(36))).toEqual(["github-token"]);
  });

  it("finds an old committed key even after the current document was redacted", () => {
    const temporary = mkdtempSync(path.join(os.tmpdir(), "zhiyan-audit-test-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: temporary, stdio: "pipe" });
    const fakeKey = "sk-" + "a".repeat(32);
    try {
      git("init");
      git("config", "user.name", "Audit test");
      git("config", "user.email", "audit@example.invalid");
      writeFileSync(path.join(temporary, "prd.md"), fakeKey);
      git("add", "prd.md");
      git("commit", "-m", "fixture with old key");
      writeFileSync(path.join(temporary, "prd.md"), "密钥已移除");
      git("add", "prd.md");
      git("commit", "-m", "redacted current document");
      const findings = auditRepository(temporary);
      expect(findings).toContainEqual({ source: "history", file: "prd.md", kinds: ["service-key"] });
      expect(findings.some((finding) => finding.source === "worktree")).toBe(false);
      expect(JSON.stringify(findings)).not.toContain(fakeKey);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
