import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { registerAiStreamHandlers } = require("../../electron/ai-stream-ipc.cjs");

function createIpcMain() {
  const handlers = new Map<string, (...args: any[]) => void>();
  return {
    handlers,
    on: vi.fn((channel: string, handler: (...args: any[]) => void) => handlers.set(channel, handler)),
    removeListener: vi.fn(),
  };
}

function createEvent(id = 1) {
  const frame = { url: "http://127.0.0.1:4173/" };
  return {
    sender: {
      id,
      mainFrame: frame,
      isDestroyed: () => false,
      send: vi.fn(),
    },
    senderFrame: frame,
  };
}

describe("AI stream IPC", () => {
  it("refuses new model streams while an update freezes writes", () => {
    const ipcMain = createIpcMain(); const event = createEvent(); const streamModel = vi.fn();
    registerAiStreamHandlers({ ipcMain, isDev: true, readSettings: () => ({}), streamModel, canWrite: () => false });
    ipcMain.handlers.get("zhiyan:ai:stream:start")!(event, { requestId: "update-test", request: {} });
    expect(streamModel).not.toHaveBeenCalled();
    expect(event.sender.send).toHaveBeenCalledWith("zhiyan:ai:stream:event", expect.objectContaining({ type: "error" }));
  });
  it("forwards deltas and a final result to the requesting renderer", async () => {
    const ipcMain = createIpcMain();
    const streamModel = vi.fn(async (_settings, _request, onDelta) => {
      onDelta("首");
      onDelta("token");
      return "首token";
    });
    registerAiStreamHandlers({ ipcMain, isDev: true, readSettings: () => ({ aiProvider: "deepseek" }), streamModel });
    const event = createEvent();

    ipcMain.handlers.get("zhiyan:ai:stream:start")!(event, { requestId: "request-1", request: { operation: "translate" } });
    await vi.waitFor(() => expect(event.sender.send).toHaveBeenCalledTimes(3));

    expect(event.sender.send.mock.calls.map(([channel, payload]) => [channel, payload.type, payload.delta ?? payload.value]))
      .toEqual([
        ["zhiyan:ai:stream:event", "delta", "首"],
        ["zhiyan:ai:stream:event", "delta", "token"],
        ["zhiyan:ai:stream:event", "complete", "首token"],
      ]);
  });

  it("cancels only a request owned by the same renderer", async () => {
    const ipcMain = createIpcMain();
    let signal!: AbortSignal;
    let release!: () => void;
    const streamModel = vi.fn((_settings, _request, _onDelta, _fetchImpl, requestSignal) => {
      signal = requestSignal;
      return new Promise<string>((resolve) => { release = () => resolve(""); });
    });
    registerAiStreamHandlers({ ipcMain, isDev: true, readSettings: () => ({}), streamModel });
    const owner = createEvent(1);
    ipcMain.handlers.get("zhiyan:ai:stream:start")!(owner, { requestId: "request-2", request: {} });
    await vi.waitFor(() => expect(streamModel).toHaveBeenCalledOnce());

    ipcMain.handlers.get("zhiyan:ai:stream:cancel")!(createEvent(2), { requestId: "request-2" });
    expect(signal.aborted).toBe(false);
    ipcMain.handlers.get("zhiyan:ai:stream:cancel")!(owner, { requestId: "request-2" });
    expect(signal.aborted).toBe(true);
    release();
  });
});
