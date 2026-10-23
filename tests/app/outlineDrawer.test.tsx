import { act, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutlineDrawer } from "../../src/features/reader/OutlineDrawer";
import { buildSectionSkeleton, type WikiEntry } from "../../src/domain/paperWiki";
import { projectOutlineMap, type OutlineNode } from "../../src/domain/outlineMap";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement;

const blocks = [
  { id: "p001-b001", pageNumber: 1, order: 0, kind: "heading" as const, text: "Introduction", headingLevel: 1 as const },
  { id: "p001-b002", pageNumber: 1, order: 1, kind: "paragraph" as const, text: "We study X." },
  { id: "p002-b001", pageNumber: 2, order: 2, kind: "heading" as const, text: "2 Method", headingLevel: 1 as const },
  { id: "p002-b002", pageNumber: 2, order: 3, kind: "paragraph" as const, text: "Our method uses Y." },
];

const threadEntries: WikiEntry[] = [
  { id: "thread:e1", sectionId: "thread", kind: "problem", title: "研究问题",
    anchors: [{ blockId: "p001-b002", pageNumber: 1, quote: "We study X." }], locatable: true },
];

const sectionEntries: Record<string, WikiEntry[]> = {
  "p002-b001": [
    { id: "p002-b001:e1", sectionId: "p002-b001", kind: "method", title: "方法 Y",
      anchors: [{ blockId: "p002-b002", pageNumber: 2, quote: "Our method uses Y." }], locatable: true },
  ],
};

const map = projectOutlineMap({
  paperTitle: "A Paper",
  sections: buildSectionSkeleton(blocks),
  threadEntries,
  sectionEntries,
  sectionStates: {},
  coverage: { covered: 1, total: 2 },
  droppedAnchors: 0,
  mergedDuplicates: 0,
});

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
    progress: null,
    fitSignal: 0,
    selectedId: null,
    onSelect: vi.fn(),
    onRetrySection: vi.fn(),
    onClose: vi.fn(),
    onRegenerate: vi.fn(),
    ...overrides,
  };
}

function click(node: Element) {
  return act(async () => node.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function nodeByTitle(title: string): SVGGElement {
  return Array.from(container.querySelectorAll<SVGGElement>(".outline-node"))
    .find((node) => node.querySelector(".outline-node-title")?.textContent === title)!;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.clearAllMocks();
});

describe("outline drawer", () => {
  it("shows the whole tree at once with generation progress and coverage meta", async () => {
    await render(<OutlineDrawer {...props({ progress: { done: 2, total: 9 } })} />);
    const titles = Array.from(container.querySelectorAll(".outline-node-title")).map((node) => node.textContent);
    expect(titles).toContain("论证主线");
    expect(titles).toContain("Introduction");
    expect(titles).toContain("2 Method");
    expect(titles).toContain("方法 Y");
    expect(container.querySelector(".outline-drawer-meta")!.textContent).toContain("已生成 1/2 章");
    expect(container.querySelector(".outline-drawer-meta")!.textContent).toContain("段落覆盖 50%");
    expect(container.querySelector(".outline-drawer-meta")!.textContent).toContain("正在提炼章节条目 2/9");
    expect(container.textContent).toContain("条目生成中…"); // 未完成章节在树里显示生成中
  });

  it("disables regenerate while generating", async () => {
    await render(<OutlineDrawer {...props({ progress: { done: 1, total: 3 } })} />);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="重新生成文章架构"]')!.disabled).toBe(true);
    await render(<OutlineDrawer {...props()} />);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="重新生成文章架构"]')!.disabled).toBe(false);
  });

  it("reports the clicked entry node and jumps anchors", async () => {
    const onSelect = vi.fn();
    await render(<OutlineDrawer {...props({ onSelect })} />);
    await click(nodeByTitle("方法 Y"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const selected = onSelect.mock.calls[0][0] as OutlineNode;
    expect(selected.id).toBe("p002-b001:e1");
    expect(selected.anchors[0].blockId).toBe("p002-b002");
  });

  it("collapses and expands section children from the toggle", async () => {
    await render(<OutlineDrawer {...props()} />);
    expect(container.querySelectorAll(".outline-node")).toHaveLength(5);
    const toggle = nodeByTitle("2 Method").querySelector(".outline-node-toggle")!;
    await click(toggle);
    expect(container.querySelectorAll(".outline-node")).toHaveLength(4);
    await click(nodeByTitle("2 Method").querySelector(".outline-node-toggle")!);
    expect(container.querySelectorAll(".outline-node")).toHaveLength(5);
  });

  it("retries a failed section from its node", async () => {
    const failedMap = projectOutlineMap({
      paperTitle: "A Paper",
      sections: buildSectionSkeleton(blocks),
      threadEntries,
      sectionEntries,
      sectionStates: { "p001-b001": { state: "error", error: "服务超时" } },
      coverage: { covered: 1, total: 2 },
      droppedAnchors: 0,
      mergedDuplicates: 0,
    });
    const onRetrySection = vi.fn();
    await render(<OutlineDrawer {...props({ map: failedMap, onRetrySection })} />);
    const failed = container.querySelector<SVGGElement>(".outline-node.is-error")!;
    expect(failed.querySelector(".outline-node-kind")!.textContent).toContain("生成失败");
    await click(failed);
    expect(onRetrySection).toHaveBeenCalledTimes(1);
    expect((onRetrySection.mock.calls[0][0] as OutlineNode).id).toBe("p001-b001");
  });

  it("shows a loading state while the skeleton builds and a retryable error", async () => {
    await render(<OutlineDrawer {...props({ map: null, status: "loading" })} />);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("正在提取文章架构");
    const onRegenerate = vi.fn();
    await render(<OutlineDrawer {...props({ map: null, status: "error", error: "当前论文还没有可分析的正文块", onRegenerate })} />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("正文块");
    await act(async () => container.querySelector<HTMLButtonElement>(".outline-error .text-button")!.click());
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("keeps the map usable when only the thread failed", async () => {
    await render(<OutlineDrawer {...props({ error: "论证主线生成失败，请重试" })} />);
    expect(container.querySelectorAll(".outline-node").length).toBeGreaterThan(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("论证主线");
  });

  it("highlights the selected node", async () => {
    await render(<OutlineDrawer {...props({ selectedId: "thread:e1" })} />);
    expect(container.querySelector(".outline-node.is-selected")).toBeTruthy();
  });
});
