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
  id: "real-paragraph", kind: "paragraph", text: "PDF paragraph.", pageNumber: 1, order: 0, bbox: [0.169, 0.126, 0.825, 0.156],
};
const nextParagraph = { ...paragraph, id: "next-paragraph", pageNumber: 2 };
const mounted: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of mounted.splice(0)) await cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function mount(blocks: DocumentBlock[], options: Partial<Parameters<typeof PdfPreview>[0]> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSelect = vi.fn();
  const render = (props: Partial<Parameters<typeof PdfPreview>[0]>) => root.render(
    <PdfPreview paperId="paper" originalId="original" page={1} blocks={blocks} activeBlockId={null}
      onPage={vi.fn()} onReimport={vi.fn()} onSelect={onSelect} onSelectText={vi.fn()} {...options} {...props} />,
  );
  await act(async () => render({}));
  mounted.push(async () => { await act(async () => root.unmount()); container.remove(); });
  return { container, onSelect, rerender: async (props: Partial<Parameters<typeof PdfPreview>[0]>) => { await act(async () => render(props)); } };
}

describe("continuous PDF page geometry", () => {
  it("renders two column regions with unique DOM ids that analyze one complete paragraph", async () => {
    const merged: DocumentBlock = { ...paragraph, text: "Starts in the left column. Continues in the right column.",
      bbox: [.1, .8, .45, .9], pageBounds: [
        { pageNumber: 1, bbox: [.1, .8, .45, .9] },
        { pageNumber: 1, bbox: [.55, .1, .9, .4] },
      ] };
    const onAnalyzeParagraph = vi.fn();
    const { container, onSelect, rerender } = await mount([merged], { onAnalyzeParagraph });
    const regions = [...container.querySelectorAll<HTMLButtonElement>(".pdf-block-hit-area")];
    expect(regions).toHaveLength(2);
    expect(new Set(regions.map((region) => region.id)).size).toBe(2);
    await act(async () => regions[1].click());
    expect(onSelect).toHaveBeenCalledWith(merged, 1, regions[1].id.slice("pdf-block-".length));
    await act(async () => regions[1].dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onAnalyzeParagraph).toHaveBeenCalledWith(merged, 1, regions[1].id.slice("pdf-block-".length));
    await rerender({ focusTarget: { id: merged.id, requestId: 1, pageNumber: 1,
      regionId: regions[1].id.slice("pdf-block-".length) } });
    expect(scrollIntoView.mock.instances.at(-1)).toBe(regions[1]);
  });
  it.each(["image", "table"] as const)("double-clicks a %s through the chart analysis callback", async (kind) => {
    const block: DocumentBlock = { ...paragraph, id: kind, kind };
    const onAnalyzeChart = vi.fn();
    const onAnalyzeParagraph = vi.fn();
    const { container } = await mount([block], { onAnalyzeChart, onAnalyzeParagraph });
    await act(async () => container.querySelector(".pdf-block-hit-area")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onAnalyzeChart).toHaveBeenCalledWith(block);
    expect(onAnalyzeParagraph).not.toHaveBeenCalled();
  });
  it("selects and analyzes the canonical complete paragraph from its continuation page", async () => {
    const merged = { ...paragraph, text: "First page starts the paragraph. The next page continues it.", pageBounds: [
      { pageNumber: 1, bbox: paragraph.bbox! },
      { pageNumber: 2, bbox: [.169, .2, .825, .4] as [number, number, number, number] },
    ] };
    const onAnalyzeParagraph = vi.fn();
    const { container, onSelect } = await mount([merged], { onAnalyzeParagraph });
    const target = container.querySelector<HTMLButtonElement>('.pdf-page-stage[data-page-number="2"] .pdf-block-hit-area');
    expect(target).not.toBeNull();
    expect(new Set([...container.querySelectorAll(".pdf-block-hit-area")].map((element) => element.id)).size).toBe(2);
    await act(async () => target!.click());
    expect(onSelect).toHaveBeenCalledWith(merged, 2);
    await act(async () => target!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onAnalyzeParagraph).toHaveBeenCalledWith(merged, 2);
  });
  it("restores a saved continuation position on its actual page", async () => {
    const merged = { ...paragraph, pageBounds: [
      { pageNumber: 1, bbox: paragraph.bbox! },
      { pageNumber: 2, bbox: [.169, .2, .825, .4] as [number, number, number, number] },
    ] };
    const { container } = await mount([merged], { page: 2, focusTarget: { id: merged.id, requestId: 1, pageNumber: 2 } });
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect((scrollIntoView.mock.instances[0] as HTMLElement).closest(".pdf-page-stage")?.getAttribute("data-page-number")).toBe("2");
  });
  it("keeps both adjacent page canvases and overlays mounted in the same scrolling stack", async () => {
    const { container } = await mount([paragraph, nextParagraph]);
    expect(container.querySelectorAll(".pdf-page-slot")).toHaveLength(2);
    expect(container.querySelectorAll(".pdf-page-stage canvas")).toHaveLength(2);
    expect(container.querySelectorAll(".pdf-text-layer")).toHaveLength(2);
    expect(container.querySelectorAll(".pdf-block-hit-area")).toHaveLength(2);
  });

  it("does not intercept native wheel or touch scrolling at page boundaries", async () => {
    const onPage = vi.fn();
    const { container } = await mount([paragraph], { onPage });
    const scroll = container.querySelector<HTMLElement>(".pdf-canvas-scroll")!;
    Object.defineProperties(scroll, { clientHeight: { value: 400 }, scrollHeight: { value: 1800 } });
    scroll.scrollTop = 880;
    const wheel = new WheelEvent("wheel", { deltaY: 160, bubbles: true, cancelable: true });
    await act(async () => {
      scroll.dispatchEvent(wheel);
      const start = new Event("touchstart", { bubbles: true });
      Object.defineProperty(start, "touches", { value: [{ clientX: 100, clientY: 300 }] });
      scroll.dispatchEvent(start);
      const end = new Event("touchend", { bubbles: true });
      Object.defineProperty(end, "changedTouches", { value: [{ clientX: 100, clientY: 100 }] });
      scroll.dispatchEvent(end);
    });
    expect(wheel.defaultPrevented).toBe(false);
    expect(onPage).not.toHaveBeenCalled();
    expect(scroll.scrollTop).toBe(880);
  });

  it("syncs the predominant visible page without resetting scroll when the parent accepts it", async () => {
    const onVisiblePage = vi.fn();
    const onPage = vi.fn();
    const { container, rerender } = await mount([paragraph, nextParagraph], { onVisiblePage, onPage });
    const scroll = container.querySelector<HTMLElement>(".pdf-canvas-scroll")!;
    Object.defineProperty(scroll, "clientHeight", { value: 500 });
    scroll.scrollTop = 980;
    await act(async () => scroll.dispatchEvent(new Event("scroll")));
    await vi.waitFor(() => expect(onVisiblePage).toHaveBeenCalledWith(2));
    await rerender({ page: 2 });
    expect(scroll.scrollTop).toBe(980);
    expect(onPage).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".pdf-page-stage canvas")).toHaveLength(2);
  });

  it("navigates to a page slot while preserving adjacent page content", async () => {
    const { container, rerender } = await mount([paragraph, nextParagraph]);
    const scroll = container.querySelector<HTMLElement>(".pdf-canvas-scroll")!;
    await rerender({ page: 2, navigationTarget: { page: 2, requestId: 1 } });
    expect(scroll.scrollTop).toBeGreaterThan(880);
    expect(container.querySelectorAll(".pdf-page-stage canvas")).toHaveLength(2);
    await rerender({ page: 2, navigationTarget: { page: 2, requestId: 2 } });
    expect(scroll.scrollTop).toBeGreaterThan(880);
  });

  it("uses each page's dimensions for its canvas and overlay at every zoom", async () => {
    const { container } = await mount([paragraph, nextParagraph]);
    for (const stage of container.querySelectorAll<HTMLElement>(".pdf-page-stage")) {
      const canvas = stage.querySelector("canvas")!;
      expect(stage.style.width).toBe(canvas.style.width);
      expect(stage.style.height).toBe(canvas.style.height);
      expect(stage.style.width).toBe("660px");
    }
    await act(async () => (container.querySelector('[aria-label="缩小 PDF"]') as HTMLButtonElement).click());
    for (const stage of container.querySelectorAll<HTMLElement>(".pdf-page-stage")) {
      expect(stage.style.width).toBe(stage.querySelector("canvas")!.style.width);
      const target = stage.querySelector<HTMLElement>(".pdf-block-hit-area")!;
      expect(parseFloat(target.style.left)).toBeCloseTo(16.9);
      expect(target.textContent).not.toContain(paragraph.text);
    }
  });

  it("resolves a paragraph against the page clicked rather than the toolbar's current page", async () => {
    const { container, onSelect } = await mount([paragraph, nextParagraph]);
    await act(async () => container.querySelector<HTMLElement>(`[id="pdf-block-${nextParagraph.id}"]`)!.click());
    expect(onSelect).toHaveBeenCalledWith(nextParagraph);
    expect(container.querySelector(`[id="pdf-block-${paragraph.id}"]`)).not.toBeNull();
  });

  it("never invents hit regions for blocks with missing or invalid coordinates", async () => {
    const { container } = await mount([paragraph, nextParagraph,
      { ...paragraph, id: "missing", bbox: undefined }, { ...paragraph, id: "invalid", bbox: [0, 0, 9, .1] }]);
    expect(container.querySelectorAll(".pdf-block-hit-area")).toHaveLength(2);
  });

  it("scrolls to an outline target only once after its own page is ready", async () => {
    const { container, rerender } = await mount([paragraph, nextParagraph]);
    await rerender({ page: 2, focusTarget: { id: nextParagraph.id, requestId: 1 } });
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.instances[0]).toBe(container.querySelector(`[id="pdf-block-${nextParagraph.id}"]`));
    await act(async () => (container.querySelector('[aria-label="放大 PDF"]') as HTMLButtonElement).click());
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it("loads and centers a remote outline target after its deferred canvas completes", async () => {
    let finish!: () => void;
    const far = { ...paragraph, id: "far-outline", pageNumber: 20 };
    vi.mocked(openPdf).mockResolvedValueOnce({
      numPages: 30, getPage: async (number: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
        render: () => ({ promise: number === 20 ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve(), cancel: vi.fn() }),
      }), destroy: async () => {},
    } as never);
    const { container, rerender } = await mount([paragraph, far]);
    await rerender({ page: 20, focusTarget: { id: far.id, requestId: 1 } });
    expect(container.querySelector('.pdf-page-slot[data-page-number="20"] canvas')).not.toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.instances[0]).toBe(container.querySelector(`[id="pdf-block-${far.id}"]`));
  });

  it("persists a visible block from its own page instead of an offscreen earlier page", async () => {
    const onVisibleBlock = vi.fn();
    const { container } = await mount([paragraph, nextParagraph], { onVisibleBlock });
    const scroll = container.querySelector<HTMLElement>(".pdf-canvas-scroll")!;
    Object.defineProperty(scroll, "clientHeight", { value: 500 });
    scroll.scrollTop = 980;
    vi.spyOn(scroll, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 500 } as DOMRect);
    const target = container.querySelector<HTMLElement>(`[id="pdf-block-${nextParagraph.id}"]`)!;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 60, bottom: 110 } as DOMRect);
    await act(async () => scroll.dispatchEvent(new Event("scroll")));
    await vi.waitFor(() => expect(onVisibleBlock).toHaveBeenCalledWith(nextParagraph));
  });
  it("saves the latest visible block when search filtering changes during a pending scroll update", async () => {
    vi.useFakeTimers();
    try {
      const added: DocumentBlock = { ...paragraph, id: "revealed-after-search", bbox: [.1, .5, .9, .6] };
      const onVisibleBlock = vi.fn();
      const { container, rerender } = await mount([paragraph], { onVisibleBlock });
      const scroll = container.querySelector<HTMLElement>(".pdf-canvas-scroll")!;
      Object.defineProperty(scroll, "clientHeight", { value: 200 });
      scroll.scrollTop = 400;
      await act(async () => scroll.dispatchEvent(new Event("scroll")));
      await rerender({ blocks: [paragraph, added] });
      await act(async () => vi.advanceTimersByTime(250));
      expect(onVisibleBlock).toHaveBeenCalledWith(added);
    } finally { vi.useRealTimers(); }
  });

  it("keeps page slots for a long document but rasterizes only the viewport neighborhood", async () => {
    const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
    vi.mocked(openPdf).mockResolvedValueOnce({
      numPages: 30, getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render,
      }), destroy: async () => {},
    } as never);
    const { container, rerender } = await mount([paragraph]);
    expect(container.querySelectorAll(".pdf-page-slot")).toHaveLength(30);
    expect(container.querySelectorAll("canvas").length).toBeLessThanOrEqual(5);
    await rerender({ page: 20, navigationTarget: { page: 20, requestId: 1 } });
    expect(container.querySelector('.pdf-page-slot[data-page-number="20"] canvas')).not.toBeNull();
    expect(container.querySelector('.pdf-page-slot[data-page-number="1"] canvas')).toBeNull();
    expect(container.querySelectorAll(".pdf-page-slot")).toHaveLength(30);
  });

  it("does not load every PDF page while preparing a long canvas", async () => {
    const getPage = vi.fn(async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    }));
    vi.mocked(openPdf).mockResolvedValueOnce({
      numPages: 30, getPage, destroy: async () => {},
    } as never);
    const { container } = await mount([paragraph]);
    expect(container.querySelectorAll(".pdf-page-slot")).toHaveLength(30);
    expect(getPage.mock.calls.length).toBeLessThan(8);
  });

  it("bounds pending page loads across rapid jumps and prioritizes the latest target", async () => {
    const pending = new Map<number, (page: unknown) => void>();
    const pdfPage = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    };
    const getPage = vi.fn((number: number) => number === 1 ? Promise.resolve(pdfPage)
      : new Promise((resolve) => pending.set(number, resolve)));
    vi.mocked(openPdf).mockResolvedValueOnce({ numPages: 300, getPage, destroy: async () => {} } as never);
    const { rerender } = await mount([paragraph]);
    for (let number = 10; number <= 100; number += 10) {
      await rerender({ page: number, navigationTarget: { page: number, requestId: number } });
    }
    expect(pending.size).toBeLessThanOrEqual(3);
    const first = pending.entries().next().value!;
    pending.delete(first[0]);
    await act(async () => first[1](pdfPage));
    expect(getPage.mock.calls.at(-1)?.[0]).toBe(100);
    expect(pending.size).toBeLessThanOrEqual(3);
    expect(getPage.mock.calls.filter(([number]) => number === 100)).toHaveLength(1);
  });

  it("finishes an outline jump when earlier neighboring pages correct their estimated sizes", async () => {
    const pending = new Map<number, (page: unknown) => void>();
    const makePage = (height: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: height * scale }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800);
    const getPage = vi.fn((number: number) => number === 1 ? Promise.resolve(makePage(100))
      : new Promise((resolve) => pending.set(number, resolve)));
    vi.mocked(openPdf).mockResolvedValueOnce({ numPages: 30, getPage, destroy: async () => {} } as never);
    const far = { ...paragraph, id: "mixed-size-outline", pageNumber: 20 };
    const { container, rerender } = await mount([paragraph, far]);
    for (let pass = 0; pass < 10 && pending.size; pass += 1) {
      const batch = [...pending.entries()];
      pending.clear();
      await act(async () => batch.forEach(([, finish]) => finish(makePage(800))));
    }
    await rerender({ page: 20, focusTarget: { id: far.id, requestId: 1 } });
    for (let pass = 0; pass < 10; pass += 1) {
      const neighbors = [...pending.entries()].filter(([number]) => number < 20);
      if (!neighbors.length) break;
      neighbors.forEach(([number]) => pending.delete(number));
      await act(async () => neighbors.forEach(([, finish]) => finish(makePage(800))));
    }
    expect(pending.has(20)).toBe(true);
    await act(async () => pending.get(20)!(makePage(800)));
    expect(container.querySelector('.pdf-page-stage[data-page-number="20"][data-rendered="true"]')).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.instances[0]).toBe(container.querySelector(`[id="pdf-block-${far.id}"]`));
  });

  it("preserves the page-relative reading anchor when zoom changes", async () => {
    const { container } = await mount([paragraph, nextParagraph]);
    const scroll = container.querySelector<HTMLElement>(".pdf-canvas-scroll")!;
    Object.defineProperty(scroll, "clientHeight", { value: 500 });
    scroll.scrollTop = 1124;
    await act(async () => scroll.dispatchEvent(new Event("scroll")));
    await act(async () => (container.querySelector('[aria-label="缩小 PDF"]') as HTMLButtonElement).click());
    expect(scroll.scrollTop).toBeGreaterThan(850);
    expect(scroll.scrollTop).toBeLessThan(1000);
  });

  it("preserves a page seam when zoom changes instead of jumping to the end of the document", async () => {
    vi.mocked(openPdf).mockResolvedValueOnce({
      numPages: 10, getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
        render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      }), destroy: async () => {},
    } as never);
    const { container } = await mount([paragraph]);
    const scroll = container.querySelector<HTMLElement>(".pdf-canvas-scroll")!;
    Object.defineProperty(scroll, "clientHeight", { value: 500 });
    scroll.scrollTop = 912; // 20px padding + 880px page + 12px into the gap.
    await act(async () => scroll.dispatchEvent(new Event("scroll")));
    await act(async () => (container.querySelector('[aria-label="缩小 PDF"]') as HTMLButtonElement).click());
    expect(scroll.scrollTop).toBeCloseTo(752);
  });

  it("saves the block location while its virtualized page canvas is still rendering", async () => {
    let finish!: () => void;
    const far = { ...paragraph, id: "far", pageNumber: 20, bbox: [.1, .1, .9, .2] as DocumentBlock["bbox"] };
    vi.mocked(openPdf).mockResolvedValueOnce({
      numPages: 30, getPage: async (number: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
        render: () => ({ promise: number === 20 ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve(), cancel: vi.fn() }),
      }), destroy: async () => {},
    } as never);
    const onVisibleBlock = vi.fn();
    const { container } = await mount([paragraph, far], { onVisibleBlock });
    const scroll = container.querySelector<HTMLElement>(".pdf-canvas-scroll")!;
    Object.defineProperty(scroll, "clientHeight", { value: 500 });
    scroll.scrollTop = 20 + 19 * 904;
    await act(async () => scroll.dispatchEvent(new Event("scroll")));
    expect(container.querySelector(`[id="pdf-block-${far.id}"]`)).toBeNull();
    await vi.waitFor(() => expect(onVisibleBlock).toHaveBeenCalledWith(far));
    await act(async () => finish());
  });

  it("ignores a previous document's delayed page load after replacing the original PDF", async () => {
    let finish!: (value: unknown) => void;
    const destroy = vi.fn(async () => {});
    vi.mocked(openPdf).mockResolvedValueOnce({
      numPages: 1, getPage: () => new Promise((resolve) => { finish = resolve; }), destroy,
    } as never);
    const { container, rerender } = await mount([paragraph]);
    await rerender({ originalId: "new-original" });
    expect(container.querySelectorAll(".pdf-page-slot")).toHaveLength(2);
    expect(destroy).toHaveBeenCalledOnce();
    await act(async () => finish({
      getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    }));
    expect(container.querySelectorAll(".pdf-page-slot")).toHaveLength(2);
    expect(container.querySelector<HTMLElement>(".pdf-page-slot")?.style.width).toBe("660px");
    expect(container.querySelector(".parse-warning")).toBeNull();
  });

  it("cleans a subsequent lazy page returned after replacing the document without restarting its queue", async () => {
    const pending = new Map<number, (page: unknown) => void>();
    const firstPage = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    };
    const getPage = vi.fn((number: number) => number === 1 ? Promise.resolve(firstPage)
      : new Promise((resolve) => pending.set(number, resolve)));
    vi.mocked(openPdf).mockResolvedValueOnce({ numPages: 30, getPage, destroy: async () => {} } as never);
    const { container, rerender } = await mount([paragraph]);
    expect(pending.has(2)).toBe(true);
    await rerender({ originalId: "replacement-original" });
    const before = getPage.mock.calls.length;
    const cleanup = vi.fn();
    await act(async () => pending.get(2)!({ ...firstPage, cleanup }));
    expect(cleanup).toHaveBeenCalledOnce();
    expect(getPage.mock.calls).toHaveLength(before);
    expect(container.querySelectorAll(".pdf-page-slot")).toHaveLength(2);
    expect(container.querySelector(".parse-warning")).toBeNull();
  });

  it("observes available width when an original is restored to a missing-file reader", async () => {
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
