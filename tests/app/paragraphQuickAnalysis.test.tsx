import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/app/App";
import type { AiRequest } from "../../src/services/ai";
import { extractPdfBlocks } from "../../src/services/document";
import { DEFAULT_SERVICE_SETTINGS, toPublicServiceSettings } from "../../src/domain/serviceSettings";

vi.mock("../../src/services/originalPdf", () => ({
  readOriginalPdf: async () => new ArrayBuffer(8),
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

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true, value: () => ({}),
});

const paper = {
  id: "quick-analysis-paper", title: "Quick Analysis", authors: [], year: null,
  sourcePath: "local://quick-analysis", originalId: "quick-analysis-document", pageCount: 1,
  importedAt: "2026-10-09", tags: [], favorite: false, overview: null, blocks: 2, parseVersion: 2,
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

async function mount(source = paper, configured = true) {
  window.localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([source]));
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
        revision: `quick-analysis-${++revision}`,
      };
      if (channel === "zhiyan:documents:states") return [];
      return undefined;
    }) as never,
    stream: stream as never,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(<App />));
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("打开阅读"))!.click());
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

describe("paragraph quick analysis", () => {
  it("selects on a single click without AI calls and exposes the double-click hint", async () => {
    const { blocks, stream } = await mount();
    await act(async () => blocks[0].click());
    expect(blocks[0].getAttribute("aria-pressed")).toBe("true");
    expect(stream).not.toHaveBeenCalled();
    expect(blocks[0].querySelector('[role="tooltip"]')?.textContent ?? "").toContain("翻译并解释整段");
  });

  it("starts both full-paragraph streams before either finishes and keeps independent progress", async () => {
    const { container, blocks, jobs, stream } = await mount();
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledTimes(2);
    expect(jobs.map((job) => job.request.operation).sort()).toEqual(["explain", "translate"]);
    for (const job of jobs) {
      expect(job.request.block?.text).toBe(paper.blockData[0].text);
      expect(job.cancel).not.toHaveBeenCalled();
    }
    const translate = jobs.find((job) => job.request.operation === "translate")!;
    const explain = jobs.find((job) => job.request.operation === "explain")!;
    expect(container.querySelector('[data-operation="translate"] .spin')).not.toBeNull();
    expect(container.querySelector('[data-operation="explain"] .spin')).not.toBeNull();
    await act(async () => { translate.emit("中文开头"); explain.emit("解释开头"); });
    expect(container.querySelector(".assistant-translation p")?.textContent).toBe("中文开头");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="explain"]')!.click());
    expect(container.querySelector(".assistant-explanation p")?.textContent).toBe("解释开头");
    expect(stream).toHaveBeenCalledTimes(2);
    await act(async () => translate.finish("完整中文译文"));
    expect(container.querySelector('[data-operation="translate"] .spin')).toBeNull();
    expect(container.querySelector('[data-operation="explain"] .spin')).not.toBeNull();
    await act(async () => explain.finish("完整术语与逻辑解释"));
    expect(container.querySelector(".assistant-explanation p")?.textContent).toBe("完整术语与逻辑解释");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="translate"]')!.click());
    expect(container.querySelector(".assistant-translation p")?.textContent).toBe("完整中文译文");
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-operation="translate"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("cancels both streams when another paragraph is selected and discards late output", async () => {
    const { container, blocks, jobs, stream } = await mount();
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledTimes(2);
    await act(async () => blocks[1].click());
    for (const job of jobs) expect(job.cancel).toHaveBeenCalledOnce();
    await act(async () => {
      jobs[0].emit("旧段落结果");
      jobs[0].finish("旧段落结果");
      jobs[1].fail(new Error("旧段落错误"));
    });
    expect(container.querySelector(".assistant-translation")).toBeNull();
    expect(container.querySelector(".assistant-action-error")).toBeNull();
  });

  it("keeps an in-flight pair when the same paragraph is clicked or double-clicked again", async () => {
    const { blocks, jobs, stream } = await mount();
    await doubleClick(blocks[0]);
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledTimes(2);
    for (const job of jobs) expect(job.cancel).not.toHaveBeenCalled();
    await act(async () => jobs.forEach((job) => job.finish("已完成")));
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
    expect(stream).toHaveBeenCalledTimes(2);
    for (const job of jobs) expect(job.request.block?.text).toBe(paper.blockData[0].text);
    expect(window.getSelection()?.toString()).toBe("");
    await act(async () => jobs.forEach((job) => job.finish("已完成")));
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

  it("does not let background preview translation cancel a foreground quick-analysis pair", async () => {
    const source = {
      ...paper, parseStatus: "fallback",
      blockData: paper.blockData.map((block) => ({ ...block, text: `${block.text} This paragraph has enough content for preview translation.` })),
    };
    vi.mocked(extractPdfBlocks).mockResolvedValueOnce(source.blockData as never);
    const { container, blocks, jobs, stream } = await mount(source);
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledTimes(2);
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "重试正文整理")!.click());
    expect(stream).toHaveBeenCalledTimes(3);
    expect(jobs[0].cancel).not.toHaveBeenCalled();
    expect(jobs[1].cancel).not.toHaveBeenCalled();
    await act(async () => jobs[2].finish("后台预翻译"));
    expect(stream).toHaveBeenCalledTimes(4);
    expect(jobs[0].cancel).not.toHaveBeenCalled();
    expect(jobs[1].cancel).not.toHaveBeenCalled();
    await act(async () => {
      jobs[0].finish("前台翻译");
      jobs[1].finish("前台解释");
      jobs[3].finish("后台第二段");
    });
  });

  it("displays a manually regenerated explanation after quick analysis has completed", async () => {
    const { container, blocks, jobs, stream } = await mount();
    await doubleClick(blocks[0]);
    await act(async () => jobs.forEach((job) => job.finish("首次结果")));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="explain"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="重新生成解释"]')!.click());
    expect(stream).toHaveBeenCalledTimes(3);
    await act(async () => jobs[2].finish("重新生成的解释"));
    expect(container.querySelector(".assistant-explanation p")?.textContent).toBe("重新生成的解释");
  });

  it("retains the explanation if translation fails without cancelling its sibling request", async () => {
    const { container, blocks, jobs, stream } = await mount();
    await doubleClick(blocks[0]);
    expect(stream).toHaveBeenCalledTimes(2);
    const translate = jobs.find((job) => job.request.operation === "translate")!;
    const explain = jobs.find((job) => job.request.operation === "explain")!;
    await act(async () => translate.fail(new Error("翻译暂时不可用")));
    expect(explain.cancel).not.toHaveBeenCalled();
    expect(container.querySelector('[data-operation="explain"] .spin')).not.toBeNull();
    await act(async () => explain.finish("完整解释仍然可用"));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="explain"]')!.click());
    expect(container.querySelector(".assistant-explanation")?.textContent).toContain("完整解释仍然可用");
    expect(container.querySelector(".assistant-action-error")?.textContent).toContain("翻译暂时不可用");
  });

  it("does not run paragraph translation or explanation for a table", async () => {
    const { blocks, stream } = await mount({
      ...paper, blockData: [{ ...paper.blockData[0], kind: "table" }, paper.blockData[1]],
    });
    await doubleClick(blocks[0]);
    expect(stream).not.toHaveBeenCalled();
    expect(blocks[0].textContent).not.toContain("翻译并解释");
  });

  it("opens service settings for an unconfigured double-click instead of making requests", async () => {
    const { container, blocks, stream } = await mount(paper, false);
    await doubleClick(blocks[0]);
    expect(stream).not.toHaveBeenCalled();
    expect(container.querySelector(".settings-dialog")).not.toBeNull();
  });
});
