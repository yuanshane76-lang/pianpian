import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/app/App";
import { DEFAULT_SERVICE_SETTINGS, mergeServiceSettings, toPublicServiceSettings, type ServiceSettingsInput, type StoredServiceSettings } from "../../src/domain/serviceSettings";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mounted: Root[] = [];
afterEach(async () => {
  for (const root of mounted.splice(0)) await act(async () => root.unmount());
  window.localStorage.clear();
  document.body.innerHTML = "";
  delete window.zhiyan;
  vi.restoreAllMocks();
});

const complete = (): StoredServiceSettings => ({
  ...DEFAULT_SERVICE_SETTINGS,
  deepseek: { ...DEFAULT_SERVICE_SETTINGS.deepseek, apiKey: "synthetic-model" },
  mineru: { ...DEFAULT_SERVICE_SETTINGS.mineru, apiKey: "synthetic-parser" },
});
async function mount(stored = DEFAULT_SERVICE_SETTINGS, read?: () => Promise<unknown>) {
  let settings = structuredClone(stored);
  const invoke = vi.fn(async (channel: string, input?: unknown) => {
    if (channel === "zhiyan:settings:get") return read ? read() : toPublicServiceSettings(settings);
    if (channel === "zhiyan:settings:save") {
      settings = mergeServiceSettings(settings, input as ServiceSettingsInput);
      return toPublicServiceSettings(settings);
    }
    if (channel === "zhiyan:documents:states") return [];
    throw new Error(`Unexpected IPC channel: ${channel}`);
  });
  window.zhiyan = { isDesktop: true, invoke: invoke as never };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => root.render(<App />));
  return { container, invoke, root };
}
function dialog(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[role="dialog"][aria-label="服务配置"]');
}
async function input(container: HTMLElement, selector: string, value: string) {
  await act(async () => {
    const field = container.querySelector<HTMLInputElement>(selector)!;
    expect(field).not.toBeNull();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function save(container: HTMLElement) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.includes("保存配置"));
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

describe("mandatory desktop service setup", () => {
  it("opens setup for an empty profile and cannot be dismissed by backdrop or Escape", async () => {
    const { container, invoke } = await mount();
    expect(dialog(container)).not.toBeNull();
    expect(container.textContent).toContain("完成配置后开始使用");
    expect(container.querySelector('[aria-label="关闭配置"]')).toBeNull();
    await act(async () => {
      container.querySelector(".settings-overlay")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(dialog(container)).not.toBeNull();
    expect(container.querySelector(".workspace-shell")?.hasAttribute("inert")).toBe(true);
    expect(invoke.mock.calls.filter(([channel]) => channel === "zhiyan:settings:test")).toEqual([]);
  });

  it("does not mistake unresolved settings for an empty profile", async () => {
    let resolve!: (value: unknown) => void;
    const reading = new Promise(done => { resolve = done; });
    const { container } = await mount(DEFAULT_SERVICE_SETTINGS, () => reading);
    expect(dialog(container)).toBeNull();
    await act(async () => resolve(toPublicServiceSettings(DEFAULT_SERVICE_SETTINGS)));
    expect(dialog(container)).not.toBeNull();
  });

  it("opens the parser step when only MinerU is missing and focuses its field", async () => {
    const { container } = await mount({ ...complete(), mineru: DEFAULT_SERVICE_SETTINGS.mineru });
    expect(dialog(container)).not.toBeNull();
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("论文解析");
    expect(document.activeElement).toBe(container.querySelector("#mineru-key"));
  });

  it("keeps a partial save in setup, moves to the missing service and unlocks only after both are saved", async () => {
    const { container, invoke } = await mount();
    await input(container, "#deepseek-key", "synthetic-model-draft");
    await save(container);
    expect(dialog(container)).not.toBeNull();
    expect(container.querySelector("#mineru-key")).not.toBeNull();
    expect(container.textContent).toContain("模型密钥已保存");
    await input(container, "#mineru-key", "synthetic-parser-draft");
    await save(container);
    expect(dialog(container)).toBeNull();
    expect(container.querySelector(".workspace-shell")?.hasAttribute("inert")).toBe(false);
    expect(invoke.mock.calls.filter(([channel]) => channel === "zhiyan:settings:save")).toHaveLength(2);
    expect(invoke.mock.calls.filter(([channel]) => channel === "zhiyan:settings:test")).toEqual([]);
  });

  it("accepts the selected Aliyun provider without requiring a DeepSeek key", async () => {
    const { container } = await mount({ ...DEFAULT_SERVICE_SETTINGS, mineru: complete().mineru });
    expect(dialog(container)).not.toBeNull();
    const aliyun = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(button => button.textContent?.includes("阿里云百炼"))!;
    await act(async () => aliyun.click());
    await input(container, "#aliyun-key", "synthetic-aliyun-draft");
    await save(container);
    expect(dialog(container)).toBeNull();
  });

  it("leaves a complete profile alone but returns to mandatory setup after clearing a required key", async () => {
    const { container } = await mount(complete());
    expect(dialog(container)).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="服务配置"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="删除DeepSeek API Key"]')!.click());
    await save(container);
    expect(dialog(container)).not.toBeNull();
    expect(container.textContent).toContain("完成配置后开始使用");
    expect(container.querySelector('[aria-label="关闭配置"]')).toBeNull();
  });

  it("holds focus inside the mandatory setup dialog", async () => {
    const { container } = await mount();
    const saveButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("保存配置"))!;
    saveButton.focus();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(dialog(container)?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(saveButton);
  });

  it("does not unlock setup when saving fails", async () => {
    const { container, invoke } = await mount({ ...complete(), mineru: DEFAULT_SERVICE_SETTINGS.mineru });
    await input(container, "#mineru-key", "synthetic-parser-draft");
    invoke.mockImplementationOnce(async () => { throw new Error("无法加密保存配置"); });
    await save(container);
    expect(dialog(container)).not.toBeNull();
    expect(container.textContent).toContain("无法加密保存配置");
    expect(container.querySelector<HTMLInputElement>("#mineru-key")?.value).toBe("synthetic-parser-draft");
  });

  it("shows a retry instead of treating a failed configuration read as an empty profile", async () => {
    let attempts = 0;
    const { container, invoke } = await mount(complete(), async () => {
      if (++attempts === 1) throw new Error("读取失败");
      return toPublicServiceSettings(complete());
    });
    expect(dialog(container)).not.toBeNull();
    const retry = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("重新读取配置"));
    expect(retry).toBeDefined();
    expect(invoke.mock.calls.filter(([channel]) => channel === "zhiyan:settings:save")).toEqual([]);
    await act(async () => retry!.click());
    expect(dialog(container)).toBeNull();
  });

  it("does not force browser previews into a desktop-only configuration gate", async () => {
    const { container, root } = await mount(complete());
    await act(async () => root.unmount());
    mounted.splice(mounted.indexOf(root), 1);
    delete window.zhiyan;
    const browserRoot = createRoot(container);
    mounted.push(browserRoot);
    await act(async () => browserRoot.render(<App />));
    expect(dialog(container)).toBeNull();
  });
});
