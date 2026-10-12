const { contextBridge, ipcRenderer } = require("electron");

const STREAM_START_CHANNEL = "zhiyan:ai:stream:start";
const STREAM_CANCEL_CHANNEL = "zhiyan:ai:stream:cancel";
const STREAM_EVENT_CHANNEL = "zhiyan:ai:stream:event";
const AGENT_EVENT_CHANNEL = "zhiyan:agent:event";

contextBridge.exposeInMainWorld("zhiyan", {
  invoke(channel, payload) {
    const allowedChannels = new Set([
      "zhiyan:ping",
      "zhiyan:settings:get",
      "zhiyan:settings:save",
      "zhiyan:settings:test",
      "zhiyan:documents:save",
      "zhiyan:documents:read",
      "zhiyan:documents:delete",
      "zhiyan:documents:asset",
      "zhiyan:documents:state",
      "zhiyan:documents:states",
      "zhiyan:mineru:start",
      "zhiyan:mineru:status",
      "zhiyan:agent:start",
      "zhiyan:agent:skills",
      "zhiyan:agent:update-context",
      "zhiyan:agent:prompt",
      "zhiyan:agent:abort",
      "zhiyan:agent:approve",
      "zhiyan:agent:save-document",
    ]);
    if (!allowedChannels.has(channel)) {
      throw new Error(`Unsupported IPC channel: ${channel}`);
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel, handler) {
    if (channel !== AGENT_EVENT_CHANNEL || typeof handler !== "function") {
      throw new Error(`Unsupported event channel: ${channel}`);
    }
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  stream(channel, payload, onDelta, onAbort) {
    if (channel !== "zhiyan:ai:run" || typeof onDelta !== "function") {
      throw new Error(`Unsupported stream channel: ${channel}`);
    }

    const requestId = globalThis.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let removeAbortListener = () => undefined;
      const cleanup = () => {
        ipcRenderer.removeListener(STREAM_EVENT_CHANNEL, handleEvent);
        removeAbortListener();
      };
      const handleAbort = () => {
        ipcRenderer.send(STREAM_CANCEL_CHANNEL, { requestId });
        cleanup();
        reject(new DOMException("请求已取消", "AbortError"));
      };
      const handleEvent = (_event, message) => {
        if (message?.requestId !== requestId) return;
        if (message.type === "delta") {
          try { onDelta(message.delta); } catch (error) {
            ipcRenderer.send(STREAM_CANCEL_CHANNEL, { requestId });
            cleanup();
            reject(error);
          }
        } else if (message.type === "complete") {
          cleanup();
          resolve(message.value);
        } else if (message.type === "error") {
          cleanup();
          reject(new Error(message.message || "模型请求失败"));
        }
      };
      ipcRenderer.on(STREAM_EVENT_CHANNEL, handleEvent);
      if (typeof onAbort === "function") {
        const remove = onAbort(handleAbort);
        if (typeof remove === "function") removeAbortListener = remove;
      }
      ipcRenderer.send(STREAM_START_CHANNEL, { requestId, request: payload });
    });
  },
});
