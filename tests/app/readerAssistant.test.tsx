import { act, useEffect, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderAssistant } from "../../src/features/reader/ReaderAssistant";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement;
const writeText = vi.fn(async (_text: string) => undefined);

async function mount(overrides: Partial<ComponentProps<typeof ReaderAssistant>> = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const props: ComponentProps<typeof ReaderAssistant> = {
    selectedBlock: { id: "p1-b1", kind: "paragraph", pageNumber: 1, order: 0, text: "Retrieval augments the language model with external knowledge." },
    originalId: "paper", chartReading: null, onReadChart: vi.fn(),
    answer: null, isBusy: false,
    onTranslate: vi.fn(), onExplain: vi.fn(), explanation: null, onAsk: vi.fn(),
    translation: "检索为语言模型补充外部知识。", selectionText: "", serviceLabel: "DeepSeek",
    serviceModel: "deepseek-flash", aiAvailable: true, onOpenSettings: vi.fn(), actionError: null,
    pendingAction: null, insight: null, streamingOutput: null, onInsight: vi.fn(), guide: null,
    onGuide: vi.fn(), vocabulary: [],
    onJump: vi.fn(),
    ...overrides,
  };
  await act(async () => root!.render(<ReaderAssistant {...props} />));
  return props;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.restoreAllMocks();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
});

describe("chart result streaming", () => {
  it("reveals a cached chart result when another double-click starts from the research tab", async () => {
    const props = await mount({ selectedBlock: { id: "chart", kind: "image", pageNumber: 1, order: 0, text: "Figure" },
      researchPanel: <div>研究对话内容</div>, chartReading: { summary: "比较模型", encoding: "读指标", findings: ["发现"],
        role: "作用", caveats: ["限制"] } });
    await act(async () => container.querySelector<HTMLButtonElement>('[role="tab"]:last-child')!.click());
    expect(container.querySelector('[role="tab"]:last-child')?.getAttribute("aria-selected")).toBe("true");
    await act(async () => root!.render(<ReaderAssistant {...props} chartAnalysisRequestId={1} />));
    expect(container.querySelector('[role="tab"]')?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector(".assistant-chart-reading")?.textContent).toContain("比较模型");
  });
  it("renders Markdown in the same result surface during streaming and completion", async () => {
    const props = await mount({ selectedBlock: { id: "chart", kind: "image", pageNumber: 1, order: 0, text: "Figure" },
      isBusy: true, pendingAction: "chart", streamingOutput: { operation: "chart", text: '{"summary":"**比较对象**与 $x$' } });
    const surface = container.querySelector(".assistant-chart-reading")!;
    expect(surface).not.toBeNull();
    expect(surface.getAttribute("aria-busy")).toBe("true");
    expect(surface.querySelector(".markdown-content strong")?.textContent).toBe("比较对象");
    expect(surface.querySelector(".katex")).not.toBeNull();
    const reading = { summary: "**比较对象**与 $x$", encoding: "指标", findings: ["**发现**"], role: "作用", caveats: ["限制"] };
    await act(async () => root!.render(<ReaderAssistant {...props} isBusy={false} pendingAction={null}
      streamingOutput={null} chartReading={reading} />));
    expect(container.querySelector(".assistant-chart-reading")).toBe(surface);
    expect(surface.getAttribute("aria-busy")).toBe("false");
    expect(surface.querySelectorAll(".markdown-content strong")).toHaveLength(2);
  });
});

describe("reader assistant layout", () => {
  it("has no whole-paper overview and displays independent insight and vocabulary loading from quick analysis", async () => {
    await mount({ isBusy: true, pendingParagraphActions: ["translate", "explain", "insight", "vocabulary"] });
    expect(container.querySelector(".assistant-overview")).toBeNull();
    expect(container.querySelector('[data-operation="insight"] .spin')).not.toBeNull();
    const tabs = container.querySelectorAll<HTMLButtonElement>(".assistant-tabs [role='tab']");
    expect(tabs[1].querySelector(".spin")).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-operation="insight"]')!.click());
    expect(container.querySelector(".paragraph-progress")?.textContent).toContain("正在生成摘要与作用");
    await act(async () => tabs[1].click());
    expect(container.querySelector(".vocabulary-intro")?.textContent).toContain("正在挑选段落词汇");
  });

  it("keeps AI vocabulary opt-in until the user asks for it", async () => {
    await mount({ vocabulary: [{ term: "attention", translation: "注意力", definition: "重点", example: "attention", blockId: "p1-b1", pageNumber: 1, count: 1, source: "local" }] });
    const vocabularyTab = container.querySelector<HTMLButtonElement>("#vocabulary-tab, [id$='-vocabulary-tab']")!;
    await act(async () => vocabularyTab.click());
    expect(container.querySelector(".vocabulary-card")).toBeNull();
    expect(container.querySelector(".vocabulary-intro")?.textContent).toContain("双击段落后自动精选");
    expect(container.querySelector(".vocabulary-intro button")?.textContent).toContain("AI 精选本段词汇");
  });

  it("mounts research only after its tab is visited and keeps it mounted across tab changes", async () => {
    const mounted = vi.fn(), unmounted = vi.fn();
    function Probe() { useEffect(() => { mounted(); return unmounted; }, []); return <div>研究内容</div>; }
    await mount({ researchPanel: <Probe /> });
    expect(mounted).not.toHaveBeenCalled();
    const research = container.querySelector<HTMLButtonElement>('[id$="-research-tab"]')!;
    await act(async () => research.click());
    expect(mounted).toHaveBeenCalledOnce();
    await act(async () => container.querySelector<HTMLButtonElement>('[id$="-assist-tab"]')!.click());
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("prioritizes the selected paragraph without duplicating the original text", async () => {
    await mount();
    expect(container.querySelector(".assistant-scroll")?.firstElementChild?.classList.contains("selected-context")).toBe(true);
    expect(container.querySelector(".assistant-original")).toBeNull();
    expect(container.querySelector(".selected-block-text")).toBeNull();
    expect(container.textContent).not.toContain("英文原文");
    expect(container.textContent).not.toContain("Retrieval augments");
  });

  it("shows only the active result even when all three results are available", async () => {
    const props = await mount({ insight: { summary: "这段概括", role: "段落作用" }, explanation: "完整解释" });
    const tabs = container.querySelectorAll<HTMLButtonElement>('.paragraph-tabs [role="tab"]');
    expect(tabs.length).toBe(3);
    expect([...tabs].map((item) => item.textContent)).toEqual(["翻译", "摘要与作用", "解释"]);
    expect(container.querySelector(".assistant-translation")).not.toBeNull();
    expect(container.querySelector(".assistant-insight")).toBeNull();
    expect(container.querySelector(".assistant-explanation")).toBeNull();
    await act(async () => tabs[1].click());
    expect(container.querySelector(".assistant-insight")?.textContent).toContain("段落作用");
    expect(container.querySelector(".assistant-translation")).toBeNull();
    await act(async () => tabs[2].click());
    expect(container.querySelector(".assistant-explanation")?.textContent).toContain("完整解释");
    expect(container.querySelector(".assistant-insight")).toBeNull();
    await act(async () => tabs[0].click());
    expect(container.querySelector(".assistant-translation p")?.textContent).toBe(props.translation);
    expect(props.onTranslate).not.toHaveBeenCalled();
    expect(props.onInsight).not.toHaveBeenCalled();
    expect(props.onExplain).not.toHaveBeenCalled();
  });

  it("requests missing results from the selected tab without overlapping another request", async () => {
    const props = await mount();
    const explain = container.querySelector<HTMLButtonElement>('.paragraph-tabs [data-operation="explain"]');
    expect(explain).not.toBeNull();
    await act(async () => explain!.click());
    expect(props.onExplain).toHaveBeenCalledOnce();
    await act(async () => root!.render(<ReaderAssistant {...props} isBusy pendingAction="explain" />));
    const summary = container.querySelector<HTMLButtonElement>('.paragraph-tabs [data-operation="insight"]')!;
    await act(async () => summary.click());
    expect(summary.getAttribute("aria-selected")).toBe("true");
    expect(props.onInsight).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLButtonElement>('[aria-label="段落摘要与作用"]')?.disabled).toBe(true);
  });

  it("supports keyboard navigation between the three result tabs without making AI requests", async () => {
    const props = await mount();
    const tabs = container.querySelectorAll<HTMLButtonElement>('.paragraph-tabs [role="tab"]');
    expect(tabs.length).toBe(3);
    tabs[0].focus();
    await act(async () => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1]);
    expect(container.querySelector(".paragraph-result")?.id).toBe(tabs[1].getAttribute("aria-controls"));
    expect(props.onInsight).not.toHaveBeenCalled();
    await act(async () => tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    expect(props.onExplain).not.toHaveBeenCalled();
  });

  it("preserves keyboard focus when a generation button is replaced by loading output", async () => {
    const props = await mount();
    const tabs = container.querySelectorAll<HTMLButtonElement>('.paragraph-tabs [role="tab"]');
    await act(async () => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    const generate = container.querySelector<HTMLButtonElement>('[aria-label="段落摘要与作用"]')!;
    generate.focus();
    await act(async () => generate.click());
    await act(async () => root!.render(<ReaderAssistant {...props} isBusy pendingAction="insight" />));
    expect(document.activeElement).toBe(tabs[1]);
    expect(container.querySelector(".paragraph-progress")).not.toBeNull();
  });

  it("keeps the question composer outside the result scroller with a visible label", async () => {
    await mount();
    const composer = container.querySelector(".assistant-composer");
    expect(composer).not.toBeNull();
    expect(container.querySelector(".assistant-scroll")?.contains(composer)).toBe(false);
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="向论文提问"]')!;
    expect(container.querySelector("label")?.htmlFor).toBe(textarea.id);
    expect(container.textContent).not.toContain("按快捷键");
  });

  it("connects tabs to their panels and switches with arrow keys", async () => {
    await mount();
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[0].focus();
    await act(async () => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].tabIndex).toBe(0);
    expect(tabs[0].tabIndex).toBe(-1);
    expect(container.querySelector('[role="tabpanel"]')?.id).toBe(tabs[1].getAttribute("aria-controls"));
    expect(container.querySelector(".assistant-composer")).not.toBeNull();
  });

  it("confirms a successful translation copy", async () => {
    await mount();
    const button = container.querySelector<HTMLButtonElement>('[aria-label="复制译文"]');
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(writeText).toHaveBeenCalledWith("检索为语言模型补充外部知识。");
    expect(container.querySelector('[aria-label="已复制译文"]')).not.toBeNull();
  });

  it("renders the generator formula from the translation instead of exposing LaTeX", async () => {
    const formula = String.raw`p _ { \theta } ( y _ { i } | x , z , y _ { 1 : i - 1 } )`;
    await mount({ translation: `生成器组件 $${formula}$ 可以采用任意编码器-解码器进行建模。BART [32]。` });
    const content = container.querySelector(".assistant-translation p")!;
    expect(content.querySelectorAll(".katex")).toHaveLength(1);
    expect(content.querySelector("math")).not.toBeNull();
    expect(content.querySelector("annotation")?.textContent).toBe(formula);
    expect(content.textContent).toContain("可以采用任意编码器-解码器");
    expect(content.textContent).toContain("BART [32]");
  });

  it("supports inline and display math without losing paragraph breaks", async () => {
    const translation = String.raw`概率 $p_{\theta}(y_i)$ 与分数 \(\frac{a}{b}\)。

$$\sum_{i=1}^{n} x_i^2$$
\[\theta = \frac{1}{n}\sum_i x_i\]`;
    await mount({ translation });
    const content = container.querySelector(".assistant-translation p")!;
    expect(content.querySelectorAll(".katex")).toHaveLength(4);
    expect(content.querySelectorAll(".katex-display")).toHaveLength(2);
    expect(content.textContent).toContain("\n\n");
    expect(content.querySelectorAll(".mfrac").length).toBeGreaterThan(0);
  });

  it("renders a streamed formula only after it closes and never duplicates previous output", async () => {
    const props = await mount({ translation: String.raw`已有 $x_i$，生成器 $p_{\theta}`, isBusy: true, pendingAction: "translate" });
    const content = () => container.querySelector(".assistant-translation p")!;
    expect(content().querySelectorAll(".katex")).toHaveLength(1);
    expect(content().textContent).toContain(String.raw`$p_{\theta}`);
    await act(async () => root!.render(<ReaderAssistant {...props} translation={String.raw`已有 $x_i$，生成器 $p_{\theta}(y_i)$。`} />));
    expect(content().querySelectorAll(".katex")).toHaveLength(2);
    await act(async () => root!.render(<ReaderAssistant {...props} translation={String.raw`已有 $x_i$，生成器 $p_{\theta}(y_i)$。下一句。`} />));
    expect(content().querySelectorAll(".katex")).toHaveLength(2);
    expect(content().textContent).toContain("下一句。");
    await act(async () => root!.render(<ReaderAssistant {...props} selectedBlock={{ ...props.selectedBlock!, id: "p1-b2" }} translation="另一段纯文本。" pendingAction={null} isBusy={false} />));
    expect(content().querySelector(".katex")).toBeNull();
    expect(content().textContent).toBe("另一段纯文本。");
  });

  it("keeps unsupported math readable without stopping other formulas", async () => {
    await mount({ translation: String.raw`异常 $\notARealCommand{x}$，正常 $x^2$。` });
    const content = container.querySelector(".assistant-translation p")!;
    expect(content.textContent).toContain(String.raw`$\notARealCommand{x}$`);
    expect(content.querySelectorAll(".katex")).toHaveLength(1);
    expect(content.querySelector(".katex-error")).toBeNull();
  });

  it("keeps model-provided HTML literal and disables trusted math commands", async () => {
    await mount({ translation: String.raw`<img src=x onerror=alert(1)> $x_i$ $\href{https://example.com}{x}$` });
    const content = container.querySelector(".assistant-translation p")!;
    expect(content.querySelector("img")).toBeNull();
    expect(content.querySelector("a")).toBeNull();
    expect(content.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(content.querySelector(".katex")).not.toBeNull();
  });

  it("retains all source arguments when a math command requires trust", async () => {
    const blocked = String.raw`$\href{https://example.com}{visible label}$ 与 $\htmlClass{ignored}{x_i}$`;
    await mount({ translation: `${blocked}，正常 $y_i$。` });
    const content = container.querySelector(".assistant-translation p")!;
    expect(content.querySelectorAll(".katex")).toHaveLength(1);
    expect(content.textContent).toContain(blocked);
    expect(content.querySelector("a")).toBeNull();
    expect(content.querySelector(".ignored")).toBeNull();
  });

  it("does not treat escaped currency delimiters as the start of math", async () => {
    await mount({ translation: String.raw`价格 \$5 和 \$10，公式 $x_i$。` });
    const content = container.querySelector(".assistant-translation p")!;
    expect(content.textContent).toContain(String.raw`价格 \$5 和 \$10，公式`);
    expect(content.querySelectorAll(".katex")).toHaveLength(1);
    expect(content.querySelector("annotation")?.textContent).toBe("x_i");
  });

  it("recovers after unmatched braces so the following valid formula still renders", async () => {
    await mount({ translation: String.raw`异常 $\frac{a}{b$，正常 $x^2$。` });
    const content = container.querySelector(".assistant-translation p")!;
    expect(content.textContent).toContain(String.raw`$\frac{a}{b$`);
    expect(content.querySelectorAll(".katex")).toHaveLength(1);
    expect(content.querySelector("annotation")?.textContent).toBe("x^2");
  });

  it("keeps unexpectedly deep math readable without unmounting the assistant", async () => {
    const deep = `$${"{".repeat(5000)}x${"}".repeat(5000)}$`;
    await mount({ translation: `异常 ${deep}，正常 $y_i$。` });
    const content = container.querySelector(".assistant-translation p")!;
    expect(content.textContent).toContain(deep);
    expect(content.querySelectorAll(".katex")).toHaveLength(1);
    expect(container.querySelector(".assistant-composer")).not.toBeNull();
  });

  it("renders the actual streamingOutput path and retains math on completion", async () => {
    const props = await mount({ translation: null, isBusy: true, pendingAction: "translate", streamingOutput: { operation: "translate", text: String.raw`概率 $p_{\theta}` } });
    expect(container.querySelector(".assistant-translation .katex")).toBeNull();
    const complete = String.raw`概率 $p_{\theta}(y_i)$。`;
    await act(async () => root!.render(<ReaderAssistant {...props} streamingOutput={{ operation: "translate", text: complete }} />));
    expect(container.querySelectorAll(".assistant-translation .katex")).toHaveLength(1);
    await act(async () => root!.render(<ReaderAssistant {...props} translation={complete} streamingOutput={null} pendingAction={null} isBusy={false} />));
    expect(container.querySelectorAll(".assistant-translation .katex")).toHaveLength(1);
    expect(container.querySelector('[aria-label="复制译文"]')).not.toBeNull();
  });

  it("copies original formula source rather than KaTeX markup or duplicate accessible text", async () => {
    const translation = String.raw`概率为 $p_{\theta}(y_i)$，见 [32]。`;
    await mount({ translation });
    expect(container.querySelector(".assistant-translation .katex")).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="复制译文"]')!.click());
    expect(writeText).toHaveBeenCalledWith(translation);
  });

  it("handles a clipboard failure inline", async () => {
    await mount();
    writeText.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    const button = container.querySelector<HTMLButtonElement>('[aria-label="复制译文"]');
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(container.querySelector(".assistant-copy-status")?.textContent).toContain("复制失败");
  });

  it("marks streaming translation as busy without offering to copy partial output", async () => {
    await mount({ isBusy: true, pendingAction: "translate", streamingOutput: { operation: "translate", text: "检索为" }, translation: "检索为" });
    expect(container.querySelector(".assistant-translation")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".assistant-translation")?.textContent).toContain("翻译中");
    expect(container.querySelector('[aria-label="复制译文"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[aria-label="发送问题"]')?.disabled).toBe(true);
  });

  it("keeps question failures visible when the vocabulary tab is selected", async () => {
    await mount({ actionError: "模型请求失败" });
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    await act(async () => tabs[1].click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("模型请求失败");
    expect(container.querySelectorAll('[role="alert"]').length).toBe(1);
  });

  it("does not send a keyboard question before an AI service is available", async () => {
    const props = await mount({ aiAvailable: false });
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "论文解决什么问题？");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })));
    expect(props.onAsk).not.toHaveBeenCalled();
    expect(textarea.value).toBe("论文解决什么问题？");
  });

  it("brings a newly requested answer into view without waiting for all output", async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: undefined });
    vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(scrollTo);
    await mount({ isBusy: true, pendingAction: "qa" });
    expect(container.querySelector(".qa-section")).not.toBeNull();
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: expect.any(Number), behavior: "auto" }));
  });

  it("reveals an already cached answer when the same question is submitted again", async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: undefined });
    vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(scrollTo);
    await mount({ answer: "缓存回答" });
    scrollTo.mockClear();
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "论文解决什么问题？");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="发送问题"]')!.click());
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "auto" }));
  });
});
