import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/app/App";
import type { PaperRecord } from "../../src/domain/library";
import { DEFAULT_SERVICE_SETTINGS, toPublicServiceSettings } from "../../src/domain/serviceSettings";
import { openPdf } from "../../src/services/document";

vi.mock("../../src/services/originalPdf", () => ({
  readOriginalPdf: vi.fn(async () => new ArrayBuffer(8)),
}));
vi.mock("../../src/services/document", () => ({
  openPdf: vi.fn(async () => ({
    numPages: 2,
    getPage: vi.fn(async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    })),
    destroy: vi.fn(async () => undefined),
  })),
}));
vi.mock("../../src/services/pdfTextLayer", () => ({
  renderPdfTextLayer: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: () => ({}),
});
HTMLElement.prototype.scrollIntoView = vi.fn();

const paper: PaperRecord = {
  id: "navigation-paper", title: "返回阅读回归论文", authors: [], year: null,
  originalId: "navigation-original", sourcePath: "local://navigation-original",
  importedAt: "2026-10-10", groupId: "group-inbox", favorite: true, parseStatus: "ready", parseVersion: 2,
  pageCount: 2, blocks: 1, readingPosition: { mode: "pdf", page: 2 },
  blockData: [{
    id: "page-two-paragraph", kind: "paragraph", pageNumber: 2, order: 0,
    text: "The model uses attention to select relevant features.", bbox: [.1, .1, .9, .2],
  }],
};
const settings = toPublicServiceSettings({
  ...DEFAULT_SERVICE_SETTINGS,
  aiProvider: "deepseek",
  deepseek: { ...DEFAULT_SERVICE_SETTINGS.deepseek, apiKey: "synthetic-test" },
});
const mounted: Array<{ root: Root; container: HTMLElement }> = [];

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete window.zhiyan;
});

async function mount() {
  window.localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([paper]));
  const stream = vi.fn();
  window.zhiyan = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === "zhiyan:settings:get") return settings;
      if (channel === "zhiyan:documents:states") return [{
        paperId: paper.id, task: { state: "done" }, result: { blocks: paper.blockData },
      }];
      return undefined;
    }) as never,
    stream: stream as never,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(<App />));
  return { container, stream };
}

async function openReader(container: HTMLElement) {
  const open = [...container.querySelectorAll("button")].find((button) => button.textContent === "打开阅读");
  expect(open?.disabled).toBe(false);
  await act(async () => open!.click());
  expect(container.querySelector(".reader-shell")).not.toBeNull();
  await vi.waitFor(() => expect(container.querySelector(".pdf-block-hit-area")).not.toBeNull());
}

describe("reader return navigation", () => {
  it("returns to the selected paper and repeatedly reopens its saved PDF page", async () => {
    const { container, stream } = await mount();
    for (let cycle = 0; cycle < 3; cycle++) {
      await openReader(container);
      expect(container.querySelector<HTMLInputElement>('[aria-label="PDF 页码"]')?.value).toBe("2");
      await act(async () => container.querySelector<HTMLButtonElement>(".back-button")!.click());
      expect(container.querySelector(".reader-shell")).toBeNull();
      expect(container.querySelector(".workspace-shell")).not.toBeNull();
      expect(container.querySelector(".paper-row.is-selected")?.textContent).toContain(paper.title);
      expect(container.querySelector(".detail-content h2")?.textContent).toBe(paper.title);
    }
    expect(stream).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem("zhiyan-workbench.papers.v1")!)[0].readingPosition.page).toBe(2);
  });

  it("cancels pending analysis on return and discards late output before reopening", async () => {
    const { container, stream } = await mount();
    let emit!: (text: string) => void;
    let finish!: (text: string) => void;
    const cancel = vi.fn();
    stream.mockImplementation(async (_channel, _payload, onDelta, onAbort) => {
      emit = onDelta;
      onAbort(cancel);
      return new Promise<string>((resolve) => { finish = resolve; });
    });
    await openReader(container);
    await act(async () => container.querySelector<HTMLElement>(".pdf-block-hit-area")!.click());
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "翻译整段")!.click());
    expect(stream).toHaveBeenCalledOnce();
    expect(container.querySelector(".assistant-translation")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => emit("未完成译文"));
    expect(container.querySelector(".assistant-translation")?.textContent).toContain("未完成译文");
    await act(async () => container.querySelector<HTMLButtonElement>(".back-button")!.click());
    expect(cancel).toHaveBeenCalledOnce();
    expect(container.querySelector(".workspace-shell")).not.toBeNull();
    await act(async () => {
      emit("晚到译文");
      finish("晚到译文");
    });
    await openReader(container);
    expect(container.textContent).not.toContain("未完成译文");
    expect(container.textContent).not.toContain("晚到译文");
    expect(container.querySelector('.reader-assistant [aria-busy="true"]')).toBeNull();
    expect(window.localStorage.getItem("zhiyan-workbench.analysis.v1")).not.toContain("晚到译文");
    const translateAgain = [...container.querySelectorAll("button")].find((button) => button.textContent === "翻译整段");
    expect(translateAgain?.disabled).toBe(false);
    stream.mockResolvedValueOnce("新请求译文");
    await act(async () => translateAgain!.click());
    expect(stream).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".assistant-translation")?.textContent).toContain("新请求译文");
    expect(container.querySelector(".assistant-translation")?.getAttribute("aria-busy")).toBe("false");
  });

  it("cancels all four paragraph requests on return without exposing AbortError", async () => {
    const { container, stream } = await mount();
    const cancels: Array<ReturnType<typeof vi.fn>> = [];
    stream.mockImplementation(async (_channel, _payload, _onDelta, onAbort) => new Promise((_resolve, reject) => {
      const cancel = vi.fn(() => reject(new DOMException("请求已取消", "AbortError")));
      cancels.push(cancel);
      onAbort(cancel);
    }));
    await openReader(container);
    await act(async () => container.querySelector<HTMLElement>(".pdf-block-hit-area")!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(stream).toHaveBeenCalledTimes(4);
    expect(container.querySelector(".assistant-translation")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => container.querySelector<HTMLButtonElement>(".back-button")!.click());
    for (const cancel of cancels) expect(cancel).toHaveBeenCalledOnce();
    expect(container.querySelector(".workspace-shell")).not.toBeNull();
    await openReader(container);
    expect(container.querySelector(".assistant-action-error")).toBeNull();
    expect(container.querySelector('.reader-assistant [aria-busy="true"]')).toBeNull();
    const outputs: Record<string, string> = {
      translate: "新请求译文", explain: "新请求解释",
      insight: '{"summary":"新请求摘要","role":"新请求作用"}',
      vocabulary: '{"overview":"新请求词汇重点","terms":[]}',
    };
    stream.mockImplementation(async (_channel, payload, onDelta) => {
      const output = outputs[payload.operation];
      onDelta(output);
      return output;
    });
    await act(async () => container.querySelector<HTMLElement>(".pdf-block-hit-area")!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(stream).toHaveBeenCalledTimes(8);
    expect(container.querySelector(".assistant-translation")?.textContent).toContain("新请求译文");
    expect(container.querySelector(".assistant-action-error")).toBeNull();
    expect(container.querySelector('.reader-assistant [aria-busy="true"]')).toBeNull();
  });

  it("stays in the library when a PDF finishes loading after return", async () => {
    const { container } = await mount();
    let finish!: (document: Awaited<ReturnType<typeof openPdf>>) => void;
    vi.mocked(openPdf).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "打开阅读")!.click());
    expect(container.querySelector(".reader-shell")).not.toBeNull();
    expect(container.querySelector(".pdf-page-stage")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(".back-button")!.click());
    const destroy = vi.fn(async () => undefined);
    await act(async () => finish({ numPages: 2, destroy } as never));
    expect(destroy).toHaveBeenCalledOnce();
    expect(container.querySelector(".workspace-shell")).not.toBeNull();
    expect(container.querySelector(".paper-row.is-selected")?.textContent).toContain(paper.title);
    await openReader(container);
    expect(container.querySelector<HTMLInputElement>('[aria-label="PDF 页码"]')?.value).toBe("2");
  });
});
