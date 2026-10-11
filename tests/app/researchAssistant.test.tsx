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

async function mount() {
  const invoke = vi.fn(async (channel: string): Promise<any> => channel === "zhiyan:agent:start" ? { sessionId: "s1" } : channel === "zhiyan:agent:approve" ? true : undefined);
  window.zhiyan = { invoke: invoke as any, on: (_channel, handler) => { emit = handler as any; return () => {}; } };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onAddPaper = vi.fn(() => ({ id: "added", duplicate: false }));
  await act(async () => root.render(<ResearchAssistant paper={paper} library={[paper]} onAddPaper={onAddPaper} onJump={vi.fn()} available={false} onOpenSettings={vi.fn()} />));
  return { invoke, onAddPaper, rerender: async (id: string) => {
    await act(async () => root.render(<ResearchAssistant paper={{ ...paper, id }} library={[paper]} onAddPaper={onAddPaper} onJump={vi.fn()} available={false} onOpenSettings={vi.fn()} />));
  } };
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  delete window.zhiyan;
});

describe("research assistant", () => {
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
    await mount();
    await act(async () => {
      emit({ type: "message_delta", messageId: "m1", delta: "Hello" });
      emit({ type: "message_delta", messageId: "m1", delta: " world\n" });
      emit({ type: "tool_end", tool: { id: "t2", name: "create_document", label: "生成文档", status: "completed", input: {},
        output: { document: { title: "阅读笔记", markdown: "# 阅读笔记\n\nEvidence." } } } });
    });
    expect(container.textContent).toContain("Hello world");
    expect(container.querySelector('[aria-label="保存 Markdown 文档"]')).not.toBeNull();
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
});
