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
    const deepseek = [...container.querySelectorAll<HTMLButtonElement>(".settings-segments button")]
      .find((button) => button.textContent === "DeepSeek 官方")!;

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
});
