import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateCenter } from "../../src/features/settings/UpdateCenter";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { delete window.zhiyan; });
async function mount() {
  let emit: (value: unknown) => void = () => {};
  const invoke = vi.fn(async (channel: string) => ({ phase: channel.endsWith("check") ? "current" : "idle", currentVersion: "0.4.0", message: "更新只替换应用程序。" }));
  window.zhiyan = { isDesktop: true, invoke: invoke as never, on: (_channel, handler) => { emit = handler as never; return () => {}; } };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<UpdateCenter />));
  return { container, root, invoke, emit };
}
describe("desktop update center", () => {
  it("opens on demand, checks only after a click and restores focus on close", async () => {
    const { container, root, invoke } = await mount();
    expect(invoke).not.toHaveBeenCalled();
    const opener = container.querySelector<HTMLButtonElement>('[aria-label="检查更新"]')!;
    opener.focus(); await act(async () => opener.click());
    expect(invoke).toHaveBeenCalledWith("zhiyan:update:state");
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("论文和阅读记录不会被替换");
    await act(async () => [...dialog.querySelectorAll("button")].find(button => button.textContent === "检查更新")!.click());
    expect(invoke).toHaveBeenCalledWith("zhiyan:update:check");
    await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="关闭更新窗口"]')!.click());
    expect(document.activeElement).toBe(opener);
    await act(async () => root.unmount()); container.remove();
  });
  it("renders progress, keeps installation explicit and never renders release notes as HTML", async () => {
    const { container, root, emit, invoke } = await mount();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="检查更新"]')!.click());
    await act(async () => emit({ phase: "downloading", currentVersion: "0.4.0", latestVersion: "0.4.1", progress: 42, releaseNotes: '<img src="https://bad.example">', message: "下载中" }));
    expect(document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("42");
    expect(document.querySelector(".update-notes img")).toBeNull();
    await act(async () => emit({ phase: "downloaded", currentVersion: "0.4.0", latestVersion: "0.4.1", message: "已下载" }));
    expect(invoke).not.toHaveBeenCalledWith("zhiyan:update:install");
    await act(async () => [...document.querySelectorAll("button")].find(button => button.textContent?.includes("重启并更新"))!.click());
    expect(invoke).toHaveBeenCalledWith("zhiyan:update:install");
    await act(async () => root.unmount()); container.remove();
  });
});
