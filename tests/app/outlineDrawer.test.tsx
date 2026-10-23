import { act, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutlineDrawer } from "../../src/features/reader/OutlineDrawer";
import { buildWikiParts, parsePartTree, type WikiEntry } from "../../src/domain/paperWiki";
import { projectOutlineMap, type OutlineNode } from "../../src/domain/outlineMap";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement;

const blocks = [
  { id: "p001-b001", pageNumber: 1, order: 0, kind: "paragraph" as const, text: "Abstract: we study X." },
  { id: "p001-b002", pageNumber: 1, order: 1, kind: "heading" as const, text: "1 Introduction", headingLevel: 1 as const },
  { id: "p001-b003", pageNumber: 1, order: 2, kind: "paragraph" as const, text: "We study the problem of X." },
  { id: "p002-b001", pageNumber: 2, order: 3, kind: "heading" as const, text: "2 Method", headingLevel: 1 as const },
  { id: "p002-b002", pageNumber: 2, order: 4, kind: "paragraph" as const, text: "Our method uses Y with attention." },
];

const parts = buildWikiParts(blocks);
const methodPart = parts.find((part) => part.title === "2 Method")!;
const methodTree = parsePartTree(JSON.stringify({
  children: [
    {
      title: "注意力机制设计",
      statement: "用注意力加权特征",
      children: [
        { kind: "method", title: "注意力权重", statement: "按相关度加权", anchorBlockIds: ["p002-b002"] },
      ],
    },
  ],
}), methodPart, blocks);

const threadEntries: WikiEntry[] = [
  { id: "thread:e1", sectionId: "thread", kind: "problem", title: "研究问题",
    anchors: [{ blockId: "p001-b003", pageNumber: 1, quote: "We study X." }], locatable: true },
];

const map = projectOutlineMap({
  paperTitle: "A Paper",
  parts,
  renames: { [methodPart.id]: { title: "方法设计", summary: "提出方法 Y" } },
  thread: threadEntries,
  partTrees: { [methodPart.id]: methodTree.tree },
  partStates: {},
  coverage: { covered: 1, total: 1 },
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
  it("defaults to the collapsed skeleton: root, thread branch and parts only", async () => {
    await render(<OutlineDrawer {...props()} />);
    const titles = Array.from(container.querySelectorAll(".outline-node-title")).map((node) => node.textContent);
    expect(titles).toContain("A Paper"); // 根母节点
    expect(titles).toContain("论证主线");
    expect(titles).toContain("方法设计"); // 部分语义标题
    expect(titles).not.toContain("研究问题"); // 主线条目收起
    expect(titles).not.toContain("注意力机制设计"); // 要点收起
    expect(titles).not.toContain("注意力权重"); // 支撑点收起
    expect(container.querySelector(".outline-drawer-meta")!.textContent).toContain("已生成 1/3 部分");
    expect(container.querySelector(".outline-drawer-meta")!.textContent).toContain("段落覆盖 100%");
  });

  it("expands all and collapses back to the skeleton from the meta buttons", async () => {
    await render(<OutlineDrawer {...props()} />);
    expect(container.textContent).not.toContain("注意力权重");
    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>(".outline-drawer-fold button"))
      .find((button) => button.textContent === "展开全部")!.click());
    const titles = Array.from(container.querySelectorAll(".outline-node-title")).map((node) => node.textContent);
    expect(titles).toContain("研究问题");
    expect(titles).toContain("注意力机制设计");
    expect(titles).toContain("注意力权重");
    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>(".outline-drawer-fold button"))
      .find((button) => button.textContent === "收起全部")!.click());
    expect(container.textContent).not.toContain("注意力权重");
    expect(container.textContent).not.toContain("研究问题");
  });

  it("shows generation progress and disables regenerate while running", async () => {
    await render(<OutlineDrawer {...props({ progress: { done: 2, total: 9 } })} />);
    expect(container.querySelector(".outline-drawer-meta")!.textContent).toContain("正在提炼 2/9");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="重新生成文章架构"]')!.disabled).toBe(true);
    expect(container.textContent).toContain("要点生成中…"); // 未完成部分在树里显示生成中
  });

  it("reports the clicked point node with its anchor", async () => {
    const onSelect = vi.fn();
    await render(<OutlineDrawer {...props({ onSelect })} />);
    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>(".outline-drawer-fold button"))
      .find((button) => button.textContent === "展开全部")!.click());
    await click(nodeByTitle("注意力权重"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const selected = onSelect.mock.calls[0][0] as OutlineNode;
    expect(selected.id).toBe(`${methodPart.id}:i1:p1`);
    expect(selected.anchors[0].blockId).toBe("p002-b002");
  });

  it("expands and re-collapses the thread branch from its toggle", async () => {
    await render(<OutlineDrawer {...props()} />);
    expect(container.textContent).not.toContain("研究问题");
    await click(nodeByTitle("论证主线").querySelector(".outline-node-toggle")!);
    expect(container.textContent).toContain("研究问题");
    await click(nodeByTitle("论证主线").querySelector(".outline-node-toggle")!);
    expect(container.textContent).not.toContain("研究问题");
  });

  it("retries a failed part from its node", async () => {
    const failedMap = projectOutlineMap({
      paperTitle: "A Paper",
      parts,
      renames: {},
      thread: threadEntries,
      partTrees: {},
      partStates: { [methodPart.id]: { state: "error", error: "服务超时" } },
      coverage: { covered: 0, total: 0 },
      droppedAnchors: 0,
      mergedDuplicates: 0,
    });
    const onRetrySection = vi.fn();
    await render(<OutlineDrawer {...props({ map: failedMap, onRetrySection })} />);
    const failed = container.querySelector<SVGGElement>(".outline-node.is-error")!;
    expect(failed.querySelector(".outline-node-kind")!.textContent).toContain("生成失败");
    await click(failed);
    expect(onRetrySection).toHaveBeenCalledTimes(1);
    expect((onRetrySection.mock.calls[0][0] as OutlineNode).id).toBe(methodPart.id);
  });

  it("shows a loading state while parts build and a retryable error", async () => {
    await render(<OutlineDrawer {...props({ map: null, status: "loading" })} />);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("正在提取文章架构");
    const onRegenerate = vi.fn();
    await render(<OutlineDrawer {...props({ map: null, status: "error", error: "当前论文还没有可分析的正文块", onRegenerate })} />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("正文块");
    await act(async () => container.querySelector<HTMLButtonElement>(".outline-error .text-button")!.click());
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("keeps the map usable when only the assembly failed", async () => {
    await render(<OutlineDrawer {...props({ error: "论证主线生成失败，请重试" })} />);
    expect(container.querySelectorAll(".outline-node").length).toBeGreaterThan(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("论证主线");
  });
});
