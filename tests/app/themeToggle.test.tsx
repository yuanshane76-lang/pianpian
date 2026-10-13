import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "../../src/features/settings/ThemeToggle";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mounted: Array<{ root: Root; container: HTMLElement }> = [];
async function mount(variant?: "icon") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(<ThemeToggle variant={variant} />));
  return { root, container };
}

describe("theme toggle navigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(async () => {
    for (const { root, container } of mounted.splice(0)) {
      await act(async () => root.unmount());
      container.remove();
    }
    vi.restoreAllMocks();
    delete document.documentElement.dataset.theme;
  });

  it("keeps the applied theme when storage fails and the control remounts", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is full", "QuotaExceededError");
    });
    const library = await mount();
    await act(async () => library.container.querySelector("button")!.click());
    expect(document.documentElement.dataset.theme).toBe("dark");
    await act(async () => library.root.unmount());
    const reader = await mount("icon");
    expect(reader.container.querySelector("button")!.getAttribute("aria-label")).toBe("切换为浅色模式");
    await act(async () => reader.container.querySelector("button")!.click());
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
