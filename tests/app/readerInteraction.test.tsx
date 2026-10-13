import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/app/App";
import { DEFAULT_SERVICE_SETTINGS, toPublicServiceSettings } from "../../src/domain/serviceSettings";
import { loadChartImage } from "../../src/services/chartImage";
vi.mock("../../src/services/originalPdf", () => ({
  readOriginalPdf: vi.fn(async () => new ArrayBuffer(8)),
}));
vi.mock("../../src/services/document", () => ({
  openPdf: vi.fn(async () => ({
    numPages: 1,
    getPage: vi.fn(async () => ({
      getViewport: () => ({ width: 600, height: 800 }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    })),
    destroy: vi.fn(async () => undefined),
  })),
}));
vi.mock("../../src/services/pdfTextLayer", () => ({
  renderPdfTextLayer: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
}));
vi.mock("../../src/services/chartImage", () => ({
  loadChartImage: vi.fn(async () => "data:image/png;base64,aGVsbG8="),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
HTMLElement.prototype.scrollIntoView = vi.fn();
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: vi.fn(() => ({})),
});

const paper = {
  id: "interaction-paper", title: "Paper", authors: [], year: null, sourcePath: "local://interaction", originalId: "interaction-document", pageCount: 1,
  importedAt: "2026-10-04", tags: [], favorite: false, blocks: 2, parseVersion: 2,
  blockData: [
    { id: "p001-b001", kind: "paragraph", pageNumber: 1, order: 0, text: "The model uses attention. It works well.", bbox: [0.1, 0.1, 0.9, 0.2] },
    { id: "p001-b002", kind: "paragraph", pageNumber: 1, order: 1, text: "A different paragraph.", bbox: [0.1, 0.3, 0.9, 0.4] },
  ],
};
const settings = toPublicServiceSettings({ ...DEFAULT_SERVICE_SETTINGS, aiProvider: "deepseek", deepseek: { ...DEFAULT_SERVICE_SETTINGS.deepseek, apiKey: "test" } });
let settingsRevision = 0;
afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); delete window.zhiyan; });

async function mount(response: () => Promise<string>, streamResponse?: (onDelta: (text: string) => void) => Promise<string>, source = paper) {
  window.localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([source]));
  const currentSettings = { ...settings, revision: `test-${++settingsRevision}` };
  const invoke = vi.fn(async (channel: string) => {
    if (channel === "zhiyan:settings:get") return currentSettings;
    if (channel === "zhiyan:documents:states") return [{
      paperId: source.id, task: { state: "done" }, result: { blocks: source.blockData },
    }];
    return response();
  });
  const stream = vi.fn(async (_channel: string, _payload: unknown, onDelta: (text: string) => void, onAbort?: (cancel: () => void) => (() => void)) => {
    const cancel = vi.fn();
    onAbort?.(cancel);
    if (streamResponse) return streamResponse(onDelta);
    const value = await response();
    onDelta(value);
    return value;
  });
  window.zhiyan = { invoke: invoke as never, stream: stream as never };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<App />));
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes("打开阅读"))!;
  await act(async () => button.click());
  return { container, root, invoke, stream };
}

describe("paragraph translation interaction", () => {
  it("routes each result tab to its own operation and restores generated results without new calls", async () => {
    let value = "模型使用注意力机制。";
    const { container, root, stream } = await mount(async () => value);
    await act(async () => container.querySelector<HTMLElement>(".pdf-block-hit-area")!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('.paragraph-tabs [data-operation="translate"]')!.click());
    expect(stream.mock.calls[0][1]).toMatchObject({ operation: "translate" });
    expect(container.querySelector(".assistant-translation")?.textContent).toContain("注意力机制");
    value = '{"summary":"段落摘要","role":"段落作用"}';
    await act(async () => container.querySelector<HTMLButtonElement>('.paragraph-tabs [data-operation="insight"]')!.click());
    expect(stream.mock.calls[1][1]).toMatchObject({ operation: "insight" });
    expect(container.querySelector(".assistant-insight")?.textContent).toContain("段落作用");
    expect(container.querySelector(".assistant-translation")).toBeNull();
    value = "这里的 attention 指注意力机制。";
    await act(async () => container.querySelector<HTMLButtonElement>('.paragraph-tabs [data-operation="explain"]')!.click());
    expect(stream.mock.calls[2][1]).toMatchObject({ operation: "explain" });
    expect(container.querySelector(".assistant-explanation")?.textContent).toContain("attention");
    expect(container.querySelector(".assistant-insight")).toBeNull();
    for (const operation of ["translate", "insight", "explain"]) {
      await act(async () => container.querySelector<HTMLButtonElement>(`.paragraph-tabs [data-operation="${operation}"]`)!.click());
    }
    expect(stream).toHaveBeenCalledTimes(3);
    expect(container.querySelector(".assistant-original")).toBeNull();
    await act(async () => root.unmount()); container.remove();
  });

  it("excludes a covered PDF from keyboard focus while the narrow assistant is open", async () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn() });
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const { container, root } = await mount(async () => "");
    const document = container.querySelector<HTMLElement>(".reader-document")!;
    expect(document.inert).toBe(true);
    expect(container.querySelector('[role="tab"][aria-selected="true"]')).toBe(globalThis.document.activeElement);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="收起助手"]')!.click());
    expect(document.inert).toBe(false);
    expect(container.querySelector('[aria-label="展开助手"]')).toBe(globalThis.document.activeElement);
    await act(async () => root.unmount()); container.remove();
  });

  it("prevents vocabulary enrichment from overlapping chart preprocessing", async () => {
    let finish!: (value: string) => void;
    const source = { ...paper, blockData: [{ ...paper.blockData[0], kind: "table" }, paper.blockData[1]] };
    const { container, root, stream } = await mount(async () => "", undefined, source);
    await act(async () => (container.querySelector(".pdf-block-hit-area") as HTMLElement).click());
    vi.mocked(loadChartImage).mockImplementationOnce(async () => new Promise((resolve) => { finish = resolve; }));
    await act(async () => container.querySelector<HTMLButtonElement>(".chart-context .secondary-button")!.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => item.textContent?.includes("学术词汇"))!.click());
    expect(container.querySelector<HTMLButtonElement>(".vocabulary-intro button")?.disabled).toBe(true);
    await act(async () => (container.querySelectorAll(".pdf-block-hit-area")[1] as HTMLElement).click());
    await act(async () => finish("data:image/png;base64,aGVsbG8="));
    expect(stream).not.toHaveBeenCalled();
    await act(async () => root.unmount()); container.remove();
  });
  it("immediately releases a cancelled chart action and suppresses an old error after A to B to A", async () => {
    let reject!: (error: unknown) => void;
    const source = { ...paper, blockData: paper.blockData.map((block) => ({ ...block, kind: "table" })) };
    const { container, root, stream } = await mount(async () => "", undefined, source);
    const blocks = container.querySelectorAll<HTMLElement>(".pdf-block-hit-area");
    await act(async () => blocks[0].click());
    vi.mocked(loadChartImage).mockImplementationOnce(async () => new Promise((_resolve, fail) => { reject = fail; }));
    await act(async () => container.querySelector<HTMLButtonElement>(".chart-context .secondary-button")!.click());
    await act(async () => blocks[1].click());
    expect(container.querySelector<HTMLButtonElement>(".chart-context .secondary-button")?.disabled).toBe(false);
    expect(container.querySelector(".chart-reading-progress")).toBeNull();
    await act(async () => blocks[0].click());
    await act(async () => reject(new Error("旧图表处理失败")));
    expect(container.querySelector(".assistant-action-error")).toBeNull();
    expect(stream).not.toHaveBeenCalled();
    await act(async () => root.unmount()); container.remove();
  });

  it("does not cache a failed or malformed chart response", async () => {
    const source = { ...paper, blockData: [{ ...paper.blockData[0], kind: "image" }, paper.blockData[1]] };
    const { container, root, stream } = await mount(async () => '{"summary":"partial"}', undefined, source);
    await act(async () => (container.querySelector(".pdf-block-hit-area") as HTMLElement).click());
    await act(async () => container.querySelector<HTMLButtonElement>(".chart-context .secondary-button")!.click());
    expect(container.querySelector(".assistant-action-error")?.textContent).toContain("结构不完整");
    expect(container.querySelector(".assistant-chart-reading")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(".chart-context .secondary-button")!.click());
    expect(stream).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount()); container.remove();
  });
  it("preserves the error message delivered by Electron's isolated preload realm", async () => {
    const { container, root } = await mount(async () => { throw { name: "Error", message: "模型请求超时，请重试" }; });
    await act(async () => (container.querySelector(".pdf-block-hit-area") as HTMLElement).click());
    await act(async () => [...container.querySelectorAll("button")].find((item) => item.textContent === "翻译整段")!.click());
    expect(container.querySelector(".assistant-action-error")?.textContent).toContain("模型请求超时");
    await act(async () => root.unmount()); container.remove();
  });

  it("routes a table to image-based chart reading, renders structured findings, and reuses its cache", async () => {
    const value = JSON.stringify({ summary: "比较模型成绩", encoding: "NQ 是准确率，越高越好", findings: ["RAG 为 44.5"], role: "支持方法有效性", caveats: ["不能比较不同数据集的分数"] });
    const source = { ...paper, blockData: [{ ...paper.blockData[0], kind: "table", text: "<table><tr><td>RAG</td><td>44.5</td></tr></table>", caption: "Table 1. Results" }, paper.blockData[1]] };
    const { container, root, stream } = await mount(async () => value, undefined, source);
    await act(async () => (container.querySelector(".pdf-block-hit-area") as HTMLElement).click());
    expect([...container.querySelectorAll("button")].some((item) => item.textContent === "翻译整段")).toBe(false);
    expect(container.querySelector(".selected-context")?.textContent).not.toContain("<table>");
    const read = container.querySelector<HTMLButtonElement>(".chart-context .secondary-button")!;
    await act(async () => read.click());
    expect(stream.mock.calls[0][1]).toMatchObject({ operation: "chart", imageDataUrl: "data:image/png;base64,aGVsbG8=", block: { kind: "table" } });
    expect(container.querySelector(".assistant-chart-reading")?.textContent).toContain("RAG 为 44.5");
    await act(async () => read.click());
    expect(stream).toHaveBeenCalledOnce();
    await act(async () => root.unmount()); container.remove();
  });
  it("renders chart-reading deltas before the structured result is complete", async () => {
    const value = JSON.stringify({ summary: "比较模型成绩", encoding: "NQ 是准确率，越高越好", findings: ["RAG 为 44.5"], role: "支持方法有效性", caveats: ["不能比较不同数据集的分数"] });
    const source = { ...paper, blockData: [{ ...paper.blockData[0], kind: "table", text: "<table><tr><td>RAG</td><td>44.5</td></tr></table>", caption: "Table 1. Results" }, paper.blockData[1]] };
    let finish!: (text: string) => void;
    let emit!: (text: string) => void;
    const { container, root, stream } = await mount(
      () => new Promise((resolve) => { finish = resolve; }),
      async (onDelta) => {
        emit = onDelta;
        return new Promise((resolve) => { finish = resolve; });
      },
      source,
    );
    await act(async () => (container.querySelector(".pdf-block-hit-area") as HTMLElement).click());
    await act(async () => container.querySelector<HTMLButtonElement>(".chart-context .secondary-button")!.click());
    await vi.waitFor(() => expect(stream).toHaveBeenCalledOnce());
    await act(async () => emit('{"summary":"图表正在'));
    const surface = container.querySelector(".assistant-chart-reading")!;
    expect(surface.textContent).toContain("图表正在");
    expect(surface.getAttribute("aria-busy")).toBe("true");
    expect(surface.textContent).not.toContain("summary");
    expect(window.localStorage.getItem("zhiyan-workbench.analysis.v1")).not.toContain("图表正在");
    await act(async () => finish(value));
    expect(container.querySelector(".assistant-chart-reading")).toBe(surface);
    expect(surface.getAttribute("aria-busy")).toBe("false");
    expect(container.querySelector(".assistant-chart-reading")?.textContent).toContain("RAG 为 44.5");
    await act(async () => root.unmount()); container.remove();
  });
  it("uses the complete paragraph by default and displays its Chinese result beside the selection", async () => {
    const { container, root, stream } = await mount(async () => "模型使用注意力机制。它效果很好。");
    await act(async () => (container.querySelector(".pdf-block-hit-area") as HTMLElement).click());
    const translate = [...container.querySelectorAll("button")].find((item) => item.textContent === "翻译整段")!;
    expect(translate.disabled).toBe(false);
    await act(async () => translate.click());
    const call = stream.mock.calls[0] as unknown as [string, { block: { text: string } }];
    expect(call[1].block.text).toBe(paper.blockData[0].text);
    expect(container.querySelector(".assistant-translation")?.textContent).toContain("模型使用注意力机制");
    await act(async () => root.unmount()); container.remove();
  });

  it("does not show a previous paragraph's late result under a new selection", async () => {
    let finish!: (text: string) => void;
    const { container, root } = await mount(() => new Promise((resolve) => { finish = resolve; }));
    const blocks = container.querySelectorAll<HTMLElement>(".pdf-block-hit-area");
    await act(async () => blocks[0].click());
    const translate = [...container.querySelectorAll("button")].find((item) => item.textContent === "翻译整段")!;
    await act(async () => translate.click());
    await act(async () => blocks[1].click());
    await act(async () => finish("第一段的中文译文"));
    expect(blocks[1].getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".selected-block-text")).toBeNull();
    expect(container.querySelector(".assistant-translation")).toBeNull();
    await act(async () => root.unmount()); container.remove();
  });

  it("renders the first streamed translation delta before the model finishes", async () => {
    let finish!: (text: string) => void;
    let emit!: (text: string) => void;
    const { container, root, stream } = await mount(
      () => new Promise((resolve) => { finish = resolve; }),
      async (onDelta) => {
        emit = onDelta;
        return new Promise((resolve) => { finish = resolve; });
      },
    );
    await act(async () => (container.querySelector(".pdf-block-hit-area") as HTMLElement).click());
    const translate = [...container.querySelectorAll("button")].find((item) => item.textContent === "翻译整段")!;
    await act(async () => translate.click());
    expect(container.querySelector(".settings-dialog")).toBeNull();
    await vi.waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(emit).toBeTypeOf("function");
    await act(async () => emit("首 token 已到"));

    expect(container.querySelector(".assistant-translation p")?.textContent).toBe("首 token 已到");
    await act(async () => finish("首 token 已到完整译文"));
    expect(container.querySelector(".assistant-translation p")?.textContent).toBe("首 token 已到完整译文");
    await act(async () => root.unmount()); container.remove();
  });

  it("displays a newly requested answer without relying on an existing cache", async () => {
    const { container, root } = await mount(async () => "本文提出一种新的模型，第1页提供依据。");
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="向论文提问"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "论文解决什么问题？");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => (container.querySelector('[aria-label="发送问题"]') as HTMLButtonElement).click());
    expect(container.querySelector(".answer-copy")?.textContent).toContain("提出一种新的模型");
    await act(async () => root.unmount()); container.remove();
  });
});
