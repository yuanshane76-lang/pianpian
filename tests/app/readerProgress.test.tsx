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
function props(): ComponentProps<typeof ReaderView> {
  return {
    paper: { id: "paper", title: "Paper", authors: [], year: null, sourcePath: "local://paper",
      originalId: "original", importedAt: "2026-10-09", tags: [], favorite: false, overview: null,
      blocks: 1, blockData: [paragraph], parseStatus: "ready" },
    selectedBlock: null, selectionText: "", translation: null, answer: null,
    isBusy: false, chartReading: null, explanation: null, actionError: null, processingStatus: "",
    aiAvailable: true, serviceLabel: "模型", serviceModel: "model", mineruConfigured: true,
    pendingAction: null, streamingOutput: null, insight: null, guide: null, vocabulary: [],
    pipeline: { paperId: "paper", source: "mineru", stage: "ready" },
    onBack: vi.fn(), onSelectBlock: vi.fn(), onSelectText: vi.fn(), onAnalyzeParagraph: vi.fn(),
    onOverview: vi.fn(), onTranslate: vi.fn(), onReadChart: vi.fn(), onExplain: vi.fn(), onAsk: vi.fn(),
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
});

describe("reader progress feedback", () => {
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
