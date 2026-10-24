import { act, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryWikiView } from "../../src/features/wiki/LibraryWikiView";
import { ingestPaperWikiPages, type LibraryWikiPage } from "../../src/domain/libraryWiki";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement;

const anchor = (blockId: string, pageNumber: number) => ({ blockId, pageNumber, quote: "原文" });

let pages: LibraryWikiPage[] = ingestPaperWikiPages([], {
  paperId: "p1", paperTitle: "Attention 论文", contentSignature: "s1",
  points: [{ kind: "concept", title: "注意力机制", statement: "本文提出注意力机制。", anchors: [anchor("b1", 3)] }],
}).pages;
pages = ingestPaperWikiPages(pages, {
  paperId: "p2", paperTitle: "RAG 论文", contentSignature: "s2",
  points: [{ kind: "method", title: "检索增强生成", statement: "结合注意力机制与检索。", anchors: [anchor("b2", 7)] }],
}).pages;

async function render(element: ReactElement) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
}

function props(overrides: Partial<ComponentProps<typeof LibraryWikiView>> = {}) {
  return {
    pages,
    progress: null,
    failures: null,
    onRetryFailed: vi.fn(),
    onExtractNew: vi.fn(),
    canJump: (paperId: string) => paperId === "p1",
    onJump: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
}

async function switchToList() {
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-pressed]')!.click());
}

function click(node: Element) {
  return act(async () => node.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function setNativeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.clearAllMocks();
});

describe("library wiki view", () => {
  it("opens on the star map with paper hubs and the selected star's detail card", async () => {
    await render(<LibraryWikiView {...props()} />);
    expect(container.querySelector(".wiki-graph")).toBeTruthy();
    expect(container.querySelectorAll(".wiki-star")).toHaveLength(4); // 2 知识星 + 2 论文枢纽
    expect(container.querySelectorAll(".wiki-star-paper")).toHaveLength(2);
    expect(container.querySelector(".wiki-starmap-detail")!.textContent).toContain("注意力机制");
    expect(container.querySelector(".wiki-starmap-hint")).toBeFalsy(); // 有选中详情时不再显示提示
  });

  it("toggles showing every star name from the toolbar", async () => {
    await render(<LibraryWikiView {...props()} />);
    const visibleLabels = () => Array.from(container.querySelectorAll<SVGTextElement>(".wiki-star-label"))
      .filter((label) => label.getAttribute("visibility") === "visible");
    const autoVisible = visibleLabels().length;
    expect(autoVisible).toBeGreaterThan(0);
    expect(autoVisible).toBeLessThan(4); // 自动模式不显示全部
    await act(async () => container.querySelector<HTMLButtonElement>(".wiki-starmap-label-toggle")!.click());
    expect(visibleLabels()).toHaveLength(4); // 全显模式：两颗知识星 + 两颗论文星
  });

  it("switches to the list view and shows cross-paper detail", async () => {
    await render(<LibraryWikiView {...props()} />);
    await switchToList();
    expect(container.querySelector(".wiki-graph")).toBeFalsy();
    expect(container.querySelectorAll(".library-wiki-item")).toHaveLength(2);
    expect(container.querySelector(".library-wiki-detail")!.textContent).toContain("注意力机制");
    expect(container.querySelector(".library-wiki-detail")!.textContent).toContain("出现于 1 篇论文");
    expect(container.querySelector(".library-wiki-header-meta")!.textContent).toContain("2 个页面");
  });

  it("searches from the star map and selects a hit", async () => {
    await render(<LibraryWikiView {...props()} />);
    const input = container.querySelector<HTMLInputElement>(".wiki-starmap-search input")!;
    await act(async () => setNativeInput(input, "检索"));
    const hit = container.querySelector<HTMLButtonElement>(".wiki-starmap-hits button")!;
    expect(hit.textContent).toContain("检索增强生成");
    await act(async () => hit.click());
    expect(container.querySelector(".wiki-starmap-detail")!.textContent).toContain("RAG 论文");
  });

  it("jumps to the source block from a citation when the paper is available", async () => {
    const onJump = vi.fn();
    await render(<LibraryWikiView {...props({ onJump, canJump: () => true })} />);
    const input = container.querySelector<HTMLInputElement>(".wiki-starmap-search input")!;
    await act(async () => setNativeInput(input, "检索"));
    await act(async () => container.querySelector<HTMLButtonElement>(".wiki-starmap-hits button")!.click());
    const citation = container.querySelector<HTMLButtonElement>(".library-wiki-citation")!;
    expect(citation.textContent).toContain("第 7 页");
    await act(async () => citation.click());
    expect(onJump).toHaveBeenCalledWith("p2", "b2");
  });

  it("marks citations of removed papers as unavailable", async () => {
    await render(<LibraryWikiView {...props()} />);
    const input = container.querySelector<HTMLInputElement>(".wiki-starmap-search input")!;
    await act(async () => setNativeInput(input, "检索"));
    await act(async () => container.querySelector<HTMLButtonElement>(".wiki-starmap-hits button")!.click());
    expect(container.querySelector(".library-wiki-occurrence.is-unavailable")).toBeTruthy();
    expect(container.querySelector(".library-wiki-citation.is-disabled")!.textContent).toContain("第 7 页");
  });

  it("navigates between pages via backlinks in the detail card", async () => {
    await render(<LibraryWikiView {...props()} />);
    expect(container.querySelector(".wiki-starmap-detail")!.textContent).toContain("注意力机制");
    const backlinkBox = Array.from(container.querySelectorAll(".library-wiki-linkbox"))
      .find((box) => box.textContent!.includes("反向链接"));
    expect(backlinkBox).toBeTruthy();
    await act(async () => backlinkBox!.querySelector<HTMLButtonElement>("button")!.click());
    expect(container.querySelector(".library-wiki-detail h2")!.textContent).toBe("检索增强生成");
  });

  it("offers display options: filters, sliders and layout reset", async () => {
    await render(<LibraryWikiView {...props()} />);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="星图显示选项"]')!.click());
    const panel = container.querySelector(".wiki-starmap-options")!;
    expect(panel.querySelector(".wiki-starmap-legend")!.textContent).toContain("概念星");
    expect(panel.querySelectorAll(".wiki-starmap-slider input")).toHaveLength(4);

    // 关闭方法星：方法知识星与其论文枢纽一起消失。
    const methodToggle = Array.from(panel.querySelectorAll<HTMLInputElement>(".wiki-starmap-option-row input"))
      .find((input) => input.parentElement!.textContent!.includes("方法星"))!;
    await act(async () => methodToggle.click());
    expect(container.querySelectorAll(".wiki-star")).toHaveLength(2); // 概念星 + 它的论文枢纽
    expect(panel.querySelector('[aria-label="重置布局"]')).toBeTruthy();
  });

  it("closes the detail card back to the starmap hint", async () => {
    await render(<LibraryWikiView {...props()} />);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭详情"]')!.click());
    expect(container.querySelector(".wiki-starmap-detail")).toBeFalsy();
    expect(container.querySelector(".wiki-starmap-hint")!.textContent).toContain("点击星星");
  });

  it("shows extraction progress and a retry affordance for failed papers", async () => {
    const onRetryFailed = vi.fn();
    await render(<LibraryWikiView {...props({ progress: { done: 2, total: 5 } })} />);
    expect(container.querySelector(".library-wiki-progress")!.textContent).toContain("正在提取 2/5");
    expect(container.querySelector<HTMLButtonElement>('[title*="补提取"]')!.disabled).toBe(true); // 提取中禁用
    await render(<LibraryWikiView {...props({ failures: { p2: "服务超时" }, onRetryFailed })} />);
    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>(".library-wiki-header-meta .text-button"))
      .find((button) => button.textContent!.includes("提取失败"))!;
    expect(retry.textContent).toContain("1 篇提取失败");
    await act(async () => retry.click());
    expect(onRetryFailed).toHaveBeenCalledTimes(1);
  });

  it("offers a manual extract button for newly added papers", async () => {
    const onExtractNew = vi.fn();
    await render(<LibraryWikiView {...props({ onExtractNew })} />);
    const extract = container.querySelector<HTMLButtonElement>('[title*="补提取"]')!;
    expect(extract.textContent).toContain("提取新论文");
    await act(async () => extract.click());
    expect(onExtractNew).toHaveBeenCalledTimes(1);
  });

  it("shows an onboarding hint for an empty wiki", async () => {
    await render(<LibraryWikiView {...props({ pages: [] })} />);
    await switchToList();
    expect(container.querySelector(".library-wiki-empty")!.textContent).toContain("逐篇提取");
  });
});
