import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/app/App";
import type { AiRequest } from "../../src/services/ai";
import { extractPdfBlocks } from "../../src/services/document";
import { preparePdfFile } from "../../src/services/library";
import { DEFAULT_SERVICE_SETTINGS, toPublicServiceSettings } from "../../src/domain/serviceSettings";

vi.mock("../../src/services/originalPdf", () => ({
  readOriginalPdf: async () => new ArrayBuffer(8),
}));
vi.mock("../../src/services/chartImage", () => ({
  loadChartImage: vi.fn(async () => "data:image/png;base64,c3ludGhldGlj"),
}));
vi.mock("../../src/services/document", () => ({
  extractPdfBlocks: vi.fn(),
  openPdf: async () => ({
    numPages: 1,
    getPage: async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    }),
    destroy: async () => undefined,
  }),
}));
vi.mock("../../src/services/pdfTextLayer", () => ({
  renderPdfTextLayer: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
}));
vi.mock("../../src/services/library", async (importActual) => ({
  ...await importActual<typeof import("../../src/services/library")>(),
  preparePdfFile: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true, value: () => ({}),
});

const paper = {
  id: "quick-analysis-paper", title: "Quick Analysis", authors: [], year: null,
  sourcePath: "local://quick-analysis", originalId: "quick-analysis-document", pageCount: 1,
  importedAt: "2026-10-09", tags: [], favorite: false, blocks: 2, parseVersion: 2,
  blockData: [
    { id: "paragraph-a", kind: "paragraph", pageNumber: 1, order: 0,
      text: "The model uses attention. It works well.", bbox: [0.1, 0.1, 0.9, 0.2] },
    { id: "paragraph-b", kind: "paragraph", pageNumber: 1, order: 1,
      text: "A different paragraph.", bbox: [0.1, 0.3, 0.9, 0.4] },
  ],
};
const settings = toPublicServiceSettings({
  ...DEFAULT_SERVICE_SETTINGS, aiProvider: "deepseek",
  deepseek: { ...DEFAULT_SERVICE_SETTINGS.deepseek, apiKey: "test" },
});
type Job = {
  request: AiRequest;
  emit: (text: string) => void;
  finish: (text: string) => void;
  fail: (error: Error) => void;
  cancel: ReturnType<typeof vi.fn>;
};
const mounted: Array<{ root: Root; container: HTMLElement }> = [];
let revision = 0;

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  window.localStorage.clear();
  delete window.zhiyan;
});

async function mount(source = paper, configured = true, otherPapers: typeof paper[] = [], options: {
  states?: unknown[]; mineruStatus?: unknown; documentState?: unknown; settingsRevision?: string;
} = {}) {
  window.localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([source, ...otherPapers]));
  const jobs: Job[] = [];
  const stream = vi.fn((_channel: string, request: AiRequest, emit: Job["emit"],
    onAbort?: (cancel: () => void) => (() => void)) => new Promise<string>((finish, fail) => {
    const cancel = vi.fn(() => fail(Object.assign(new Error("请求已取消"), { name: "AbortError" })));
    onAbort?.(cancel);
    jobs.push({ request, emit, finish, fail, cancel });
  }));
  window.zhiyan = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === "zhiyan:settings:get") return {
        ...(configured ? settings : toPublicServiceSettings(DEFAULT_SERVICE_SETTINGS)),
        mineru: { ...settings.mineru, configured: Boolean(options.mineruStatus) },
        revision: options.settingsRevision ?? `quick-analysis-${++revision}`,
      };
      if (channel === "zhiyan:documents:states") return options.states ?? [source, ...otherPapers].map((item) => ({
        paperId: item.id, task: { state: "done" }, result: { blocks: item.blockData },
      }));
      if (channel === "zhiyan:documents:state") return options.documentState;
      if (channel === "zhiyan:mineru:start") return { batchId: "synthetic-batch" };
      if (channel === "zhiyan:mineru:status") return typeof options.mineruStatus === "function"
        ? options.mineruStatus() : options.mineruStatus;
      return undefined;
    }) as never,
    stream: stream as never,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(<App />));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="打开阅读"]')!.click());
  const blocks = container.querySelectorAll<HTMLButtonElement>(".pdf-block-hit-area");
  return { container, blocks, stream, jobs };
}

async function doubleClick(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
    element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
  });
}

function finishJobs(jobs: Job[], text = "已完成") {
  for (const job of jobs) {
    job.finish(job.request.operation === "insight" ? JSON.stringify({ summary: `${text}摘要`, role: `${text}作用` })
      : job.request.operation === "vocabulary" ? JSON.stringify({ overview: `${text}词汇`, terms: [{ term: "attention", translation: "注意力" }] })
      : text);
  }
}

describe("paragraph quick analysis", () => {
  it("starts chart analysis on double-click and reuses the running request and completed result", async () => {
    const source = { ...paper, blockData: [{ ...paper.blockData[0], id: "figure", kind: "image", text: "Figure 1" }, paper.blockData[1]] };
    const { container, blocks, jobs, stream } = await mount(source);
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledOnce();
    expect(jobs[0].request).toMatchObject({ operation: "chart", block: { id: "figure" }, imageDataUrl: "data:image/png;base64,c3ludGhldGlj" });
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledOnce();
    await act(async () => jobs[0].emit('{"summary":"**流程图**'));
    expect(container.querySelector(".assistant-chart-reading strong")?.textContent).toBe("比较对象");
    expect(container.querySelector(".assistant-chart-reading .markdown-content strong")?.textContent).toBe("流程图");
    await act(async () => jobs[0].finish(JSON.stringify({ summary: "**流程图**", encoding: "六个步骤", findings: ["逐步筛选"],
      role: "展示方法", caveats: ["未显示具体数值"] })));
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledOnce();
    expect(container.querySelector(".assistant-chart-reading")?.getAttribute("aria-busy")).toBe("false");
  });
  it("cancels chart analysis when another block is selected and ignores late output", async () => {
    const source = { ...paper, blockData: [{ ...paper.blockData[0], id: "figure", kind: "image", text: "Figure 1" }, paper.blockData[1]] };
    const { container, blocks, jobs } = await mount(source);
    await doubleClick(blocks[0]);
    expect(jobs).toHaveLength(1);
    await act(async () => blocks[1].click());
    expect(jobs[0].cancel).toHaveBeenCalledOnce();
    await act(async () => jobs[0].emit('{"summary":"过期结果'));
    expect(container.textContent).not.toContain("过期结果");
    expect(container.querySelector(".chart-context")).toBeNull();
  });
  it("reports a chart failure and lets another double-click retry", async () => {
    const source = { ...paper, blockData: [{ ...paper.blockData[0], id: "figure", kind: "image", text: "Figure 1" }, paper.blockData[1]] };
    const { container, blocks, jobs } = await mount(source);
    await doubleClick(blocks[0]);
    await act(async () => jobs[0].fail(new Error("图表服务暂不可用")));
    expect(container.querySelector(".assistant-action-error")?.textContent).toContain("图表服务暂不可用");
    await doubleClick(blocks[0]);
    expect(jobs).toHaveLength(2);
  });
  it("keeps the running chart request when double-clicking a word in the PDF text layer", async () => {
    const source = { ...paper, blockData: [{ ...paper.blockData[0], id: "table", kind: "table" }, paper.blockData[1]] };
    const { container, blocks, jobs } = await mount(source);
    await doubleClick(blocks[0]);
    const stage = container.querySelector<HTMLElement>(".pdf-page-stage")!;
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 600, height: 800 } as DOMRect);
    const span = document.createElement("span");
    span.textContent = "attention";
    stage.querySelector(".pdf-text-layer")!.append(span);
    const range = document.createRange();
    range.selectNodeContents(span);
    Object.defineProperty(range, "getClientRects", { value: () => [{ left: 90, top: 90, width: 20, height: 20 }] });
    window.getSelection()!.addRange(range);
    await act(async () => {
      span.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 2, clientX: 100, clientY: 100 }));
      span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, detail: 2, clientX: 100, clientY: 100 }));
      span.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2, clientX: 100, clientY: 100 }));
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].cancel).not.toHaveBeenCalled();
    expect(window.getSelection()?.toString()).toBe("");
  });
  it("does not expose a whole-paper overview module or action", async () => {
    const { container, stream } = await mount();
    expect(container.querySelector(".assistant-overview")).toBeNull();
    expect(container.textContent).not.toContain("论文概览");
    expect(container.textContent).not.toContain("生成全文概览");
    expect(stream).not.toHaveBeenCalled();
  });

  it("shows no background translation UI and does not request AI until the user asks", async () => {
    const { container, blocks, stream, jobs } = await mount();
    expect(container.textContent).not.toContain("中文预览");
    expect(container.textContent).not.toContain("后台翻译");
    expect(container.textContent).not.toContain("导入与翻译");
    expect(container.querySelector(".pipeline-assistant-section")).toBeNull();
    expect(stream).not.toHaveBeenCalled();
    await act(async () => blocks[0].click());
    expect(stream).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="translate"]')!.click());
    expect(jobs).toHaveLength(1);
    expect(jobs[0].request.operation).toBe("translate");
    await act(async () => jobs[0].emit("即时译文"));
    expect(container.querySelector(".assistant-translation p")?.textContent).toBe("即时译文");
    await act(async () => jobs[0].finish("即时译文"));
  });

  it("imports and parses a new PDF without generating any model request", async () => {
    const source = { ...paper, id: "new-paper", originalId: "new-document", sourcePath: "local://new" };
    vi.mocked(preparePdfFile).mockResolvedValueOnce({
      paper: { ...source, parseStatus: "pending", blockData: [], blocks: 0 } as never,
      data: new ArrayBuffer(8), duplicate: false,
    });
    vi.mocked(extractPdfBlocks).mockResolvedValueOnce(source.blockData as never);
    const { container, stream } = await mount();
    await act(async () => container.querySelector<HTMLButtonElement>(".back-button")!.click());
    const input = container.querySelector<HTMLInputElement>(".import-button input")!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["synthetic"], "new.pdf", { type: "application/pdf" })] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(preparePdfFile).toHaveBeenCalledOnce();
    expect(extractPdfBlocks).not.toHaveBeenCalled();
    expect(container.querySelector(".reader-shell")).toBeNull();
    expect(container.querySelector(".paper-list")).not.toBeNull();
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(stream).not.toHaveBeenCalled();
  });

  it("restores completed MinerU results without starting background translation", async () => {
    const { container, stream } = await mount(paper, true, [], {
      states: [{ paperId: paper.id, task: { state: "done" }, result: { blocks: paper.blockData, pageCount: 1 } }],
    });
    expect(container.querySelectorAll(".pdf-block-hit-area")).toHaveLength(2);
    expect(stream).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("中文预览");
  });

  it("completes MinerU parsing without starting background translation", async () => {
    const source = { ...paper, blockData: paper.blockData.map((block) => ({ ...block, bbox: undefined })) } as unknown as typeof paper;
    const { container, stream } = await mount(source, true, [], {
      states: [],
      mineruStatus: { state: "done", result: { blocks: paper.blockData, pageCount: 1 } },
    });
    expect(container.querySelector(".reader-shell")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="处理论文"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="打开阅读"]')!.click());
    expect(container.querySelectorAll(".pdf-block-hit-area")).toHaveLength(2);
    expect(stream).not.toHaveBeenCalled();
  });

  it("retries an interrupted MinerU download without another upload or consent prompt", async () => {
    const task = { batchId: "existing-batch", state: "downloading" };
    const mineruStatus = vi.fn()
      .mockRejectedValueOnce(new Error("结果下载中断"))
      .mockResolvedValue({ state: "done", result: { blocks: paper.blockData, pageCount: 1 } });
    const { container, stream } = await mount(paper, true, [], {
      states: [{ paperId: paper.id, task, result: null }],
      documentState: { task, result: null }, mineruStatus,
    });
    expect(mineruStatus).toHaveBeenCalledOnce();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="处理论文"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="打开阅读"]')!.click());
    expect(mineruStatus).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[aria-label="确认云端解析"]')).toBeNull();
    expect(vi.mocked(window.zhiyan!.invoke).mock.calls.map(([channel]) => channel)).not.toContain("zhiyan:mineru:start");
    expect(container.querySelectorAll(".pdf-block-hit-area")).toHaveLength(2);
    expect(stream).not.toHaveBeenCalled();
  });

  it("restarts a failed MinerU upload from the library and keeps reading locked", async () => {
    const task = { batchId: "failed-batch", state: "failed", error: "云端解析失败" };
    const { container } = await mount(paper, true, [], {
      states: [{ paperId: paper.id, task, result: null }],
      documentState: { task, result: null }, mineruStatus: task,
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="处理论文"]')!.click());
    expect(container.querySelector('[aria-label="确认云端解析"]')).toBeNull();
    expect(vi.mocked(window.zhiyan!.invoke).mock.calls.map(([channel]) => channel)).toContain("zhiyan:mineru:start");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="打开阅读"]')!.disabled).toBe(true);
  });
  it("keeps vocabulary scoped to the full paragraph when a sentence is selected", async () => {
    const { container, jobs } = await mount();
    const stage = container.querySelector<HTMLElement>(".pdf-page-stage")!;
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 600, height: 800 } as DOMRect);
    const text = document.createElement("span");
    text.textContent = "It works well.";
    container.querySelector(".pdf-text-layer")!.append(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    Object.defineProperty(range, "getClientRects", { value: () => [{ left: 150, top: 110, width: 20, height: 20 }] });
    window.getSelection()?.addRange(range);
    await act(async () => text.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })));
    expect(container.querySelector(".selected-context h2")?.textContent).toBe("选中句子");
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>(".assistant-tabs button")]
      .find((button) => button.textContent?.includes("学术词汇"))!.click());
    expect(container.querySelector(".vocabulary-panel")?.textContent).toContain("attention");
    await act(async () => container.querySelector<HTMLButtonElement>(".vocabulary-intro button")!.click());
    expect(jobs[0].request.block?.text).toBe(paper.blockData[0].text);
    await act(async () => jobs[0].finish('{"overview":"重点","terms":[]}'));
  });

  it("keeps the same word across papers with separate sources and jumps back without retaining stale navigation", async () => {
    const other = { ...paper, id: "other-paper", title: "Another Paper", sourcePath: "local://other", originalId: "other-document" };
    const { container, jobs, stream } = await mount(paper, true, [other]);
    async function collect() {
      await act(async () => container.querySelector<HTMLButtonElement>(".pdf-block-hit-area")!.click());
      await act(async () => [...container.querySelectorAll<HTMLButtonElement>(".assistant-tabs button")]
        .find((button) => button.textContent?.includes("学术词汇"))!.click());
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="将 attention 加入单词表"]')!.click());
    }
    await collect();
    await act(async () => container.querySelector<HTMLButtonElement>(".back-button")!.click());
    await act(async () => [...container.querySelectorAll<HTMLElement>(".paper-row")]
      .find((element) => element.textContent?.includes("Another Paper"))!.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("打开阅读"))!.click());
    await collect();
    const question = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="向论文提问"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(question, "这篇论文讲什么？");
      question.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="发送问题"]')!.click());
    await act(async () => jobs[0].finish("另一篇论文的问答结果"));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="打开单词表"]')!.click());
    expect(container.querySelectorAll(".wordbook-entry")).toHaveLength(1);
    expect(container.querySelectorAll(".wordbook-source")).toHaveLength(2);
    await act(async () => container.querySelector<HTMLButtonElement>(".wordbook-source button")!.click());
    expect(container.querySelector(".reader-title")?.textContent).toContain(paper.title);
    expect(container.querySelector(".pdf-block-hit-area.is-active")?.id).toBe(`pdf-block-${paper.blockData[0].id}`);
    expect(container.querySelector(".reader-assistant")).not.toBeNull();
    expect(container.textContent).not.toContain("另一篇论文的问答结果");
    await act(async () => container.querySelector<HTMLButtonElement>(".back-button")!.click());
    await act(async () => [...container.querySelectorAll<HTMLElement>(".paper-row")]
      .find((element) => element.textContent?.includes("Another Paper"))!.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("打开阅读"))!.click());
    expect(container.querySelector(".reader-assistant")).not.toBeNull();
    expect(stream).toHaveBeenCalledTimes(1);
  });
  it("does not execute HTML, load remote images or enable model-generated links in explanations", async () => {
    const { container, blocks, jobs } = await mount();
    await doubleClick(blocks[0]);
    await act(async () => jobs.find((job) => job.request.operation === "explain")!
      .emit('<script>window.hacked=true</script>\n\n<img src="https://example.com/track" onerror="alert(1)">\n\n[阅读](javascript:alert(1)) ![插图](https://example.com/track.png)'));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="explain"]')!.click());
    expect(container.querySelector(".assistant-explanation script")).toBeNull();
    expect(container.querySelector(".assistant-explanation img")).toBeNull();
    expect(container.querySelector(".assistant-explanation a")).toBeNull();
    expect(container.querySelector(".assistant-explanation")?.textContent).toContain("阅读");
    await act(async () => finishJobs(jobs));
  });

  it("cancels vocabulary generation on paragraph changes and caches only complete validated results", async () => {
    const { container, blocks, jobs, stream } = await mount();
    const tab = [...container.querySelectorAll<HTMLButtonElement>('.assistant-tabs button')]
      .find((button) => button.textContent?.includes("学术词汇"))!;
    await act(async () => { blocks[0].click(); tab.click(); });
    await act(async () => container.querySelector<HTMLButtonElement>(".vocabulary-intro button")!.click());
    await act(async () => jobs[0].emit('{"overview":"未结束'));
    expect(window.localStorage.getItem("zhiyan-workbench.analysis.v1")).not.toContain("未结束");
    await act(async () => blocks[1].click());
    expect(jobs[0].cancel).toHaveBeenCalledOnce();
    await act(async () => jobs[0].finish('{"overview":"旧段落","terms":[]}'));
    expect(container.textContent).not.toContain("旧段落");
    await act(async () => blocks[0].click());
    await act(async () => container.querySelector<HTMLButtonElement>(".vocabulary-intro button")!.click());
    await act(async () => jobs[1].finish('{"overview":"本段重点","terms":[{"term":"attention","translation":"注意力"}]}'));
    await act(async () => { blocks[1].click(); blocks[0].click(); });
    expect(container.querySelector(".vocabulary-panel")?.textContent).toContain("本段重点");
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it("reports a failed wordbook save without falsely marking a word collected", async () => {
    const { container, blocks } = await mount();
    await act(async () => blocks[0].click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.assistant-tabs button')]
      .find((button) => button.textContent?.includes("学术词汇"))!.click());
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === "zhiyan-workbench.wordbook.v1") throw new Error("quota");
      original.call(this, key, value);
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="将 attention 加入单词表"]')!.click());
    expect(container.querySelector(".wordbook-error")?.textContent).toContain("保存失败");
    expect(container.querySelector(".wordbook-entry")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭单词表"]')!.click());
    expect(container.querySelector<HTMLButtonElement>('[aria-label="将 attention 加入单词表"]')?.disabled).toBe(false);
  });

  it("renders explanation Markdown instead of showing heading and emphasis markers", async () => {
    const { container, blocks, jobs } = await mount();
    await doubleClick(blocks[0]);
    const explain = jobs.find((job) => job.request.operation === "explain")!;
    await act(async () => explain.emit("## 核心术语\n\n**注意力**用于选择信息。\n\n- 保留上下文\n- 区分权重"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="explain"]')!.click());
    expect(container.querySelector(".assistant-explanation h2")?.textContent).toBe("核心术语");
    expect(container.querySelector(".assistant-explanation strong")?.textContent).toBe("注意力");
    expect(container.querySelectorAll(".assistant-explanation li")).toHaveLength(2);
    expect(container.querySelector(".assistant-explanation")?.textContent).not.toContain("**");
    await act(async () => finishJobs(jobs));
  });

  it("renders streamed and cached explanation formulas in the explanation tab", async () => {
    const { container, blocks, jobs, stream } = await mount();
    await doubleClick(blocks[0]);
    const explain = jobs.find((job) => job.request.operation === "explain")!;
    await act(async () => explain.emit("## 段落含义\n\n隐藏状态 $h_t$ 依赖 $h_{t"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="explain"]')!.click());
    expect(container.querySelectorAll(".assistant-explanation .katex")).toHaveLength(1);
    await act(async () => explain.emit("-1}$。"));
    expect(container.querySelectorAll(".assistant-explanation .katex")).toHaveLength(2);
    await act(async () => explain.finish("## 段落含义\n\n隐藏状态 $h_t$ 依赖 $h_{t-1}$。"));
    await act(async () => finishJobs(jobs.filter((job) => job !== explain)));
    await act(async () => { blocks[1].click(); blocks[0].click(); });
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="explain"]')!.click());
    expect(container.querySelectorAll(".assistant-explanation .katex")).toHaveLength(2);
    expect(stream).toHaveBeenCalledTimes(4);
  });

  it("shows readable insight fields before the structured response is complete", async () => {
    const { container, blocks, jobs } = await mount();
    await act(async () => blocks[0].click());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="insight"]')!.click());
    expect(jobs).toHaveLength(1);
    await act(async () => jobs[0].emit('{"summary":"这段说明注意力'));
    expect(container.querySelector(".assistant-insight")?.textContent).toContain("这段说明注意力");
    expect(container.querySelector(".assistant-insight")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".assistant-insight")?.textContent).not.toContain('{"summary"');
    await act(async () => jobs[0].emit('机制。","role":"连接方法与'));
    expect(container.querySelector(".assistant-insight")?.textContent).toContain("连接方法与");
    await act(async () => jobs[0].finish('{"summary":"这段说明注意力机制。","role":"连接方法与实验。"}'));
    expect(container.querySelector(".assistant-insight")?.getAttribute("aria-busy")).toBe("false");
    await act(async () => blocks[1].click());
    expect(container.textContent).not.toContain("这段说明注意力机制。");
  });

  it("limits academic vocabulary to the full selected paragraph, not the paper or selected sentence", async () => {
    const source = structuredClone(paper);
    source.blockData[1].text = "The hypothesis supports inference.";
    const { container, blocks, jobs } = await mount(source);
    await act(async () => blocks[0].click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.assistant-tabs button')]
      .find((button) => button.textContent?.includes("学术词汇"))!.click());
    expect(container.querySelector(".vocabulary-panel")?.textContent).toContain("attention");
    expect(container.querySelector(".vocabulary-panel")?.textContent).not.toContain("hypothesis");
    expect(container.querySelector(".vocabulary-panel")?.textContent).toContain("当前段落");
    const generate = container.querySelector<HTMLButtonElement>(".vocabulary-intro button")!;
    await act(async () => generate.click());
    expect(jobs[0].request.operation).toBe("vocabulary");
    expect(jobs[0].request.block?.text).toBe(source.blockData[0].text);
    await act(async () => jobs[0].finish('{"overview":"重点术语","terms":[{"term":"attention","translation":"注意力","definition":"按相关性分配权重。"},{"term":"hypothesis","translation":"假设"}]}'));
    expect(container.querySelector(".vocabulary-panel")?.textContent).not.toContain("hypothesis");
    await act(async () => blocks[1].click());
    expect(container.querySelector(".vocabulary-panel")?.textContent).toContain("hypothesis");
    expect(container.querySelector(".vocabulary-panel")?.textContent).not.toContain("attention");
  });

  it("collects words only on explicit clicks and restores the personal wordbook after reload", async () => {
    const { container, blocks, stream } = await mount();
    await act(async () => blocks[0].click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.assistant-tabs button')]
      .find((button) => button.textContent?.includes("学术词汇"))!.click());
    const openBook = () => container.querySelector<HTMLButtonElement>('[aria-label="打开单词表"]')!.click();
    await act(async () => openBook());
    expect(container.querySelector('[role="dialog"][aria-label="单词表"]')?.textContent).toContain("暂无收藏");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭单词表"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="将 attention 加入单词表"]')!.click());
    expect(stream).not.toHaveBeenCalled();
    await act(async () => openBook());
    expect(container.querySelector(".wordbook-entry")?.textContent).toContain("attention");
    expect(container.querySelector(".wordbook-entry")?.textContent).toContain(paper.title);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="将 attention 标记为已掌握"]')!.click());
    const saved = JSON.parse(window.localStorage.getItem("zhiyan-workbench.wordbook.v1")!);
    expect(saved).toHaveLength(1);
    expect(saved[0].mastered).toBe(true);
    const previous = mounted.pop()!;
    await act(async () => previous.root.unmount());
    previous.container.remove();
    const reloaded = await mount();
    await act(async () => reloaded.container.querySelector<HTMLButtonElement>('[aria-label="打开单词表"]')!.click());
    expect(reloaded.container.querySelector(".wordbook-entry")?.textContent).toContain("attention");
    expect(reloaded.container.querySelector('[aria-label="将 attention 标记为待熟悉"]')).not.toBeNull();
    await act(async () => reloaded.container.querySelector<HTMLButtonElement>('[aria-label="从单词表移除 attention"]')!.click());
    expect(reloaded.container.querySelector(".wordbook-entry")).toBeNull();
  });

  it("selects on a single click without AI calls and exposes the double-click hint", async () => {
    const { blocks, stream } = await mount();
    await act(async () => blocks[0].click());
    expect(blocks[0].getAttribute("aria-pressed")).toBe("true");
    expect(stream).not.toHaveBeenCalled();
    expect(blocks[0].querySelector('[role="tooltip"]')?.textContent ?? "").toContain("双击分析整段");
  });

  it("starts translation, explanation, insight and vocabulary together on a paragraph double-click", async () => {
    const { container, blocks, jobs, stream } = await mount();
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledTimes(4);
    expect(jobs.map((job) => job.request.operation).sort()).toEqual(["explain", "insight", "translate", "vocabulary"]);
    for (const job of jobs) {
      expect(job.request.block?.text).toBe(paper.blockData[0].text);
      expect(job.cancel).not.toHaveBeenCalled();
    }
    const translate = jobs.find((job) => job.request.operation === "translate")!;
    const explain = jobs.find((job) => job.request.operation === "explain")!;
    const insight = jobs.find((job) => job.request.operation === "insight")!;
    const vocabulary = jobs.find((job) => job.request.operation === "vocabulary")!;
    expect(container.querySelector('[data-operation="translate"] .spin')).not.toBeNull();
    expect(container.querySelector('[data-operation="explain"] .spin')).not.toBeNull();
    expect(container.querySelector('[data-operation="insight"] .spin')).not.toBeNull();
    expect(container.querySelector(".assistant-tabs [role='tab']:nth-child(2) .spin")).not.toBeNull();
    await act(async () => { translate.emit("中文开头"); explain.emit("解释开头"); });
    expect(container.querySelector(".assistant-translation p")?.textContent).toBe("中文开头");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="explain"]')!.click());
    expect(container.querySelector(".assistant-explanation p")?.textContent).toBe("解释开头");
    await act(async () => {
      insight.emit('{"summary":"摘要开头');
      vocabulary.emit('{"overview":"重点","terms":[]}');
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="insight"]')!.click());
    expect(container.querySelector(".assistant-insight")?.textContent).toContain("摘要开头");
    expect(stream).toHaveBeenCalledTimes(4);
    await act(async () => translate.finish("完整中文译文"));
    expect(container.querySelector('[data-operation="translate"] .spin')).toBeNull();
    expect(container.querySelector('[data-operation="explain"] .spin')).not.toBeNull();
    await act(async () => explain.finish("完整术语与逻辑解释"));
    await act(async () => insight.finish('{"summary":"完整摘要","role":"完整作用"}'));
    await act(async () => vocabulary.finish('{"overview":"重点","terms":[{"term":"attention","translation":"注意力"}]}'));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="explain"]')!.click());
    expect(container.querySelector(".assistant-explanation p")?.textContent).toBe("完整术语与逻辑解释");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="translate"]')!.click());
    expect(container.querySelector(".assistant-translation p")?.textContent).toBe("完整中文译文");
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledTimes(4);
    expect(container.querySelector('[data-operation="translate"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("cancels all four streams when another paragraph is selected and discards late output", async () => {
    const { container, blocks, jobs, stream } = await mount();
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledTimes(4);
    await act(async () => blocks[1].click());
    for (const job of jobs) expect(job.cancel).toHaveBeenCalledOnce();
    await act(async () => {
      for (const job of jobs) {
        job.emit("旧段落结果");
        job.fail(new Error("旧段落错误"));
      }
    });
    expect(container.querySelector(".assistant-translation")).toBeNull();
    expect(container.querySelector(".assistant-action-error")).toBeNull();
  });

  it("keeps the in-flight bundle when the same paragraph is clicked or double-clicked again", async () => {
    const { blocks, jobs, stream } = await mount();
    await doubleClick(blocks[0]);
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledTimes(4);
    for (const job of jobs) expect(job.cancel).not.toHaveBeenCalled();
    await act(async () => finishJobs(jobs));
  });

  it("uses the whole paragraph when the PDF text layer has a selected word", async () => {
    const { container, jobs, stream } = await mount();
    const stage = container.querySelector<HTMLElement>(".pdf-page-stage")!;
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 600, height: 800,
    } as DOMRect);
    const text = document.createElement("span");
    text.textContent = "attention";
    container.querySelector(".pdf-text-layer")!.append(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.addRange(range);
    await act(async () => text.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true, detail: 2, clientX: 160, clientY: 120,
    })));
    expect(stream).toHaveBeenCalledTimes(4);
    for (const job of jobs) expect(job.request.block?.text).toBe(paper.blockData[0].text);
    expect(window.getSelection()?.toString()).toBe("");
    await act(async () => finishJobs(jobs));
  });

  it("keeps text selection for non-paragraph blocks on repeated clicks", async () => {
    const source = {
      ...paper,
      blockData: [{ ...paper.blockData[0], kind: "heading" }, paper.blockData[1]],
    };
    const { container, blocks, stream } = await mount(source);
    const stage = container.querySelector<HTMLElement>(".pdf-page-stage")!;
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 600, height: 800,
    } as DOMRect);
    const text = document.createElement("span");
    text.textContent = "heading";
    container.querySelector(".pdf-text-layer")!.append(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.addRange(range);
    Object.defineProperty(range, "getClientRects", { value: () => [{ left: 150, top: 110, width: 20, height: 20 }] });
    await act(async () => text.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true, detail: 2, clientX: 160, clientY: 120,
    })));
    expect(stream).not.toHaveBeenCalled();
    expect(blocks[0].getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".selected-context h2")?.textContent).toBe("选中句子");
  });

  it("uses the published MinerU result instead of a legacy local extraction failure", async () => {
    const source = {
      ...paper, parseStatus: "fallback",
      blockData: paper.blockData.map((block) => ({ ...block, text: `${block.text} This paragraph has enough academic content to translate.` })),
    };
    const { container, blocks, jobs, stream } = await mount(source);
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledTimes(4);
    expect(container.textContent).not.toContain("重试正文整理");
    expect(extractPdfBlocks).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(4);
    for (const job of jobs) expect(job.cancel).not.toHaveBeenCalled();
    await act(async () => {
      finishJobs(jobs, "前台结果");
    });
  });

  it("displays a manually regenerated explanation after quick analysis has completed", async () => {
    const { container, blocks, jobs, stream } = await mount();
    await doubleClick(blocks[0]);
    await act(async () => finishJobs(jobs, "首次结果"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="explain"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="重新生成解释"]')!.click());
    expect(stream).toHaveBeenCalledTimes(5);
    await act(async () => jobs[4].finish("重新生成的解释"));
    expect(container.querySelector(".assistant-explanation p")?.textContent).toBe("重新生成的解释");
  });

  it("retains the explanation if translation fails without cancelling its sibling request", async () => {
    const { container, blocks, jobs, stream } = await mount();
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledTimes(4);
    const translate = jobs.find((job) => job.request.operation === "translate")!;
    const explain = jobs.find((job) => job.request.operation === "explain")!;
    await act(async () => translate.fail(new Error("翻译暂时不可用")));
    expect(explain.cancel).not.toHaveBeenCalled();
    expect(container.querySelector('[data-operation="explain"] .spin')).not.toBeNull();
    await act(async () => explain.finish("完整解释仍然可用"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="explain"]')!.click());
    expect(container.querySelector(".assistant-explanation")?.textContent).toContain("完整解释仍然可用");
    expect(container.querySelector(".assistant-action-error")?.textContent).toContain("翻译暂时不可用");
    await act(async () => finishJobs(jobs.filter((job) => ["insight", "vocabulary"].includes(job.request.operation))));
  });

  it("rejects malformed structured output without caching it or cancelling successful siblings and retries only missing results", async () => {
    const { container, blocks, jobs, stream } = await mount();
    await doubleClick(blocks[0]);
    const insight = jobs.find((job) => job.request.operation === "insight")!;
    const vocabulary = jobs.find((job) => job.request.operation === "vocabulary")!;
    await act(async () => {
      insight.emit('{"summary":"不完整摘要');
      insight.finish('{"summary":"不完整摘要"}');
      vocabulary.fail(new Error("词汇请求超时"));
      finishJobs(jobs.filter((job) => ["translate", "explain"].includes(job.request.operation)), "完整段落结果");
    });
    expect(window.localStorage.getItem("zhiyan-workbench.analysis.v1")).not.toContain("不完整摘要");
    expect(container.querySelector(".assistant-action-error")?.textContent).toContain("摘要与作用");
    expect(container.querySelector(".assistant-action-error")?.textContent).toContain("精选词汇：词汇请求超时");
    expect(jobs.every((job) => !job.cancel.mock.calls.length)).toBe(true);
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledTimes(6);
    expect(jobs.slice(4).map((job) => job.request.operation).sort()).toEqual(["insight", "vocabulary"]);
    expect(container.querySelector(".assistant-translation p")?.textContent).toBe("完整段落结果");
    await act(async () => finishJobs(jobs.slice(4), "重试"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="insight"]')!.click());
    expect(container.querySelector(".assistant-insight")?.textContent).toContain("重试作用");
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>(".assistant-tabs button")]
      .find((button) => button.textContent?.includes("学术词汇"))!.click());
    expect(container.querySelector(".vocabulary-panel")?.textContent).toContain("重试词汇");
    expect(container.querySelector(".vocabulary-panel")?.textContent).toContain("本段词汇已生成");
  });

  it("reuses results from individual actions in the double-click bundle and restores all four after reopening", async () => {
    const { container, blocks, jobs, stream } = await mount();
    await act(async () => blocks[0].click());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="translate"]')!.click());
    await act(async () => jobs[0].finish("已有译文"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="insight"]')!.click());
    await act(async () => finishJobs([jobs[1]], "已有"));
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledTimes(4);
    expect(jobs.slice(2).map((job) => job.request.operation).sort()).toEqual(["explain", "vocabulary"]);
    await act(async () => finishJobs(jobs.slice(2), "补齐"));
    await act(async () => container.querySelector<HTMLButtonElement>(".back-button")!.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("打开阅读"))!.click());
    await doubleClick(container.querySelector<HTMLElement>(".pdf-block-hit-area")!);
    expect(stream).toHaveBeenCalledTimes(4);
    expect(container.querySelector(".assistant-translation p")?.textContent).toBe("已有译文");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="insight"]')!.click());
    expect(container.querySelector(".assistant-insight")?.textContent).toContain("已有摘要");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="explain"]')!.click());
    expect(container.querySelector(".assistant-explanation")?.textContent).toContain("补齐");
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>(".assistant-tabs button")]
      .find((button) => button.textContent?.includes("学术词汇"))!.click());
    expect(container.querySelector(".vocabulary-panel")?.textContent).toContain("补齐词汇");
  });

  it("restores an explanation through its individual tab after a full app remount but explicitly regenerates on request", async () => {
    const first = await mount(paper, true, [], { settingsRevision: "same-provider" });
    await doubleClick(first.blocks[0]);
    await act(async () => finishJobs(first.jobs, "缓存解释"));
    const previous = mounted.pop()!;
    await act(async () => previous.root.unmount());
    previous.container.remove();
    const restored = await mount(paper, true, [], { settingsRevision: "same-provider" });
    await act(async () => restored.blocks[0].click());
    await act(async () => restored.container.querySelector<HTMLButtonElement>('[data-operation="explain"]')!.click());
    expect(restored.stream).not.toHaveBeenCalled();
    expect(restored.container.querySelector(".assistant-explanation")?.textContent).toContain("缓存解释");
    await act(async () => restored.container.querySelector<HTMLButtonElement>('[aria-label="重新生成解释"]')!.click());
    expect(restored.stream).toHaveBeenCalledOnce();
    await act(async () => restored.jobs[0].finish("主动更新的解释"));
    expect(restored.container.querySelector(".assistant-explanation")?.textContent).toContain("主动更新的解释");
  });

  it("does not cache missing vocabulary fields and retries only the failed vocabulary operation", async () => {
    const { container, blocks, jobs, stream } = await mount();
    await doubleClick(blocks[0]);
    const vocabulary = jobs.find((job) => job.request.operation === "vocabulary")!;
    await act(async () => {
      vocabulary.finish('{"overview":"缺少词汇数组"}');
      finishJobs(jobs.filter((job) => job.request.operation !== "vocabulary"), "完整");
    });
    expect(window.localStorage.getItem("zhiyan-workbench.analysis.v1")).not.toContain("缺少词汇数组");
    expect(container.querySelector(".assistant-action-error")?.textContent).toContain("精选词汇");
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledTimes(5);
    expect(jobs[4].request.operation).toBe("vocabulary");
    await act(async () => jobs[4].finish('{"overview":"无适合词汇","terms":[]}'));
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledTimes(5);
  });

  it("does not run paragraph translation or explanation for a table", async () => {
    const { blocks, stream } = await mount({
      ...paper, blockData: [{ ...paper.blockData[0], kind: "table" }, paper.blockData[1]],
    });
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledOnce();
    expect(stream.mock.calls[0][1].operation).toBe("chart");
    expect(blocks[0].textContent).not.toContain("翻译并解释");
  });

  it("opens service settings for an unconfigured double-click instead of making requests", async () => {
    const { container, blocks, stream } = await mount(paper, false);
    await doubleClick(blocks[0]);
    expect(stream).not.toHaveBeenCalled();
    expect(container.querySelector(".settings-dialog")).not.toBeNull();
  });
});
