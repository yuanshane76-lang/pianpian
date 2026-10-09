const { assertAppSender } = require("./ipc-security.cjs");

const START_CHANNEL = "zhiyan:ai:stream:start";
const CANCEL_CHANNEL = "zhiyan:ai:stream:cancel";
const EVENT_CHANNEL = "zhiyan:ai:stream:event";

function registerAiStreamHandlers({ ipcMain, isDev, readSettings, streamModel }) {
  const active = new Map();
  const requestKey = (senderId, requestId) => `${senderId}:${requestId}`;

  function send(event, requestId, payload) {
    if (!event.sender.isDestroyed()) event.sender.send(EVENT_CHANNEL, { requestId, ...payload });
  }

  function start(event, payload) {
    try { assertAppSender(event, isDev); } catch { return; }
    const requestId = payload?.requestId;
    if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(requestId)) return;
    const key = requestKey(event.sender.id, requestId);
    if (active.has(key)) {
      send(event, requestId, { type: "error", message: "重复的模型请求编号" });
      return;
    }

    const controller = new AbortController();
    active.set(key, controller);
    void streamModel(readSettings(), payload.request, (delta) => {
      if (!controller.signal.aborted) send(event, requestId, { type: "delta", delta });
    }, undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) send(event, requestId, { type: "complete", value });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          send(event, requestId, {
            type: "error",
            message: error instanceof Error ? error.message : "模型请求失败",
          });
        }
      })
      .finally(() => {
        active.delete(key);
      });
  }

  function cancel(event, payload) {
    try { assertAppSender(event, isDev); } catch { return; }
    if (typeof payload?.requestId !== "string") return;
    active.get(requestKey(event.sender.id, payload.requestId))?.abort();
  }

  ipcMain.on(START_CHANNEL, start);
  ipcMain.on(CANCEL_CHANNEL, cancel);

  return () => {
    ipcMain.removeListener(START_CHANNEL, start);
    ipcMain.removeListener(CANCEL_CHANNEL, cancel);
    for (const controller of active.values()) controller.abort();
    active.clear();
  };
}

module.exports = { registerAiStreamHandlers };
