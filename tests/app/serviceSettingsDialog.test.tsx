import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceSettingsDialog } from "../../src/features/settings/ServiceSettingsDialog";
import { DEFAULT_SERVICE_SETTINGS, toPublicServiceSettings } from "../../src/domain/serviceSettings";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  vi.restoreAllMocks();
  delete window.zhiyan;
});

async function mount(settings: ReturnType<typeof toPublicServiceSettings>) {
  const invoke = vi.fn(async (channel: string, _payload?: unknown) => {
    if (channel === "zhiyan:settings:get") return settings;
    if (channel === "zhiyan:settings:test") return { ok: true, message: "测试成功" };
    if (channel === "zhiyan:settings:save") return settings;
    throw new Error(`Unexpected IPC channel: ${channel}`);
  });
  window.zhiyan = { invoke: invoke as never };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<ServiceSettingsDialog onClose={vi.fn()} onSaved={vi.fn()} />));
  await act(async () => Promise.resolve());
  return { container, root, invoke };
}

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("service settings dialog", () => {
  it("tests a newly entered model key before saving and sends the current draft", async () => {
    const { container, root, invoke } = await mount(toPublicServiceSettings(DEFAULT_SERVICE_SETTINGS));
    const deepseek = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      .find((button) => button.textContent?.includes("DeepSeek 官方"))!;

    await act(async () => deepseek.click());
    const key = container.querySelector<HTMLInputElement>("#deepseek-key")!;
    const model = container.querySelector<HTMLInputElement>("#deepseek-model")!;
    await act(async () => {
      setInputValue(key, "draft-deepseek-key");
      setInputValue(model, "deepseek-chat");
    });

    const testButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("测试所选模型"))!;
    expect(testButton.disabled).toBe(false);

    await act(async () => testButton.click());
    const testCall = invoke.mock.calls.find(([channel]) => channel === "zhiyan:settings:test");
    expect(testCall?.[1]).toEqual({
      provider: "deepseek",
      apiKey: "draft-deepseek-key",
      model: "deepseek-chat",
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("测试成功");

    await act(async () => root.unmount());
    container.remove();
  });

  it("tests a changed model against the saved key without replacing the saved key", async () => {
    const settings = toPublicServiceSettings({
      ...DEFAULT_SERVICE_SETTINGS,
      aiProvider: "deepseek",
      deepseek: { ...DEFAULT_SERVICE_SETTINGS.deepseek, apiKey: "saved-deepseek-key" },
    });
    const { container, root, invoke } = await mount(settings);
    const model = container.querySelector<HTMLInputElement>("#deepseek-model")!;

    await act(async () => setInputValue(model, "deepseek-reasoner"));
    const testButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("测试所选模型"))!;
    await act(async () => testButton.click());

    const testCall = invoke.mock.calls.find(([channel]) => channel === "zhiyan:settings:test");
    expect(testCall?.[1]).toEqual({
      provider: "deepseek",
      model: "deepseek-reasoner",
    });

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps model service and paper parsing as parallel configuration areas", async () => {
    const { container, root } = await mount(toPublicServiceSettings(DEFAULT_SERVICE_SETTINGS));

    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("模型服务");
    expect(container.textContent).toContain("选择模型服务商");
    expect(container.textContent).not.toContain("MinerU API Token");

    const parserTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent?.includes("论文解析"))!;
    await act(async () => parserTab.click());

    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("论文解析");
    expect(container.textContent).toContain("MinerU API Token");
    expect(container.textContent).not.toContain("选择模型服务商");

    await act(async () => root.unmount());
    container.remove();
  });

  it("saves the independent MinerU configuration without changing the selected model provider", async () => {
    const settings = toPublicServiceSettings({
      ...DEFAULT_SERVICE_SETTINGS,
      aiProvider: "deepseek",
      deepseek: { ...DEFAULT_SERVICE_SETTINGS.deepseek, apiKey: "saved-deepseek-key" },
    });
    const { container, root, invoke } = await mount(settings);
    const parserTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent?.includes("论文解析"))!;
    await act(async () => parserTab.click());

    const token = container.querySelector<HTMLInputElement>("#mineru-key")!;
    await act(async () => setInputValue(token, "draft-mineru-token"));
    const testButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("检查 MinerU 配置"))!;
    await act(async () => testButton.click());

    const testCall = invoke.mock.calls.find(([channel]) => channel === "zhiyan:settings:test");
    expect(testCall?.[1]).toEqual({ provider: "mineru", apiKey: "draft-mineru-token" });

    const saveButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("保存配置"))!;
    await act(async () => saveButton.click());
    const saveCall = invoke.mock.calls.find(([channel]) => channel === "zhiyan:settings:save");
    expect(saveCall?.[1]).toMatchObject({
      aiProvider: "deepseek",
      deepseek: { apiKey: "", model: "deepseek-flash" },
      mineru: { apiKey: "draft-mineru-token" },
    });

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps each service draft while switching areas and model providers", async () => {
    const { container, root, invoke } = await mount(toPublicServiceSettings(DEFAULT_SERVICE_SETTINGS));
    const radios = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    await act(async () => setInputValue(container.querySelector("#deepseek-key")!, "draft-deepseek"));
    await act(async () => radios[0].click());
    await act(async () => setInputValue(container.querySelector("#aliyun-key")!, "draft-aliyun"));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')][1].click());
    await act(async () => setInputValue(container.querySelector("#mineru-key")!, "draft-mineru"));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')][0].click());
    expect(container.querySelector<HTMLInputElement>("#aliyun-key")!.value).toBe("draft-aliyun");
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')][1].click());
    expect(container.querySelector<HTMLInputElement>("#deepseek-key")!.value).toBe("draft-deepseek");
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "保存配置")!.click());
    expect(invoke.mock.calls.find(([channel]) => channel === "zhiyan:settings:save")?.[1]).toMatchObject({
      aiProvider: "deepseek",
      aliyun: { apiKey: "draft-aliyun" },
      deepseek: { apiKey: "draft-deepseek" },
      mineru: { apiKey: "draft-mineru" },
    });
    await act(async () => root.unmount());
    container.remove();
  });

  it("supports arrow keys for service areas and the mutually exclusive model choices", async () => {
    const { container, root } = await mount(toPublicServiceSettings(DEFAULT_SERVICE_SETTINGS));
    try {
      const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      tabs[0].focus();
      await act(async () => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
      expect(tabs[1].getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(tabs[1]);
      await act(async () => tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
      const radios = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
      radios[1].focus();
      await act(async () => radios[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
      expect(radios[0].getAttribute("aria-checked")).toBe("true");
      expect(document.activeElement).toBe(radios[0]);
      expect(container.querySelector<HTMLInputElement>("#aliyun-key")).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
