import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("bundled research skills", () => {
  it.each(["directory", "junction"])("never discovers an unregistered %s even when it contains a valid skill", async (kind) => {
    const { loadBundledResearchSkills } = require("../../electron/research-skills.cjs");
    const pi = await import("@earendil-works/pi-coding-agent");
    const root = path.dirname(require.resolve("../../skills/research/manifest.json"));
    const unexpected = path.join(root, `unregistered-${randomUUID()}`);
    const fixture = kind === "junction" ? mkdtempSync(path.join(os.tmpdir(), "zhiyan-skill-")) : unexpected;
    if (kind === "directory") mkdirSync(fixture);
    const file = path.join(fixture, "SKILL.md");
    writeFileSync(file, "---\nname: unexpected-personal-skill\ndescription: A synthetic skill that must never be discovered.\n---\nUnregistered fixture.\n", "utf8");
    try {
      if (kind === "junction") symlinkSync(fixture, unexpected, process.platform === "win32" ? "junction" : "dir");
      expect(loadBundledResearchSkills(pi).skills).toHaveLength(3);
    } finally {
      if (kind === "junction") {
        if (process.platform === "win32") rmdirSync(unexpected);
        else unlinkSync(unexpected);
      }
      unlinkSync(file);
      rmdirSync(fixture);
    }
  }, 30000);

  it("ships discoverable workflows and reads only named bundled skills", async () => {
    const { listBundledResearchSkills, readBundledResearchSkill, loadBundledResearchSkills } =
      require("../../electron/research-skills.cjs");
    const catalogue = listBundledResearchSkills();
    expect(catalogue.map((skill: any) => skill.name)).toEqual([
      "paper-deep-reading", "literature-search-review", "literature-comparison-notes",
    ]);
    const pi = await import("@earendil-works/pi-coding-agent");
    const { skills, diagnostics } = loadBundledResearchSkills(pi);
    expect(diagnostics).toEqual([]);
    expect(skills.map((skill: any) => skill.name).sort()).toEqual(catalogue.map((skill: any) => skill.name).sort());
    for (const skill of skills) {
      const loaded = readBundledResearchSkill(skill.name);
      expect(loaded.instructions).toBe(readFileSync(skill.filePath, "utf8"));
      expect(loaded.instructions.length).toBeGreaterThan(200);
      expect(loaded.title).toBe(catalogue.find((item: any) => item.name === skill.name).title);
    }
    for (const name of ["../../service-settings.enc.json", "C:\\private\\SKILL.md", "personal-skill", ""]) {
      expect(() => readBundledResearchSkill(name)).toThrow("预置研究技能");
    }
  }, 30000);

  it("exposes skill instructions through the product tool without accepting arbitrary paths", async () => {
    const { createToolDefinitions } = require("../../electron/research-agent-tools.cjs");
    const reader = createToolDefinitions({ getContext: () => ({}) })
      .find((tool: any) => tool.name === "read_research_skill");
    expect(reader).toBeTruthy();
    const output = await reader.execute("skill-read", { name: "paper-deep-reading" });
    expect(output.details).toMatchObject({ name: "paper-deep-reading", title: "论文精读" });
    expect(output.details.instructions).toContain("read_current_paper");
    await expect(reader.execute("bad", { name: "../../private" })).rejects.toThrow("预置研究技能");
  });
});
