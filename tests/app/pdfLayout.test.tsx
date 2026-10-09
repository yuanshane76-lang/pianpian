import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PdfPreview } from "../../src/features/reader/PdfPreview";
import type { DocumentBlock } from "../../src/domain/documentBlocks";
import { openPdf } from "../../src/services/document";

vi.mock("../../src/services/originalPdf", () => ({ readOriginalPdf: async () => new ArrayBuffer(8) }));
vi.mock("../../src/services/document", () => ({
  openPdf: vi.fn(async () => ({
    numPages: 2,
    getPage: async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    }),
    destroy: async () => {},
  })),
}));
vi.mock("../../src/services/pdfTextLayer", () => ({
  renderPdfTextLayer: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => ({}) });
const scrollIntoView = vi.fn();
HTMLElement.prototype.scrollIntoView = scrollIntoView;

const paragraph: DocumentBlock = {
  id: "real-paragraph", kind: "paragraph", text: "PDF paragraph.", pageNumber: 1, order: 0,
  bbox: [0.169, 0.126, 0.825, 0.156],
};
const mounted: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of mounted.splice(0)) await cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function mount(blocks: DocumentBlock[], options: Partial<Parameters<typeof PdfPreview>[0]> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSelect = vi.fn();
  const render = (props: Partial<Parameters<typeof PdfPreview>[0]>) => root.render(
    <PdfPreview paperId="paper" originalId="original" page={1} blocks={blocks} activeBlockId={null}
      translations={{}} onPage={vi.fn()} onReimport={vi.fn()} onSelect={onSelect} onSelectText={vi.fn()} {...options} {...props} />,
  );
  await act(async () => render({}));
  mounted.push(async () => { await act(async () => root.unmount()); container.remove(); });
  return { container, onSelect, rerender: async (props: Partial<Parameters<typeof PdfPreview>[0]>) => { await act(async () => render(props)); } };
}

describe("PDF page geometry", () => {
  it("provides a selectable PDF text layer inside the same coordinate frame", async () => {
    const { container } = await mount([paragraph]);
    const stage = container.querySelector(".pdf-page-stage")!;
    expect(stage.querySelector(".pdf-text-layer")).not.toBeNull();
    expect(stage.querySelector(".pdf-structure-overlay")).not.toBeNull();
  });
  it("uses exactly the rendered page dimensions for the overlay at every zoom", async () => {
    const { container } = await mount([paragraph]);
    const stage = container.querySelector<HTMLElement>(".pdf-page-stage")!;
    const canvas = container.querySelector("canvas")!;
    expect(stage.style.width).toBe(canvas.style.width);
    expect(stage.style.height).toBe(canvas.style.height);
    expect(stage.style.width).toBe("660px");
    await act(async () => (container.querySelector('[aria-label="缩小 PDF"]') as HTMLButtonElement).click());
    expect(stage.style.width).toBe(canvas.style.width);
    expect(stage.style.height).toBe(canvas.style.height);
    const target = container.querySelector<HTMLElement>(".pdf-block-hit-area")!;
    expect(parseFloat(target.style.left)).toBeCloseTo(16.9);
    expect(parseFloat(target.style.top)).toBeCloseTo(12.6);
    expect(target.textContent).not.toContain(paragraph.text);
  });

  it("never invents hit regions for blocks without a valid bounding box", async () => {
    const { container, onSelect } = await mount([
      paragraph,
      { ...paragraph, id: "missing", bbox: undefined },
      { ...paragraph, id: "invalid", bbox: [0, 0, 9, 0.1] },
      { ...paragraph, id: "other-page", pageNumber: 2 },
    ]);
    const targets = container.querySelectorAll<HTMLElement>(".pdf-block-hit-area");
    expect(targets).toHaveLength(1);
    await act(async () => targets[0].click());
    expect(onSelect).toHaveBeenCalledWith(paragraph);
    expect(container.querySelector(".is-flow-target")).toBeNull();
  });

  it("waits for the destination page before scrolling to an outline or vocabulary target", async () => {
    const nextPage = { ...paragraph, id: "page-two-paragraph", pageNumber: 2 };
    const { container, rerender } = await mount([paragraph, nextPage]);
    await rerender({ page: 2, focusTarget: { id: nextPage.id, requestId: 1 } });
    expect(container.querySelector(`[id="pdf-block-${nextPage.id}"]`)).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.instances[0]).toBe(container.querySelector(`[id="pdf-block-${nextPage.id}"]`));
    await act(async () => (container.querySelector('[aria-label="放大 PDF"]') as HTMLButtonElement).click());
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it("persists the visible block from the actual PDF scrolling surface", async () => {
    const onVisibleBlock = vi.fn();
    const { container } = await mount([paragraph], { onVisibleBlock });
    const target = container.querySelector<HTMLElement>(".pdf-block-hit-area")!;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 60, bottom: 110 } as DOMRect);
    const scroll = container.querySelector<HTMLElement>(".pdf-canvas-scroll")!;
    vi.spyOn(scroll, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    await vi.waitFor(() => expect(onVisibleBlock).toHaveBeenCalledWith(paragraph));
  });

  it("cannot select the next page's paragraph while the previous canvas is still visible", async () => {
    let finish!: (value: unknown) => void;
    const pdfPage = {
      getViewport: () => ({ width: 600, height: 800 }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    };
    vi.mocked(openPdf).mockResolvedValueOnce({
      numPages: 2,
      getPage: (number: number) => number === 1 ? Promise.resolve(pdfPage) : new Promise((resolve) => { finish = resolve; }),
      destroy: async () => {},
    } as never);
    const { container, onSelect, rerender } = await mount([paragraph, { ...paragraph, id: "next", pageNumber: 2 }]);
    await rerender({ page: 2 });
    expect(container.querySelector(".pdf-feedback")).not.toBeNull();
    const stage = container.querySelector<HTMLElement>(".pdf-page-stage")!;
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 600, height: 800 } as DOMRect);
    await act(async () => stage.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 200, clientY: 110 })));
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => finish(pdfPage));
  });

  it("starts observing width when an original PDF is restored to a missing-file reader", async () => {
    const observe = vi.fn();
    vi.stubGlobal("ResizeObserver", class { observe = observe; disconnect = vi.fn(); });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
    const { container, rerender } = await mount([paragraph], { originalId: undefined });
    expect(observe).not.toHaveBeenCalled();
    await rerender({ originalId: "restored-original" });
    expect(observe).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLElement>(".pdf-page-stage")?.style.width).toBe("860px");
  });
});
