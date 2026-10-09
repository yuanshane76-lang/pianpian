import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/app/App";
import { DEFAULT_SERVICE_SETTINGS, toPublicServiceSettings } from "../../src/domain/serviceSettings";
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
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
HTMLElement.prototype.scrollIntoView = vi.fn();
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: vi.fn(() => ({})),
});

const paper = {
  id: "interaction-paper", title: "Paper", authors: [], year: null, sourcePath: "local://interaction", originalId: "interaction-document", pageCount: 1,
  importedAt: "2026-10-04", tags: [], favorite: false, overview: null, blocks: 2, parseVersion: 2,
  blockData: [
    { id: "p001-b001", kind: "paragraph", pageNumber: 1, order: 0, text: "The model uses attention. It works well.", bbox: [0.1, 0.1, 0.9, 0.2] },
    { id: "p001-b002", kind: "paragraph", pageNumber: 1, order: 1, text: "A different paragraph.", bbox: [0.1, 0.3, 0.9, 0.4] },
  ],
};
const settings = toPublicServiceSettings({ ...DEFAULT_SERVICE_SETTINGS, aiProvider: "deepseek", deepseek: { ...DEFAULT_SERVICE_SETTINGS.deepseek, apiKey: "test" } });
let settingsRevision = 0;
afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); delete window.zhiyan; });

async function mount(response: () => Promise<string>, streamResponse?: (onDelta: (text: string) => void) => Promise<string>) {
  window.localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([paper]));
  const currentSettings = { ...settings, revision: `test-${++settingsRevision}` };
  const invoke = vi.fn(async (channel: string) => {
    if (channel === "zhiyan:settings:get") return currentSettings;
    if (channel === "zhiyan:documents:states") return [];
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
    expect(container.querySelector(".selected-block-text")?.textContent).toBe("A different paragraph.");
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
