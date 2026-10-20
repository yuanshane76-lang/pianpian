import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResearchAssistant } from "../../src/features/reader/ResearchAssistant";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
let emit: (event: unknown) => void;
const paper = { id: "p1", title: "Paper", authors: [], year: 2024, sourcePath: "local://p1",
  importedAt: "2026-10-12", groupId: "group-inbox", favorite: false, blocks: 1, blockData: [
    { id: "b1", pageNumber: 1, order: 0, kind: "paragraph" as const, text: "Evidence." },
  ] };

async function mount(available = true, currentPaper = paper, skills = false, draftAppend?: { id: number; text: string }, strict = false) {
  const invoke = vi.fn(async (channel: string, input?: any): Promise<any> => {
    if (channel === "zhiyan:agent:start") return { sessionId: "s1" };
    if (channel === "zhiyan:agent:skills") return skills ? [{ name: "reading", title: "论文精读", prompt: "请精读当前论文" }] : [];
    if (channel === "zhiyan:agent:conversations:list") return [];
    if (channel === "zhiyan:agent:conversations:create") return { id: `history-${input.paperId || "library"}`, scope: input.scope, title: "新对话", timeline: [] };
    if (channel === "zhiyan:agent:approve") return true;
  });
  window.zhiyan = { invoke: invoke as any, on: (_channel, handler) => { emit = handler as any; return () => {}; } };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const render = (node: ReactNode) => strict ? <StrictMode>{node}</StrictMode> : node;
  const onAddPaper = vi.fn(async () => ({ persisted: true as const, id: "added", duplicate: false, kind: "metadata" as const }));
  const onJump = vi.fn();
  await act(async () => root.render(render(<ResearchAssistant paper={currentPaper} library={[currentPaper]} onAddPaper={onAddPaper} onJump={onJump} available={available} onOpenSettings={vi.fn()} draftAppend={draftAppend} />)));
  return { invoke, onAddPaper, onJump, setActive: async (active: boolean) => {
    await act(async () => root.render(render(<ResearchAssistant paper={currentPaper} library={[currentPaper]} onAddPaper={onAddPaper} onJump={onJump} available={available} active={active} onOpenSettings={vi.fn()} draftAppend={draftAppend} />)));
  }, rerender: async (id: string) => {
    await act(async () => root.render(render(<ResearchAssistant paper={{ ...currentPaper, id }} library={[currentPaper]} onAddPaper={onAddPaper} onJump={onJump} available={available} onOpenSettings={vi.fn()} draftAppend={draftAppend} />)));
  } };
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  delete window.zhiyan;
  vi.unstubAllGlobals();
});

describe("research citation drafting", () => {
  it("keeps an initial citation when the conversation panel first mounts", async () => {
    const append = "《Paper》第 1 页\n> Evidence.";
    await mount(true, paper, false, { id: 1, text: append });
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toContain(append);
  });

  it("keeps an initial citation when Strict Mode replays mount effects", async () => {
    const append = "《Paper》第 1 页\n> Evidence.";
    await mount(true, paper, false, { id: 1, text: append }, true);
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toContain(append);
  });

  it("appends a citation to the conversation draft without sending it", async () => {
    await mount();
    const append = "《Paper》第 1 页\n> Evidence.";
    await act(async () => root.render(<ResearchAssistant paper={paper} library={[paper]} onAddPaper={vi.fn(async () => ({ persisted: true as const, id: "added", duplicate: false, kind: "metadata" as const }))} onJump={vi.fn()} available onOpenSettings={vi.fn()} draftAppend={{ id: 1, text: append }} />));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toContain(append);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="发送给篇篇"]')?.disabled).toBe(false);
  });
});

describe("research assistant", () => {
  it("starts global conversations without a selected paper and restores history through CRUD controls", async () => {
    const records: any[] = [{ id: "old", scope: "library", title: "旧的主题对比", updatedAt: Date.now(), messageCount: 2, preview: "原来的答案", timeline: [
      { type: "message", message: { id: "u-old", role: "user", content: "原来的问题" } },
      { type: "message", message: { id: "a-old", role: "assistant", content: "原来的答案" } },
    ] }];
    const invoke = vi.fn(async (channel: string, input?: any): Promise<any> => {
      if (channel === "zhiyan:agent:skills") return [];
      if (channel.endsWith("conversations:list")) return records.filter((item) => !input.query || item.title.includes(input.query));
      if (channel.endsWith("conversations:get")) return records.find((item) => item.id === input);
      if (channel.endsWith("conversations:create")) { const empty = records.find((item) => item.timeline.length === 0); if (empty) return empty; const item = { id: `new-${records.length}`, scope: "library", title: "新对话", timeline: [], updatedAt: Date.now() }; records.push(item); return item; }
      if (channel.endsWith("conversations:rename")) { Object.assign(records.find((item) => item.id === input.id), { title: input.title }); return records[0]; }
      if (channel.endsWith("conversations:delete")) { records.splice(records.findIndex((item) => item.id === input), 1); return true; }
      if (channel === "zhiyan:agent:start") return { sessionId: "s" };
    });
    window.zhiyan = { invoke: invoke as any, on: (_channel, handler) => { emit = handler as any; return () => {}; } };
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<ResearchAssistant scope="library" paper={paper} library={[paper]} available onAddPaper={vi.fn()} onJump={vi.fn()} onOpenSettings={vi.fn()} />));
    expect(container.textContent).toContain("原来的答案");
    expect(invoke).toHaveBeenCalledWith("zhiyan:agent:start", expect.objectContaining({ scope: "library", paper: null, conversationId: "old" }));
    const click = async (text: string) => act(async () => { const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text); expect(button).toBeTruthy(); button!.click(); });
    const openHistory = async () => act(async () => container.querySelector<HTMLButtonElement>('[aria-label="历史对话"]')!.click());
    await openHistory();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="重命名对话：旧的主题对比"]')!.click());
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('[aria-label="对话标题"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "我的对比研究");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(records[0].title).toBe("我的对比研究");
    await click("新建");
    expect(container.querySelector(".research-agent-content")?.textContent).not.toContain("原来的答案");
    await openHistory();
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>(".research-history-select")].find((item) => item.textContent?.includes("我的对比研究"))!.click());
    expect(container.textContent).toContain("原来的答案");
    expect(container.querySelector(".research-history")).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('[aria-label="历史对话"]'));
    await openHistory();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="删除对话：我的对比研究"]')!.click());
    await click("确认删除");
    expect(records.some((item) => item.id === "old")).toBe(false);
    expect(container.textContent).not.toContain("原来的答案");
  });
  it("opens history and skills on demand and closes the picker after choosing a workflow", async () => {
    await mount(true, paper, true);
    const history = container.querySelector<HTMLButtonElement>('[aria-label="历史对话"]')!;
    const skills = container.querySelector<HTMLButtonElement>('[aria-label="篇篇的拿手活"]')!;
    expect(skills).not.toBeNull();
    expect(container.querySelector(".research-skills-list")).toBeNull();
    await act(async () => history.click());
    expect(container.querySelector('[aria-label="搜索历史对话"]')).toBe(document.activeElement);
    await act(async () => skills.click());
    expect(container.querySelector(".research-history")).toBeNull();
    expect(skills.getAttribute("aria-expanded")).toBe("true");
    await act(async () => container.querySelector<HTMLButtonElement>(".research-skills-list button")!.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("请精读当前论文");
    expect(container.querySelector(".research-skills-list")).toBeNull();
    expect(container.querySelector("textarea")).toBe(document.activeElement);
  });

  it("dismisses the toolbar popover outside or with Escape and restores keyboard focus", async () => {
    await mount();
    const history = container.querySelector<HTMLButtonElement>('[aria-label="历史对话"]')!;
    await act(async () => history.click());
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(history.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(history);
    await act(async () => history.click());
    await act(async () => container.querySelector("textarea")!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(container.querySelector(".research-history")).toBeNull();
  });
  it("closes the nonmodal picker when focus leaves it or its reader tab becomes inactive", async () => {
    const { setActive, invoke } = await mount(true, paper, true);
    const skills = container.querySelector<HTMLButtonElement>('[aria-label="篇篇的拿手活"]')!;
    await act(async () => skills.click());
    await act(async () => container.querySelector("textarea")!.focus());
    expect(skills.getAttribute("aria-expanded")).toBe("false");
    await act(async () => skills.click());
    await setActive(false);
    expect(container.querySelector(".research-skills")).toBeNull();
    await setActive(true);
    expect(skills.getAttribute("aria-expanded")).toBe("false");
    expect(invoke.mock.calls.filter(([channel]) => channel === "zhiyan:agent:start")).toHaveLength(1);
  });
  it("keeps a citation clickable when pointer focus closes the history popover", async () => {
    const { onJump } = await mount();
    await act(async () => emit({ type: "message_end", message: {
      id: "source", role: "assistant", content: "证据[引用:b1]。",
      citations: [{ paperId: "p1", blockId: "b1", label: "原文" }],
    } }));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="历史对话"]')!.click());
    const citation = container.querySelector<HTMLButtonElement>(".research-inline-citation")!;
    await act(async () => {
      citation.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      citation.focus();
    });
    expect(container.querySelector(".research-history")).toBeNull();
    expect(citation.isConnected).toBe(true);
    expect(document.activeElement).toBe(citation);
    await act(async () => citation.click());
    expect(onJump).toHaveBeenCalledWith("b1");
  });
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
    const approve = container.querySelector<HTMLButtonElement>(".research-approval-actions .primary-button")!;
    expect(approve).toBeTruthy();
    expect(container.querySelector('[aria-label="工具：确认加入文献库"]')).not.toBeNull();
    await act(async () => approve.click());
    expect(onAddPaper).toHaveBeenCalledWith(expect.objectContaining({ title: "Result" }), expect.any(AbortSignal));
    expect(invoke).toHaveBeenCalledWith("zhiyan:agent:approve", expect.objectContaining({ approvalId: "a1", approved: true,
      result: { persisted: true, id: "added", duplicate: false, kind: "metadata" } }));
  });

  it("waits for asynchronous PDF persistence before completing an approval", async () => {
    const { invoke, onAddPaper } = await mount();
    let finish!: (value: any) => void;
    onAddPaper.mockImplementation(() => new Promise((resolve) => { finish = resolve; }) as any);
    await act(async () => emit({ type: "approval_required", approvalId: "pdf-approval", toolCallId: "pdf-tool",
      paper: { candidateId: "verified", arxivId: "1706.03762v7", title: "Attention Is All You Need", authors: [], year: 2017 } }));
    await act(async () => container.querySelector<HTMLButtonElement>(".research-approval-actions .primary-button")!.click());
    await vi.waitFor(() => expect(onAddPaper).toHaveBeenCalledOnce());
    expect(invoke.mock.calls.filter(([channel]) => channel === "zhiyan:agent:approve")).toHaveLength(1);
    expect(container.querySelector<HTMLButtonElement>(".research-approval-actions .primary-button")?.disabled).toBe(true);
    expect(container.querySelector(".research-approval-actions")?.textContent).toContain("正在下载并保存");
    await act(async () => finish({ persisted: true, id: "paper-id", originalId: "document-id", duplicate: false, kind: "pdf" }));
    expect(invoke).toHaveBeenLastCalledWith("zhiyan:agent:approve", expect.objectContaining({
      approvalId: "pdf-approval", approved: true,
      result: { persisted: true, id: "paper-id", originalId: "document-id", duplicate: false, kind: "pdf" },
    }));
  });

  it("never reports success when the library callback returns no persistence receipt", async () => {
    const { invoke, onAddPaper } = await mount();
    onAddPaper.mockReturnValue(undefined as any);
    await act(async () => emit({ type: "approval_required", approvalId: "missing-receipt", toolCallId: "missing-tool",
      paper: { candidateId: "verified", title: "Not saved", authors: [], year: 2025 } }));
    await act(async () => container.querySelector<HTMLButtonElement>(".research-approval-actions .primary-button")!.click());
    await vi.waitFor(() => expect(invoke.mock.calls.filter(([channel]) => channel === "zhiyan:agent:approve")).toHaveLength(2));
    expect(invoke).toHaveBeenLastCalledWith("zhiyan:agent:approve", expect.objectContaining({
      approvalId: "missing-receipt", approved: false,
    }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("保存");
  });

  it.each(["unmount", "agent_error", "agent_end"])("cancels an in-flight import on %s", async (termination) => {
    const { onAddPaper } = await mount();
    let finish!: (value: any) => void;
    onAddPaper.mockImplementation(() => new Promise((resolve) => { finish = resolve; }) as any);
    await act(async () => emit({ type: "approval_required", approvalId: "in-flight", toolCallId: "pending",
      paper: { title: "Paper", authors: [], year: 2024 } }));
    await act(async () => container.querySelector<HTMLButtonElement>(".research-approval-actions .primary-button")!.click());
    await vi.waitFor(() => expect(onAddPaper).toHaveBeenCalledOnce());
    const signal = (onAddPaper.mock.calls[0] as unknown as [unknown, AbortSignal])[1];
    if (termination === "unmount") await act(async () => root.render(null));
    else await act(async () => emit(termination === "agent_error"
      ? { type: "agent_error", message: "执行已结束", recoverable: false }
      : { type: "agent_end" }));
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ persisted: true, id: "paper", duplicate: false, kind: "pdf" }));
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

  it("renders only an inline number that jumps to the verified source", async () => {
    const { onJump } = await mount();
    await act(async () => emit({ type: "message_end", message: {
      id: "m1", role: "assistant", content: "结论见原文[引用:b1]。", citations: [{ paperId: "p1", blockId: "b1", pageNumber: 1, label: "第 1 页 · 原文" }],
    } }));
    const citation = container.querySelector<HTMLButtonElement>(".research-message-content .research-inline-citation");
    expect(citation?.textContent).toBe("[1]");
    expect(container.querySelector(".research-message-citations")).toBeNull();
    expect(container.textContent).not.toContain("第 1 页");
    expect(container.textContent).not.toContain("Evidence.");
    expect(citation?.getAttribute("title")).toBe("查看原文");
    expect(citation?.getAttribute("aria-label")).toBe("查看引用 1 的原文");
    await act(async () => citation?.click());
    expect(onJump).toHaveBeenCalledWith("b1");
  });

  it("distinguishes same-page blocks, reuses repeated citations and restarts numbering for each answer", async () => {
    const citationPaper = { ...paper, blockData: [
      { id: "b1", pageNumber: 1, order: 0, kind: "paragraph" as const, text: "First passage supports the claim." },
      { id: "b2", pageNumber: 1, order: 1, kind: "paragraph" as const, text: "Second passage gives a different result." },
    ] };
    const { onJump } = await mount(true, citationPaper);
    await act(async () => emit({ type: "message_end", message: {
      id: "m2", role: "assistant", content: "证据见[引用:b1]和[引用:b2]，再次[引用:b1]。", citations: [
        { paperId: "p1", blockId: "b1", label: "第 1 页 · 原文" },
        { paperId: "p1", blockId: "b2", label: "第 1 页 · 原文" },
      ],
    } }));
    const citations = [...container.querySelectorAll<HTMLButtonElement>(".research-inline-citation")];
    expect(citations.map((citation) => citation.textContent)).toEqual(["[1]", "[2]", "[1]"]);
    expect(container.textContent).not.toContain("第 1 页");
    expect(container.textContent).not.toContain("First passage");
    expect(container.querySelector(".research-message-citations")).toBeNull();
    await act(async () => citations[1].click());
    expect(onJump).toHaveBeenCalledWith("b2");
    await act(async () => emit({ type: "message_end", message: {
      id: "m3", role: "assistant", content: "下一条回答[引用:b2]。", citations: [
        { paperId: "p1", blockId: "b2", label: "第 1 页" },
      ],
    } }));
    expect([...container.querySelectorAll(".research-inline-citation")].map((citation) => citation.textContent))
      .toEqual(["[1]", "[2]", "[1]", "[1]"]);
  });

  it("does not add citation lists below completed read tools or uncited answers", async () => {
    await mount();
    await act(async () => emit({ type: "tool_start", tool: { id: "read", name: "read_current_paper",
      label: "读取当前论文", status: "running", input: { page: 1 } } }));
    expect(container.querySelector(".research-tool-summary")?.textContent).toBe("读取论文原文");
    await act(async () => {
      emit({ type: "tool_end", tool: { id: "read", name: "read_current_paper", label: "读取当前论文",
        status: "completed", input: {}, output: { paper: { id: "p1", blocks: paper.blockData },
          citations: [{ paperId: "p1", blockId: "b1", label: "第 1 页" }] } } });
      emit({ type: "message_end", message: { id: "answer", role: "assistant", content: "无需引用的回答。",
        citations: [{ paperId: "p1", blockId: "b1", label: "第 1 页" }] } });
    });
    expect(container.querySelector(".research-citations, .research-message-citations, .research-inline-citation")).toBeNull();
    expect(container.textContent).not.toContain("第 1 页");
  });

  it("keeps first-mention numbers stable between streaming and the completed answer", async () => {
    const other = { ...paper.blockData[0], id: "b2", pageNumber: 9, order: 1 };
    const { onJump } = await mount(true, { ...paper, blockData: [paper.blockData[0], other] });
    await act(async () => {
      emit({ type: "tool_end", tool: { id: "read", name: "read_current_paper", label: "读取当前论文",
        status: "completed", input: {}, output: { paper: { id: "p1", blocks: [paper.blockData[0], other] } } } });
      emit({ type: "message_delta", messageId: "answer", delta: "先引用后读到的块[引用:b2]，再引用[引用:b1]。" });
    });
    const labels = () => [...container.querySelectorAll(".research-inline-citation")].map((button) => button.textContent);
    expect(labels()).toEqual(["[1]", "[2]"]);
    await act(async () => emit({ type: "message_end", message: { id: "answer", role: "assistant",
      content: "先引用后读到的块[引用:b2]，再引用[引用:b1]。", citations: [
        { paperId: "p1", blockId: "b2", label: "第 9 页" }, { paperId: "p1", blockId: "b1", label: "第 1 页" },
      ] } }));
    expect(labels()).toEqual(["[1]", "[2]"]);
    await act(async () => container.querySelector<HTMLButtonElement>(".research-inline-citation")!.click());
    expect(onJump).toHaveBeenCalledWith("b2");
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

  it("renders DeepSeek web search results as a compact expandable tool card", async () => {
    await mount();
    await act(async () => emit({ type: "tool_end", tool: { id: "web-search", name: "search_web",
      label: "联网搜索", status: "completed", input: { query: "DeepSeek" },
      output: { source: "DeepSeek Search", results: [{ title: "DeepSeek API", url: "https://api.deepseek.com",
        site_name: "DeepSeek", snippet: "Search API docs." }] } } }));
    expect(container.querySelector('[aria-label="工具：联网搜索"]')).not.toBeNull();
    expect(container.querySelector(".research-tool-summary")?.textContent).toContain("1 条网页");
    expect(container.querySelector(".research-result-list")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(".research-tool-heading")!.click());
    expect(container.querySelector(".research-result-list")?.textContent).toContain("DeepSeek API");
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
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="篇篇的拿手活"]')!.click());
    expect(container.querySelector(".research-skills-list")).not.toBeNull();
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "论文精读");
    expect(button).toBeTruthy();
    await act(async () => button!.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("精读当前论文，给出原文依据");
  });
});
