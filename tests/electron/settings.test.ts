import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { DEFAULT, summary, update, resolveTestService } = require("../../electron/settings.cjs") as {
  DEFAULT: Record<string, unknown>;
  summary: (settings: unknown) => unknown;
  update: (previous: unknown, input: unknown) => Record<string, { apiKey?: string }>;
  resolveTestService: (settings: unknown, provider: string, input?: unknown) => { apiKey: string; model: string };
};

describe("desktop settings IPC boundary", () => {
  it("preserves existing secrets when fields are blank and never returns them in a summary", () => {
    const first = update(DEFAULT, {
      aiProvider: "deepseek",
      aliyun: { apiKey: "aliyun-test", model: "qwen-plus" },
      deepseek: { apiKey: "deepseek-test", model: "deepseek-flash" },
      mineru: { apiKey: "mineru-test" },
    });
    const second = update(first, {
      aiProvider: "deepseek",
      aliyun: { apiKey: "", model: "qwen-plus" },
      deepseek: { apiKey: "", model: "deepseek-flash" },
      mineru: { apiKey: "" },
    });
    expect(second.aliyun.apiKey).toBe("aliyun-test");
    expect(second.deepseek.apiKey).toBe("deepseek-test");
    expect(second.mineru.apiKey).toBe("mineru-test");
    expect(JSON.stringify(summary(second))).not.toContain("-test");
  });

  it("clears only the key selected by the user", () => {
    const first = update(DEFAULT, {
      aiProvider: "deepseek",
      aliyun: { apiKey: "aliyun-test", model: "qwen-plus" },
      deepseek: { apiKey: "deepseek-test", model: "deepseek-flash" },
    });
    const next = update(first, {
      aiProvider: "deepseek",
      aliyun: { clearApiKey: true, model: "qwen-plus" },
    });
    expect(next.aliyun.apiKey).toBe("");
    expect(next.deepseek.apiKey).toBe("deepseek-test");
  });

  it("rotates a non-secret cache revision whenever settings change", () => {
    const first = update(DEFAULT, { aiProvider: "deepseek" });
    const second = update(first, { aiProvider: "deepseek" });
    expect(first.revision).not.toBe(second.revision);
    expect((summary(second) as { revision: string }).revision).toBe(second.revision);
    expect(second.revision).not.toContain("test");
  });

  it("resolves the current draft key and model for a connection test", () => {
    const settings = update(DEFAULT, {
      aiProvider: "deepseek",
      deepseek: { apiKey: "saved-key", model: "deepseek-flash" },
    });

    expect(resolveTestService(settings, "deepseek", {
      apiKey: "draft-key",
      model: "deepseek-chat",
    })).toMatchObject({
      apiKey: "draft-key",
      model: "deepseek-chat",
    });
    expect(resolveTestService(settings, "deepseek", {
      model: "deepseek-reasoner",
    })).toMatchObject({
      apiKey: "saved-key",
      model: "deepseek-reasoner",
    });
  });
});
