import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockList } from "../../src/features/reader/BlockList";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let container: HTMLDivElement;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
});

describe("PDF paragraph actions", () => {
  it("places add-to-conversation beside the whole-paragraph analysis hint", () => {
    const block = {
      id: "paragraph-1",
      kind: "paragraph" as const,
      pageNumber: 1,
      order: 0,
      text: "The model uses attention.",
      bbox: [0.1, 0.1, 0.9, 0.25] as [number, number, number, number],
    };
    const onAddToConversation = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const props = {
      blocks: [block],
      activeBlockId: block.id,
      hoveredBlockId: block.id,
      onSelect: vi.fn(),
      onAnalyzeParagraph: vi.fn(),
      onAddToConversation,
    } as Parameters<typeof BlockList>[0] & {
      onAddToConversation: (selectedBlock: typeof block) => void;
    };

    act(() => root!.render(<BlockList {...props} />));

    const action = container.querySelector<HTMLButtonElement>(".pdf-block-citation-action");
    expect(action?.textContent).toContain("加入对话");
    expect(container.querySelector(".pdf-paragraph-hint")?.textContent).toContain("双击分析整段");
    expect(action?.parentElement?.classList.contains("pdf-block-actions")).toBe(true);

    act(() => action!.click());
    expect(onAddToConversation).toHaveBeenCalledWith(block);
  });
});
