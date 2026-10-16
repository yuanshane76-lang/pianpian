import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { registerResearchAgentHandlers } = require("../../electron/research-agent-ipc.cjs");

function createEvent(id = 1) {
  const frame = { url: "http://127.0.0.1:4173/" };
  return { sender: { id, mainFrame: frame, isDestroyed: () => false, send: vi.fn() }, senderFrame: frame };
}

function createIpcMain() {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const listeners = new Map<string, (...args: any[]) => unknown>();
  return {
    handlers,
    listeners,
    handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => handlers.set(channel, handler)),
    on: vi.fn((channel: string, handler: (...args: any[]) => unknown) => listeners.set(channel, handler)),
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
  };
}

describe("research Agent IPC", () => {
  it("registers only one window-close listener across repeated history restores", async () => {
    const ipcMain = createIpcMain();
    const event = createEvent();
    const once = vi.fn();
    Object.assign(event.sender, { once });
    const runtime = { start: vi.fn(async () => ({})), abort: vi.fn(async () => undefined), dispose: vi.fn() };
    registerResearchAgentHandlers({ ipcMain, isDev: true, readSettings: () => ({}), createRuntime: () => runtime });
    for (let index = 0; index < 12; index++) {
      await ipcMain.handlers.get("zhiyan:agent:start")!(event, { paper: { id: "p1", title: "Paper", blocks: [] }, library: [] });
    }
    expect(once).toHaveBeenCalledOnce();
  });
  it("retries unsaved events in order and flushes the final delta on application shutdown", async () => {
    const ipcMain = createIpcMain();
    const conversation = { id: "history-1", scope: "library", timeline: [] };
    const persisted: any[] = [];
    let failWrites = true;
    const conversationStore = { get: vi.fn(async () => conversation), record: vi.fn(async (_id, payload) => {
      if (failWrites) throw new Error("disk unavailable");
      persisted.push(payload);
    }) };
    let publish: (payload: any) => void = () => {};
    const runtime = { start: vi.fn(async () => ({})), dispose: vi.fn(), abort: vi.fn(async () => {
      publish({ type: "message_delta", messageId: "a", delta: "结束前的增量" });
    }), prompt: vi.fn(async () => {
      publish({ type: "message_start", message: { id: "u", role: "user", content: "问题" } });
      publish({ type: "message_delta", messageId: "a", delta: "第一段" });
    }) };
    const dispose = registerResearchAgentHandlers({ ipcMain, isDev: true, readSettings: () => ({}), conversationStore,
      createRuntime: ({ emit }: any) => { publish = emit; return runtime; } });
    const event = createEvent();
    await ipcMain.handlers.get("zhiyan:agent:start")!(event, { conversationId: conversation.id, scope: "library", library: [] });
    await expect(ipcMain.handlers.get("zhiyan:agent:prompt")!(event, "问题")).rejects.toThrow("尚未安全保存");
    expect(persisted).toEqual([]);
    expect(event.sender.send).toHaveBeenCalledWith("zhiyan:agent:event", expect.objectContaining({ type: "agent_error", conversationId: conversation.id }));
    failWrites = false;
    await dispose();
    expect(persisted.map((payload) => payload.type)).toEqual(["message_start", "message_delta", "message_delta"]);
    expect(persisted.filter((payload) => payload.type === "message_delta").map((payload) => payload.delta).join("")).toBe("第一段结束前的增量");
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
  it("flushes coalesced stream text to the bound conversation before returning prompt or history", async () => {
    const ipcMain = createIpcMain();
    const record = { id: "history-1", scope: "library", timeline: [] };
    const conversationStore = { get: vi.fn(async () => record), record: vi.fn(async () => undefined), list: vi.fn(async () => [record]) };
    let publish: (payload: any) => void = () => {};
    const runtime = { start: vi.fn(async () => ({})), dispose: vi.fn(), abort: vi.fn(), prompt: vi.fn(async () => {
      publish({ type: "message_delta", messageId: "a", delta: "第一部分" });
      publish({ type: "message_delta", messageId: "a", delta: "第二部分" });
    }) };
    registerResearchAgentHandlers({ ipcMain, isDev: true, readSettings: () => ({}), conversationStore, createRuntime: ({ emit }: any) => { publish = emit; return runtime; } });
    const event = createEvent();
    await ipcMain.handlers.get("zhiyan:agent:start")!(event, { conversationId: record.id, scope: "library", library: [] });
    await ipcMain.handlers.get("zhiyan:agent:prompt")!(event, "问");
    expect(conversationStore.record).toHaveBeenCalledWith(record.id, { type: "message_delta", messageId: "a", delta: "第一部分第二部分" });
    expect(event.sender.send).toHaveBeenCalledWith("zhiyan:agent:event", expect.objectContaining({ conversationId: record.id }));
    await ipcMain.handlers.get("zhiyan:agent:abort")!(event, { conversationId: "other" });
    expect(runtime.abort).not.toHaveBeenCalled();
  });
  it("restores persisted messages server-side and rejects cross-scope restoration", async () => {
    const ipcMain = createIpcMain();
    const record = { id: "history-1", scope: "paper", paperId: "p1", timeline: [{ type: "message", message: { id: "u", role: "user", content: "之前的问题" } }] };
    const conversationStore = { get: vi.fn(async () => record), record: vi.fn(async () => undefined), list: vi.fn(async () => [record]), create: vi.fn(), remove: vi.fn(), rename: vi.fn() };
    const runtime = { start: vi.fn(async () => ({ sessionId: "s" })), abort: vi.fn(), dispose: vi.fn(), prompt: vi.fn() };
    registerResearchAgentHandlers({ ipcMain, isDev: true, readSettings: () => ({}), conversationStore, createRuntime: () => runtime });
    await ipcMain.handlers.get("zhiyan:agent:start")!(createEvent(), { conversationId: "history-1", paper: { id: "p1", title: "Paper", blocks: [] }, library: [] });
    expect(runtime.start).toHaveBeenCalledWith(expect.anything(), {}, record.timeline);
    await expect(ipcMain.handlers.get("zhiyan:agent:start")!(createEvent(), { conversationId: "history-1", scope: "library", library: [] })).rejects.toThrow("范围");
    const stranger = createEvent(); stranger.senderFrame = { url: "https://untrusted.example/" };
    await expect(ipcMain.handlers.get("zhiyan:agent:conversations:list")!(stranger, { scope: "library" })).rejects.toThrow();
  });
  it("lists shipped skills before any model is configured and rejects an untrusted sender", async () => {
    const ipcMain = createIpcMain();
    const readSettings = vi.fn();
    const createRuntime = vi.fn();
    registerResearchAgentHandlers({ ipcMain, isDev: true, readSettings, createRuntime });
    const handler = ipcMain.handlers.get("zhiyan:agent:skills");
    expect(handler).toBeTruthy();
    const skills: any = await handler!(createEvent());
    expect(skills).toHaveLength(3);
    expect(skills[0]).toMatchObject({ name: "paper-deep-reading", title: "论文精读" });
    expect(readSettings).not.toHaveBeenCalled();
    expect(createRuntime).not.toHaveBeenCalled();
    const event = createEvent();
    event.senderFrame = { url: "https://untrusted.example/" };
    expect(() => handler!(event)).toThrow();
  });

  it("keeps runtime events bound to the requesting renderer", async () => {
    const ipcMain = createIpcMain();
    const runtime: any = {
      start: vi.fn(async () => ({ sessionId: "session-1" })),
      updateContext: vi.fn(async () => true),
      prompt: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
      approve: vi.fn(() => true),
      dispose: vi.fn(),
    };
    const createRuntime = vi.fn(({ emit }) => {
      runtime.emit = emit;
      return runtime;
    });
    registerResearchAgentHandlers({
      ipcMain, isDev: true, readSettings: () => ({ aiProvider: "deepseek" }), createRuntime,
    });
    const event = createEvent(3);
    await ipcMain.handlers.get("zhiyan:agent:start")!(event, { paper: { id: "p1", title: "Paper", blocks: [] }, library: [] });
    expect(runtime.start).toHaveBeenCalledWith(expect.anything(), { aiProvider: "deepseek" });
    runtime.emit({ type: "session_started", sessionId: "s" });
    expect(event.sender.send).toHaveBeenCalledWith("zhiyan:agent:event", { type: "session_started", sessionId: "s" });
    await ipcMain.handlers.get("zhiyan:agent:prompt")!(event, "你好");
    expect(runtime.prompt).toHaveBeenCalledWith("你好");
  });

  it("rejects a renderer from controlling another window runtime", async () => {
    const ipcMain = createIpcMain();
    const runtimes = new Map<number, any>();
    registerResearchAgentHandlers({
      ipcMain, isDev: true, readSettings: () => ({ aiProvider: "deepseek" }),
      createRuntime: ({ emit }: any) => {
        const runtime = { start: vi.fn(async () => ({ sessionId: "s" })), updateContext: vi.fn(), prompt: vi.fn(), abort: vi.fn(), approve: vi.fn(), dispose: vi.fn(), emit };
        return runtime;
      },
      runtimeStore: runtimes,
    });
    const owner = createEvent(1);
    const stranger = createEvent(2);
    await ipcMain.handlers.get("zhiyan:agent:start")!(owner, { paper: { id: "p1", title: "Paper", blocks: [] }, library: [] });
    await expect(ipcMain.handlers.get("zhiyan:agent:prompt")!(stranger, "越权")).rejects.toThrow("Agent 会话不存在");
  });
});
