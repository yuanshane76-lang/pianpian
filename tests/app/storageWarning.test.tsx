import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/app/App";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("desktop persistence feedback", () => {
  it("shows a Chinese warning when the paper library cannot be saved", async () => {
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === "zhiyan-workbench.papers.v1") throw new Error("storage full");
      originalSetItem.call(this, key, value);
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(<App />));
    expect(container.textContent).toContain("无法保存文献库");

    await act(async () => root.unmount());
    container.remove();
  });
});
