import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibrarySidebar } from "../../src/features/library/LibrarySidebar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => { delete window.zhiyan; });

describe("library update indicator", () => {
  it("shows an accessible red-dot indicator when a verified update is available", async () => {
    let emit: (value: unknown) => void = () => {};
    window.zhiyan = {
      isDesktop: true,
      invoke: vi.fn(async () => ({ phase: "idle", currentVersion: "0.4.2" })) as never,
      on: (_channel, handler) => { emit = handler as never; return () => {}; },
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<LibrarySidebar
      activeFilter="all"
      groups={[]}
      onFilterChange={() => {}}
      onCreateGroup={() => {}}
      onOpenSettings={() => {}}
    />));

    expect(container.querySelector('[aria-label="检查更新"] .update-available-dot')).toBeNull();
    await act(async () => emit({ phase: "available", currentVersion: "0.4.2", latestVersion: "0.4.3" }));
    const button = container.querySelector<HTMLButtonElement>('[aria-label="检查更新，有新版本"]');
    expect(button).not.toBeNull();
    expect(button?.querySelector(".update-available-dot")).not.toBeNull();
    await act(async () => emit({ phase: "current", currentVersion: "0.4.2" }));
    expect(container.querySelector('[aria-label="检查更新"] .update-available-dot')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });
});
