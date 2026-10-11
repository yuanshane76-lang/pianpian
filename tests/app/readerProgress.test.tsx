import { act, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderView } from "../../src/features/reader/ReaderView";

vi.mock("../../src/features/reader/PdfPreview", () => ({ PdfPreview: () => <div>原始 PDF</div> }));
vi.mock("../../src/features/reader/ReaderAssistant", () => ({ ReaderAssistant: () => <aside>研究助手</aside> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;
const paragraph = {
  id: "paragraph", kind: "paragraph" as const, pageNumber: 1, order: 0,
  text: "Attention helps the model understand context.", bbox: [0.1, 0.1, 0.9, 0.2] as [number, number, number, number],
};
const headings = [
  { id: "heading-1", kind: "heading" as const, pageNumber: 1, order: 0, text: "1. 方法", headingLevel: 1 as const, bbox: [0.1, 0.1, 0.9, 0.14] as [number, number, number, number] },
  { id: "heading-2", kind: "heading" as const, pageNumber: 2, order: 1, text: "1.1 数据集", headingLevel: 2 as const, bbox: [0.1, 0.2, 0.9, 0.24] as [number, number, number, number] },
];
function props(): ComponentProps<typeof ReaderView> {
  return {
    paper: { id: "paper", title: "Paper", authors: [], year: null, sourcePath: "local://paper",
      originalId: "original", importedAt: "2026-10-09", tags: [], favorite: false,
      blocks: 1, blockData: [paragraph], parseStatus: "ready" },
    selectedBlock: null, selectionText: "", translation: null, answer: null,
    isBusy: false, chartReading: null, explanation: null, actionError: null, processingStatus: "",
    aiAvailable: true, serviceLabel: "模型", serviceModel: "model", mineruConfigured: true,
    pendingAction: null, streamingOutput: null, insight: null, guide: null, vocabulary: [],
    pipeline: { paperId: "paper", source: "mineru", stage: "ready" },
    onBack: vi.fn(), onSelectBlock: vi.fn(), onSelectText: vi.fn(), onAnalyzeParagraph: vi.fn(),
    onTranslate: vi.fn(), onReadChart: vi.fn(), onExplain: vi.fn(), onAsk: vi.fn(),
    onOpenSettings: vi.fn(), onEnhance: vi.fn(), onRetryBasic: vi.fn(), onReimport: vi.fn(),
    onPosition: vi.fn(), onInsight: vi.fn(), onGuide: vi.fn(),
  };
}
async function mount(p = props()) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ReaderView {...p} />));
  return p;
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reader progress feedback", () => {
  it("renders a hierarchical paper outline instead of a page-number index", async () => {
    const p = props();
    await mount({ ...p, paper: { ...p.paper, pageCount: 2, blocks: 3, blockData: [...headings, paragraph] } });

    expect(container.querySelector(".outline-pages")).toBeNull();
    expect(container.querySelector('[aria-label="论文目录"]')).not.toBeNull();
    expect(container.querySelectorAll(".outline-sections button")).toHaveLength(2);
    expect(container.querySelector(".outline-sections button")?.textContent).toContain("1. 方法");
    expect(container.querySelector(".outline-sections button")?.getAttribute("data-heading-level")).toBe("1");
    expect(container.querySelectorAll(".outline-sections button")[1]?.getAttribute("data-heading-level")).toBe("2");
    expect(container.textContent).not.toContain("第 1 页");

    await act(async () => (container.querySelectorAll(".outline-sections button")[1] as HTMLButtonElement).click());
    expect(p.onPosition).toHaveBeenCalledWith({ mode: "pdf", page: 2, blockId: "heading-2" });
  });

  it("shows a clear empty state when no headings are available", async () => {
    await mount();

    expect(container.querySelector(".outline-empty")?.textContent).toContain("尚未识别出论文标题");
    expect(container.querySelector(".outline-pages")).toBeNull();
  });

  it("supports pointer and keyboard resizing for both panel separators", async () => {
    await mount();

    const separators = container.querySelectorAll<HTMLElement>('[role="separator"]');
    expect(separators).toHaveLength(2);
    expect(separators[0].getAttribute("aria-valuenow")).toBe("175");
    expect(separators[1].getAttribute("aria-valuenow")).toBe("380");

    await act(async () => separators[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(separators[0].getAttribute("aria-valuenow")).toBe("191");
    await act(async () => separators[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(separators[1].getAttribute("aria-valuenow")).toBe("396");

    await act(async () => separators[0].dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100 })));
    await act(async () => window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 180 })));
    await act(async () => window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 180 })));
    expect(separators[0].getAttribute("aria-valuenow")).toBe("271");
    expect(document.body.classList.contains("is-reader-resizing")).toBe(false);

    await act(async () => separators[0].dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100 })));
    expect(document.body.classList.contains("is-reader-resizing")).toBe(true);
    await act(async () => window.dispatchEvent(new Event("pointercancel")));
    await act(async () => window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 300 })));
    expect(separators[0].getAttribute("aria-valuenow")).toBe("271");
    expect(document.body.classList.contains("is-reader-resizing")).toBe(false);
  });

  it("removes only the adjacent separator when a panel is collapsed", async () => {
    await mount();

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="收起目录"]')!.click());
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(container.querySelector(".reader-outline")).toBeNull();
  });

  it("fits resized panels after the window shrinks and restores their widths when space returns", async () => {
    vi.stubGlobal("innerWidth", 1440);
    await mount();
    const separators = container.querySelectorAll<HTMLElement>('[role="separator"]');
    await act(async () => separators[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    await act(async () => separators[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(separators[0].getAttribute("aria-valuenow")).toBe("360");
    expect(separators[1].getAttribute("aria-valuenow")).toBe("560");

    vi.stubGlobal("innerWidth", 841);
    await act(async () => window.dispatchEvent(new Event("resize")));
    const left = Number(separators[0].getAttribute("aria-valuenow"));
    const right = Number(separators[1].getAttribute("aria-valuenow"));
    expect(left).toBeGreaterThanOrEqual(140);
    expect(right).toBeGreaterThanOrEqual(280);
    expect(left + right).toBeLessThanOrEqual(841 - 320);

    vi.stubGlobal("innerWidth", 1440);
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(separators[0].getAttribute("aria-valuenow")).toBe("360");
    expect(separators[1].getAttribute("aria-valuenow")).toBe("560");
  });

  it("fits panels when reopening the outline after expanding the assistant", async () => {
    vi.stubGlobal("innerWidth", 841);
    await mount();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="收起目录"]')!.click());
    await act(async () => container.querySelector<HTMLElement>('[role="separator"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="展开目录"]')!.click());
    const separators = container.querySelectorAll<HTMLElement>('[role="separator"]');
    expect(Number(separators[0].getAttribute("aria-valuenow")) + Number(separators[1].getAttribute("aria-valuenow"))).toBeLessThanOrEqual(521);
  });

  it("auto-dismisses in the desktop development StrictMode lifecycle", async () => {
    vi.useFakeTimers();
    const p = await mount();
    await act(async () => root.render(<StrictMode><ReaderView {...p} /></StrictMode>));
    expect(container.querySelector(".reader-ready-toast")).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(4100));
    expect(container.querySelector(".reader-ready-toast")).toBeNull();
  });

  it("shows positioned paragraphs as a dismissible toast and removes the permanent second row", async () => {
    vi.useFakeTimers();
    const p = await mount();
    expect(container.querySelector(".reader-processing")).toBeNull();
    expect(container.querySelector(".reader-ready-toast")?.textContent).toContain("段落定位已就绪");
    await act(async () => vi.advanceTimersByTime(4100));
    expect(container.querySelector(".reader-ready-toast")).toBeNull();
    await act(async () => root.render(<ReaderView {...p} translation="注意力" />));
    expect(container.querySelector(".reader-ready-toast")).toBeNull();
  });

  it("announces readiness once when coordinates arrive and resets for a new paper", async () => {
    vi.useFakeTimers();
    const p = props();
    const noLayout = { ...p.paper, blockData: [{ ...paragraph, bbox: undefined }] };
    await mount({ ...p, paper: noLayout });
    expect(container.querySelector(".reader-ready-toast")).toBeNull();
    await act(async () => root.render(<ReaderView {...p} />));
    expect(container.querySelector(".reader-ready-toast")).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(4100));
    await act(async () => root.render(<ReaderView {...p} paper={{ ...p.paper, id: "other-paper" }} />));
    expect(container.querySelector(".reader-ready-toast")).not.toBeNull();
  });

  it("lets the user close the toast without stealing focus or blocking the PDF", async () => {
    vi.useFakeTimers();
    await mount();
    const close = container.querySelector<HTMLButtonElement>('[aria-label="关闭定位提示"]')!;
    expect(close).not.toBeNull();
    expect(container.querySelector('[aria-modal="true"]')).toBeNull();
    await act(async () => close.click());
    expect(container.querySelector(".reader-ready-toast")).toBeNull();
  });

  it("keeps the MinerU configuration action in the status bar when no layout is available", async () => {
    const p = props();
    await mount({ ...p, mineruConfigured: false, paper: { ...p.paper, blockData: [] } });
    const button = container.querySelector<HTMLButtonElement>('[aria-label="配置 MinerU"]')!;
    expect(button).not.toBeNull();
    await act(async () => button.click());
    expect(p.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("shows real parsing progress alongside readable original without translation preparation", async () => {
    const p = props();
    await mount({ ...p, paper: { ...p.paper, blockData: [] },
      pipeline: { ...p.pipeline, stage: "mineru-processing", mineruProgress: 0.6 } });
    const bars = container.querySelectorAll('[role="progressbar"]');
    expect([...bars].map((bar) => bar.getAttribute("aria-valuenow"))).toEqual(["60"]);
    expect(container.querySelector(".pipeline-status-bar")?.textContent).toContain("原文阅读");
    expect(container.querySelector(".pipeline-status-bar")?.textContent).not.toContain("中文预览");
    expect(container.querySelectorAll(".pipeline-step")).toHaveLength(2);
    expect(container.querySelector('[aria-label="暂停自动翻译"]')).toBeNull();
  });

  it("offers parsing retry even when previous coordinates remain readable", async () => {
    const p = props();
    await mount({ ...p, pipeline: { ...p.pipeline, stage: "failed", error: "下载失败" } });
    const retry = container.querySelector<HTMLButtonElement>('[aria-label="重试论文处理"]')!;
    expect(retry).not.toBeNull();
    await act(async () => retry.click());
    expect(p.onEnhance).toHaveBeenCalledOnce();
  });
});
