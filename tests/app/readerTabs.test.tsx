import { act, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderTabs } from "../../src/features/reader/ReaderTabs";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement;

const tabs: ComponentProps<typeof ReaderTabs>["tabs"] = [
  { id: "a", title: "Attention Is All You Need", status: "ready" },
  { id: "b", title: "DEER: 长论文样本", status: "pending" },
  { id: "c", title: "解析失败的论文", status: "failed" },
];

async function render(element: ReactElement) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
}

function props(overrides: Partial<ComponentProps<typeof ReaderTabs>> = {}) {
  return {
    tabs,
    activeId: "a",
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onAdd: vi.fn(),
    ...overrides,
  };
}

function click(node: Element, options: MouseEventInit = {}) {
  return act(async () => node.dispatchEvent(new MouseEvent("click", { bubbles: true, ...options })));
}

function auxClick(node: Element, button: number) {
  return act(async () => node.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button })));
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.clearAllMocks();
});

describe("reader tabs", () => {
  it("shows the strip even with a single tab and offers the add button", async () => {
    const onAdd = vi.fn();
    await render(<ReaderTabs {...props({ tabs: tabs.slice(0, 1), onAdd })} />);
    expect(container.querySelectorAll(".reader-tab")).toHaveLength(1);
    const add = container.querySelector<HTMLButtonElement>(".reader-tab-add")!;
    expect(add.getAttribute("aria-label")).toBe("打开新论文");
    await click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("shows status dots and marks the active tab", async () => {
    await render(<ReaderTabs {...props()} />);
    const items = Array.from(container.querySelectorAll(".reader-tab"));
    expect(items).toHaveLength(3);
    expect(items[0].classList.contains("is-active")).toBe(true);
    expect(items[0].getAttribute("aria-current")).toBe("true");
    expect(items[1].querySelector(".reader-tab-status.is-pending")).toBeTruthy();
    expect(items[2].querySelector(".reader-tab-status.is-failed")).toBeTruthy();
  });

  it("selects a tab by click", async () => {
    const onSelect = vi.fn();
    await render(<ReaderTabs {...props({ onSelect })} />);
    const items = Array.from(container.querySelectorAll(".reader-tab"));
    await click(items[1]);
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("closes from the close button, middle click or double click without selecting", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    await render(<ReaderTabs {...props({ onSelect, onClose })} />);
    await click(container.querySelector<HTMLButtonElement>('[aria-label="关闭 DEER: 长论文样本"]')!);
    expect(onClose).toHaveBeenCalledWith("b");
    expect(onSelect).not.toHaveBeenCalled(); // 关闭不会触发切换
    const items = Array.from(container.querySelectorAll(".reader-tab"));
    await auxClick(items[2], 1);
    expect(onClose).toHaveBeenCalledWith("c");
    await act(async () => items[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onClose).toHaveBeenCalledWith("a"); // 双击标题关闭（浏览器习惯）
    await auxClick(items[0], 0); // 左键 auxclick 不关闭
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
