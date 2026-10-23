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
    canJump: (paperId: string) => paperId === "p1",
    onJump: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.clearAllMocks();
});

describe("library wiki view", () => {
  it("lists pages sorted by paper count and shows cross-paper detail", async () => {
    await render(<LibraryWikiView {...props()} />);
    expect(container.querySelectorAll(".library-wiki-item")).toHaveLength(2);
    expect(container.querySelector(".library-wiki-detail")!.textContent).toContain("注意力机制");
    expect(container.querySelector(".library-wiki-detail")!.textContent).toContain("出现于 1 篇论文");
    expect(container.querySelector(".library-wiki-header-meta")!.textContent).toContain("2 个页面");
  });

  it("jumps to the source block from a citation when the paper is available", async () => {
    const onJump = vi.fn();
    await render(<LibraryWikiView {...props({ onJump, canJump: () => true })} />);
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>(".library-wiki-item"));
    await act(async () => items.find((item) => item.textContent!.includes("检索增强生成"))!.click());
    const citation = container.querySelector<HTMLButtonElement>(".library-wiki-citation")!;
    expect(citation.textContent).toContain("第 7 页");
    await act(async () => citation.click());
    expect(onJump).toHaveBeenCalledWith("p2", "b2");
  });

  it("marks citations of removed papers as unavailable", async () => {
    await render(<LibraryWikiView {...props()} />);
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>(".library-wiki-item"));
    await act(async () => items.find((item) => item.textContent!.includes("检索增强生成"))!.click());
    const occurrence = container.querySelector(".library-wiki-occurrence.is-unavailable");
    expect(occurrence).toBeTruthy();
    expect(container.querySelector(".library-wiki-citation.is-disabled")!.textContent).toContain("第 7 页");
  });

  it("navigates between pages via backlinks", async () => {
    await render(<LibraryWikiView {...props()} />);
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>(".library-wiki-item"));
    await act(async () => items.find((item) => item.textContent!.includes("注意力机制"))!.click());
    const backlinkBox = Array.from(container.querySelectorAll(".library-wiki-linkbox"))
      .find((box) => box.textContent!.includes("反向链接"));
    expect(backlinkBox).toBeTruthy();
    await act(async () => backlinkBox!.querySelector<HTMLButtonElement>("button")!.click());
    expect(container.querySelector(".library-wiki-detail h2")!.textContent).toBe("检索增强生成");
  });

  it("searches pages and toggles the graph view", async () => {
    await render(<LibraryWikiView {...props()} />);
    const input = container.querySelector<HTMLInputElement>(".library-wiki-search input")!;
    const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setInputValue.call(input, "检索");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelectorAll(".library-wiki-item")).toHaveLength(1);
    const graphToggle = container.querySelector<HTMLButtonElement>('[aria-pressed]')!;
    await act(async () => graphToggle.click());
    expect(container.querySelector(".wiki-graph")).toBeTruthy();
  });

  it("shows an onboarding hint for an empty wiki", async () => {
    await render(<LibraryWikiView {...props({ pages: [] })} />);
    expect(container.querySelector(".library-wiki-empty")!.textContent).toContain("自动汇入");
  });
});
