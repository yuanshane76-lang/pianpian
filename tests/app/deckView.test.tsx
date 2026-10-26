import { act, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeckView } from "../../src/features/reader/DeckView";
import type { DocumentBlock } from "../../src/domain/documentBlocks";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement;

const blocks: DocumentBlock[] = [
  { id: "s1-t", pageNumber: 1, order: 0, kind: "heading", text: "研究背景" },
  { id: "s1-p", pageNumber: 1, order: 1, kind: "paragraph", text: "这是第一页的段落。" },
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

  it("reports the visited slide page for reading position", async () => {
    const onPosition = vi.fn();
    await render(<DeckView {...props({ onPosition })} />);
    await act(async () => container.querySelector('.deck-slide[aria-label="第 2 页"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onPosition).toHaveBeenCalledWith(2);
  });
});
