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
