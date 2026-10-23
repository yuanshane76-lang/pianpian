import { act, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutlineDrawer } from "../../src/features/reader/OutlineDrawer";
import type { OutlineMap } from "../../src/domain/outlineMap";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement;

const map: OutlineMap = {
  title: "Test Paper",
  stats: { total: 2, locatable: 1, droppedAnchors: 1 },
  nodes: [
    {
      id: "1",
      title: "研究问题",
      kind: "problem",
      locatable: true,
      anchors: [{ blockId: "p001-b002", pageNumber: 1, quote: "We study X." }],
      children: [
        { id: "1.1", title: "子节点", kind: "method", locatable: false, anchors: [], children: [] },
      ],
    },
  ],
};

async function render(element: ReactElement) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
}

function props(overrides: Partial<ComponentProps<typeof OutlineDrawer>> = {}) {
  return {
    map,
    status: "ready" as const,
    error: null,
    selectedId: null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onRegenerate: vi.fn(),
    ...overrides,
  };
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.clearAllMocks();
});

describe("outline drawer", () => {
  it("renders the tree and marks unlocatable nodes", async () => {
    await render(<OutlineDrawer {...props()} />);
    expect(container.querySelectorAll(".outline-node")).toHaveLength(2);
    expect(container.textContent).toContain("研究问题");
    expect(container.textContent).toContain("子节点");
    expect(container.textContent).toContain("1 个节点未定位");
    expect(container.querySelector(".outline-node.is-unlocatable")).toBeTruthy();
  });

  it("reports the clicked node", async () => {
    const onSelect = vi.fn();
    await render(<OutlineDrawer {...props({ onSelect })} />);
    await act(async () => container.querySelector<SVGGElement>(".outline-node")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSelect).toHaveBeenCalledWith(map.nodes[0]);
  });

  it("collapses and expands children from the toggle", async () => {
    await render(<OutlineDrawer {...props()} />);
    const toggle = container.querySelector<SVGGElement>(".outline-node-toggle")!;
    await act(async () => toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelectorAll(".outline-node")).toHaveLength(1);
    await act(async () => container.querySelector<SVGGElement>(".outline-node-toggle")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelectorAll(".outline-node")).toHaveLength(2);
  });

  it("highlights the selected node", async () => {
    await render(<OutlineDrawer {...props({ selectedId: "1.1" })} />);
    expect(container.querySelector(".outline-node.is-selected")).toBeTruthy();
  });

  it("shows a loading state while the model runs", async () => {
    await render(<OutlineDrawer {...props({ map: null, status: "loading" })} />);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("正在提取文章架构");
  });

  it("shows the failure and retries", async () => {
    const onRegenerate = vi.fn();
    await render(<OutlineDrawer {...props({ map: null, status: "error", error: "模型返回的结构化大纲无法解析，请重试", onRegenerate })} />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("无法解析");
    await act(async () => container.querySelector<HTMLButtonElement>(".outline-error .text-button")!.click());
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
