import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResearchAssistant } from "../../src/features/reader/ResearchAssistant";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
let emit: (event: unknown) => void;
const paper = { id: "p1", title: "Paper", authors: [], year: 2024, sourcePath: "local://p1",
  importedAt: "2026-10-12", tags: [], favorite: false, blocks: 1, blockData: [
    { id: "b1", pageNumber: 1, order: 0, kind: "paragraph" as const, text: "Evidence." },
  ] };

async function mount(available = true) {
  const invoke = vi.fn(async (channel: string): Promise<any> => channel === "zhiyan:agent:start" ? { sessionId: "s1" } : channel === "zhiyan:agent:skills" ? [] : channel === "zhiyan:agent:approve" ? true : undefined);
  window.zhiyan = { invoke: invoke as any, on: (_channel, handler) => { emit = handler as any; return () => {}; } };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onAddPaper = vi.fn(() => ({ id: "added", duplicate: false }));
  const onJump = vi.fn();
  await act(async () => root.render(<ResearchAssistant paper={paper} library={[paper]} onAddPaper={onAddPaper} onJump={onJump} available={available} onOpenSettings={vi.fn()} />));
  return { invoke, onAddPaper, onJump, rerender: async (id: string) => {
    await act(async () => root.render(<ResearchAssistant paper={{ ...paper, id }} library={[paper]} onAddPaper={onAddPaper} onJump={onJump} available={available} onOpenSettings={vi.fn()} />));
  } };
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  delete window.zhiyan;
  vi.unstubAllGlobals();
});

describe("research assistant", () => {
  it("loads the skill catalogue without starting a model session when credentials are missing", async () => {
    const { invoke } = await mount(false);
    expect(invoke).toHaveBeenCalledWith("zhiyan:agent:skills");
    expect(invoke).not.toHaveBeenCalledWith("zhiyan:agent:start", expect.anything());
    expect(container.querySelector(".research-agent-error")).toBeNull();
    expect(container.textContent).toContain("请先配置模型服务");
  });

  it("renders interleaved tool execution and working approval buttons", async () => {
    const { invoke, onAddPaper } = await mount();
    await act(async () => {
      emit({ type: "message_start", message: { id: "u1", role: "user", content: "加入论文" } });
      emit({ type: "tool_start", tool: { id: "t1", name: "add_paper_to_library", label: "加入文献库", status: "running", input: {} } });
      emit({ type: "approval_required", approvalId: "a1", toolCallId: "t1", paper: { title: "Result", authors: ["A"], year: 2024 } });
    });
    const approve = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("确认加入"))!;
    expect(approve).toBeTruthy();
    await act(async () => approve.click());
    expect(onAddPaper).toHaveBeenCalledWith(expect.objectContaining({ title: "Result" }));
    expect(invoke).toHaveBeenCalledWith("zhiyan:agent:approve", expect.objectContaining({ approvalId: "a1", approved: true, result: { id: "added", duplicate: false } }));
  });

  it("keeps whitespace in streamed replies and exposes generated documents", async () => {
    const mounted = await mount();
    await act(async () => {
      emit({ type: "message_delta", messageId: "m1", delta: "Hello" });
      emit({ type: "message_delta", messageId: "m1", delta: " world\n" });
      emit({ type: "tool_end", tool: { id: "t2", name: "create_document", label: "生成文档", status: "completed", input: {},
        output: { document: { title: "阅读笔记", markdown: "# 阅读笔记\n\nEvidence." } } } });
    });
    expect(container.textContent).toContain("Hello world");
    expect(container.querySelector('[aria-label="保存 Markdown 文档"]')).not.toBeNull();
  });

  it("renders message citations as jumpable article references", async () => {
    const { onJump } = await mount();
    await act(async () => emit({ type: "message_end", message: {
      id: "m1", role: "assistant", content: "结论见原文。", citations: [{ paperId: "p1", blockId: "b1", pageNumber: 1, label: "第 1 页 · 原文" }],
    } }));
    const citation = container.querySelector<HTMLButtonElement>(".research-message-citations button");
    expect(citation?.textContent).toContain("引用 1");
    expect(citation?.textContent).toContain("第 1 页");
    await act(async () => citation?.click());
    expect(onJump).toHaveBeenCalledWith("b1");
  });

  it("renders citations during streaming from read blocks and rejects foreign or missing blocks", async () => {
    const { onJump } = await mount();
    await act(async () => {
      emit({ type: "tool_end", tool: { id: "read", name: "read_current_paper", label: "读取当前论文",
        status: "completed", input: {}, output: { paper: { id: "p1", blocks: paper.blockData } } } });
      emit({ type: "message_delta", messageId: "answer", delta: "这是原文结论。[引用:b1]" });
    });
    const inline = container.querySelector<HTMLButtonElement>(".research-inline-citation");
    expect(inline?.textContent).toBe("[1]");
    await act(async () => inline!.click());
    expect(onJump).toHaveBeenCalledWith("b1");
    await act(async () => emit({ type: "message_end", message: { id: "answer", role: "assistant",
      content: "无效来源[引用:missing]。", citations: [
        { paperId: "other", blockId: "b1", label: "别的论文" },
        { paperId: "p1", blockId: "missing", label: "不存在的块" },
      ] } }));
    expect(container.querySelector(".research-message-citations")).toBeNull();
    expect(container.querySelector(".research-inline-citation")).toBeNull();
  });

  it("keeps search execution compact until its results are expanded", async () => {
    await mount();
    await act(async () => emit({ type: "tool_end", tool: { id: "search", name: "search_literature",
      label: "检索公开文献", status: "completed", input: { query: "deep research" },
      output: { papers: [{ title: "A search result", authors: [], year: 2024 }] } } }));
    expect(container.querySelector(".research-tool-summary")?.textContent).toContain("1 篇结果");
    expect(container.querySelector(".research-result-list")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(".research-tool-heading")!.click());
    expect(container.querySelector(".research-result-list")?.textContent).toContain("A search result");
  });

  it("does not write when an approval was stopped or invalidated in the main process", async () => {
    const { invoke, onAddPaper } = await mount();
    await act(async () => emit({ type: "approval_required", approvalId: "stale", toolCallId: "stale-tool",
      paper: { title: "Stale result", authors: [], year: 2024 } }));
    invoke.mockImplementation(async (channel: string) => channel === "zhiyan:agent:approve" ? false : undefined);
    await act(async () => (container.querySelector(".research-approval-actions button") as HTMLButtonElement).click());
    expect(onAddPaper).not.toHaveBeenCalled();
    expect(container.textContent).toContain("确认已失效");
    await act(async () => emit({ type: "agent_end" }));
    expect(container.querySelector(".research-approval-actions")).toBeNull();
  });

  it.each(["ended", "changed"] as const)("does not write a reserved approval after the session is %s", async (state) => {
    const { invoke, onAddPaper, rerender } = await mount();
    let release: (value: boolean) => void = () => {};
    invoke.mockImplementation((channel: string) => channel === "zhiyan:agent:approve"
      ? new Promise<boolean>((resolve) => { release = resolve; })
      : Promise.resolve(channel === "zhiyan:agent:start" ? { sessionId: "s2" } : undefined));
    await act(async () => emit({ type: "approval_required", approvalId: "a1", toolCallId: "t1",
      paper: { title: "Old paper", authors: [], year: 2024 } }));
    await act(async () => (container.querySelector(".research-approval-actions button") as HTMLButtonElement).click());
    if (state === "ended") await act(async () => emit({ type: "agent_end" }));
    else await rerender("p2");
    await act(async () => release(true));
    expect(onAddPaper).not.toHaveBeenCalled();
  });

  it("shows malformed tool events as failures and stops a pending session", async () => {
    const { invoke } = await mount();
    await act(async () => emit({ type: "tool_end", tool: { id: "large", name: "search_library", label: "搜索本地文献库",
      status: "completed", input: {}, output: "x".repeat(100_001) } }));
    expect(container.textContent).toContain("工具结果无法显示");
    expect(invoke).toHaveBeenCalledWith("zhiyan:agent:abort");
    expect(container.querySelector(".research-tool-card.is-failed")).not.toBeNull();
  });

  it("follows streamed content once per frame and respects the user's reading position", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    await mount();
    const scroller = container.querySelector(".research-agent-scroll") as HTMLDivElement;
    let height = 1000;
    let top = 0;
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, value: 200 },
      scrollTop: {
        configurable: true, get: () => top,
        set: (value: number) => { top = Math.max(0, Math.min(value, height - 200)); },
      },
    });
    // Model the old scrollTo behavior too, so it cannot silently pass in jsdom.
    scroller.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
      scroller.scrollTop = typeof options === "number" ? y ?? options : options?.top ?? 0;
    };
    const flush = () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(0));
    };
    await act(async () => emit({ type: "message_delta", messageId: "long", delta: "开始回答\n" }));
    await act(async () => emit({ type: "message_delta", messageId: "long", delta: "继续回答\n" }));
    expect(frames.size).toBe(1);
    flush();
    expect(top).toBe(800);

    scroller.scrollTop = 760;
    await act(async () => scroller.dispatchEvent(new Event("scroll", { bubbles: true })));
    height = 1020;
    await act(async () => emit({ type: "message_delta", messageId: "long", delta: "小幅上滚后仍有输出\n" }));
    flush();
    expect(top).toBe(760);
    scroller.scrollTop = 820;
    await act(async () => scroller.dispatchEvent(new Event("scroll", { bubbles: true })));

    scroller.scrollTop = 250;
    await act(async () => scroller.dispatchEvent(new Event("scroll", { bubbles: true })));
    height = 1200;
    await act(async () => emit({ type: "message_delta", messageId: "long", delta: "新的内容\n" }));
    flush();
    expect(top).toBe(250);

    scroller.scrollTop = 1000;
    await act(async () => scroller.dispatchEvent(new Event("scroll", { bubbles: true })));
    height = 1400;
    await act(async () => emit({ type: "message_delta", messageId: "long", delta: "末尾内容\n" }));
    flush();
    expect(top).toBe(1200);
  });

  it("shows the bundled skill catalogue and uses its prompt without copying skill instructions into the UI", async () => {
    await mount();
    await act(async () => emit({ type: "session_started", sessionId: "skills-session", skills: [
      { name: "paper-deep-reading", title: "论文精读", prompt: "精读当前论文，给出原文依据" },
      { name: "literature-search-review", title: "文献检索与筛选", prompt: "查找并筛选相关文献" },
      { name: "literature-comparison-notes", title: "文献对比与笔记", prompt: "对比证据并整理笔记" },
    ] }));
    expect(container.textContent).toContain("预置研究技能");
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "论文精读");
    expect(button).toBeTruthy();
    await act(async () => button!.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("精读当前论文，给出原文依据");
  });
});
