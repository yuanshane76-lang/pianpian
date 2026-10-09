import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { auditRepository, credentialKinds } = require("../../scripts/check-credentials.cjs") as {
  auditRepository: (cwd: string) => { source: string; file: string; kinds: string[] }[];
  credentialKinds: (text: string) => string[];
};

describe("credential audit", () => {
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
