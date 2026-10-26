import { act, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeckView } from "../../src/features/reader/DeckView";
import type { DocumentBlock } from "../../src/domain/documentBlocks";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement;

const blocks: DocumentBlock[] = [
  { id: "s1-t", pageNumber: 1, order: 0, kind: "heading", text: "研究背景", bbox: [0.05, 0.05, 0.9, 0.2] },
  { id: "s1-p", pageNumber: 1, order: 1, kind: "paragraph", text: "这是第一页的段落。", bbox: [0.05, 0.3, 0.9, 0.45] },
  { id: "s2-img", pageNumber: 2, order: 2, kind: "image", text: "架构图", caption: "架构图", assetPath: "images/fig1.jpg" },
  { id: "s2-p", pageNumber: 2, order: 3, kind: "paragraph", text: "第二页说明。" },
];

async function render(element: ReactElement) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
}

function props(overrides: Partial<ComponentProps<typeof DeckView>> = {}) {
  return {
    paper: { id: "p1", title: "Deck", authors: [], year: null, sourcePath: "", importedAt: "", groupId: "g", favorite: false, blocks: blocks.length, blockData: blocks },
    selectedBlockId: null,
    readingPage: 1,
    onSelect: vi.fn(),
    onAnalyzeParagraph: vi.fn(),
    onPosition: vi.fn(),
    loadImage: vi.fn(async () => "data:image/png;base64,aGk="),
    ...overrides,
  } as ComponentProps<typeof DeckView>;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.clearAllMocks();
});

describe("deck view", () => {
  it("groups blocks into slides by page number", async () => {
    await render(<DeckView {...props()} />);
    expect(container.querySelectorAll(".deck-slide")).toHaveLength(2);
    expect(container.querySelector('.deck-slide[aria-label="第 1 页"]')!.textContent).toContain("研究背景");
    expect(container.querySelector(".deck-slide-head")!.textContent).toContain("/ 2");
  });

  it("selects on click and analyzes on double click", async () => {
    const onSelect = vi.fn();
    const onAnalyzeParagraph = vi.fn();
    await render(<DeckView {...props({ onSelect, onAnalyzeParagraph })} />);
    const paragraph = container.querySelector(".deck-paragraph")!;
    await act(async () => paragraph.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSelect).toHaveBeenCalledTimes(1);
    await act(async () => paragraph.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onAnalyzeParagraph).toHaveBeenCalledWith(expect.objectContaining({ id: "s1-p" }));
  });

  it("loads image blocks through the provided loader", async () => {
    const loadImage = vi.fn(async () => "data:image/png;base64,aGk=");
    await render(<DeckView {...props({ loadImage })} />);
    await act(async () => { await Promise.resolve(); });
    expect(loadImage).toHaveBeenCalledWith(expect.objectContaining({ id: "s2-img" }));
    expect(container.querySelector<HTMLImageElement>(".deck-figure img")?.src).toContain("aGk=");
  });

  it("marquee-drags to select multiple blocks and joins their text", async () => {
    const onSelectText = vi.fn();
    const onSelect = vi.fn();
    await render(<DeckView {...props({ onSelectText, onSelect })} />);
    const canvas = container.querySelector(".deck-canvas")!;
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 1000, bottom: 562, width: 1000, height: 562 }),
    });
    // 拖过第 1 页大部分区域：两块 bbox 相交，全部选中并合并文本
    await act(async () => canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 5, clientY: 5 })));
    await act(async () => window.dispatchEvent(new MouseEvent("mousemove", { clientX: 900, clientY: 400 })));
    expect(container.querySelector(".deck-marquee")).toBeTruthy();
    await act(async () => window.dispatchEvent(new MouseEvent("mouseup", { clientX: 900, clientY: 400 })));
    expect(container.querySelector(".deck-marquee")).toBeNull();
    expect(container.querySelectorAll(".deck-block.is-selected")).toHaveLength(2);
    expect(onSelectText).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1-t" }),
      "研究背景\n\n这是第一页的段落。",
    );
    expect(onSelect).not.toHaveBeenCalled(); // 框选结束不误触发单选
  });

  it("reports the visited slide page for reading position", async () => {
    const onPosition = vi.fn();
    await render(<DeckView {...props({ onPosition })} />);
    await act(async () => container.querySelector('.deck-slide[aria-label="第 2 页"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onPosition).toHaveBeenCalledWith(2);
  });
});
