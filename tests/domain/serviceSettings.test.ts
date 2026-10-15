import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVICE_SETTINGS,
  mergeServiceSettings,
  toPublicServiceSettings,
  type ServiceSettingsInput,
} from "../../src/domain/serviceSettings";

describe("service settings", () => {
  it("provides a real provider default without configured secrets", () => {
    expect(DEFAULT_SERVICE_SETTINGS.aiProvider).toBe("deepseek");
    expect(toPublicServiceSettings(DEFAULT_SERVICE_SETTINGS)).toMatchObject({
      aiProvider: "deepseek",
      aliyun: { configured: false, model: "qwen-plus" },
      deepseek: { configured: false, model: "deepseek-flash" },
      mineru: { configured: false },
    });
  });

  it("keeps stored secrets when an edit leaves the key blank", () => {
    const input: ServiceSettingsInput = {
      aiProvider: "aliyun",
      aliyun: { apiKey: "", model: "qwen-max", baseUrl: "https://example.com/v1" },
      deepseek: { apiKey: "", model: "deepseek-flash", baseUrl: "https://api.deepseek.com" },
      mineru: { apiKey: "" },
      semanticScholar: { apiKey: "" },
    };

    const merged = mergeServiceSettings({
      ...DEFAULT_SERVICE_SETTINGS,
      aliyun: {
        ...DEFAULT_SERVICE_SETTINGS.aliyun,
        apiKey: "aliyun-secret",
      },
      deepseek: {
        ...DEFAULT_SERVICE_SETTINGS.deepseek,
        apiKey: "deepseek-secret",
      },
      mineru: { ...DEFAULT_SERVICE_SETTINGS.mineru, apiKey: "mineru-secret" },
      semanticScholar: { ...DEFAULT_SERVICE_SETTINGS.semanticScholar, apiKey: "s2-secret" },
    }, input);

    expect(merged.aliyun.apiKey).toBe("aliyun-secret");
    expect(merged.deepseek.apiKey).toBe("deepseek-secret");
    expect(merged.mineru.apiKey).toBe("mineru-secret");
    expect(merged.semanticScholar.apiKey).toBe("s2-secret");
    expect(merged.aliyun.model).toBe("qwen-max");
  });

  it("falls back to the anonymous literature pool when the key is empty", () => {
    const merged = mergeServiceSettings(DEFAULT_SERVICE_SETTINGS, {
      aiProvider: "deepseek",
      aliyun: { apiKey: "", model: "qwen-plus", baseUrl: "" },
      deepseek: { apiKey: "", model: "deepseek-flash", baseUrl: "" },
      mineru: { apiKey: "" },
      semanticScholar: { apiKey: "" },
    });
    expect(merged.semanticScholar.apiKey).toBe("");
    expect(toPublicServiceSettings(merged).semanticScholar).toMatchObject({
      configured: false,
      endpoint: "https://api.semanticscholar.org",
    });
  });

  it("never exposes secret values in the public settings view", () => {
    const publicSettings = toPublicServiceSettings({
      ...DEFAULT_SERVICE_SETTINGS,
      aliyun: { ...DEFAULT_SERVICE_SETTINGS.aliyun, apiKey: "secret" },
      deepseek: { ...DEFAULT_SERVICE_SETTINGS.deepseek, apiKey: "secret" },
      mineru: { ...DEFAULT_SERVICE_SETTINGS.mineru, apiKey: "secret" },
      semanticScholar: { ...DEFAULT_SERVICE_SETTINGS.semanticScholar, apiKey: "secret" },
    });

    expect(JSON.stringify(publicSettings)).not.toContain("secret");
    expect(publicSettings.aliyun.configured).toBe(true);
    expect(publicSettings.deepseek.configured).toBe(true);
    expect(publicSettings.mineru.configured).toBe(true);
    expect(publicSettings.semanticScholar.configured).toBe(true);
  });
});
