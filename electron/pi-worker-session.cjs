const { Worker } = require("node:worker_threads");
const path = require("node:path");

async function createPiWorkerSession({ service, tools, emit, cwd = process.cwd(), signal, onFailure, history = [], scope = "paper" }) {
  const worker = new Worker(path.join(__dirname, "pi-agent-worker.cjs"));
  const pending = new Map(), controllers = new Map();
  let sequence = 0, disposed = false, failureNotified = false;
  const safe = (value) => String(value || "研究助手工作线程失败").split(service.apiKey).join("[已隐藏]").slice(0, 2000);
  function notifyFailure(reason) {
    if (failureNotified) return;
    failureNotified = true;
    onFailure?.(reason);
  }
  function rejectPending(reason) {
    for (const request of pending.values()) request.reject(new Error(reason));
    pending.clear();
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
  }
  function request(type, args = {}) {
    if (disposed) return Promise.reject(new Error("研究助手已关闭"));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ type, id, ...args });
    });
  }
  worker.on("message", async (message) => {
    if (disposed) return;
    if (message.type === "event") { emit(message.event); return; }
    if (message.type === "response") {
      const target = pending.get(message.id);
      pending.delete(message.id);
      if (target) message.error ? target.reject(new Error(safe(message.error))) : target.resolve(message.result);
      return;
    }
    if (message.type === "tool_abort") { controllers.get(message.id)?.abort(); return; }
    if (message.type === "tool") {
      const controller = new AbortController();
      controllers.set(message.id, controller);
      try {
        const tool = tools.find((candidate) => candidate.name === message.name);
        if (!tool) throw new Error("未注册研究工具");
        const result = await tool.execute(message.id, message.params, controller.signal);
        if (!disposed) worker.postMessage({ type: "tool_result", id: message.id, result });
      } catch (error) {
        if (!disposed) worker.postMessage({ type: "tool_result", id: message.id, error: safe(error.message) });
      } finally { controllers.delete(message.id); }
    }
  });
  worker.on("error", (error) => {
    const reason = safe(error.message);
    if (!disposed) {
      disposed = true;
      rejectPending(reason);
      notifyFailure(reason);
    }
  });
  worker.on("exit", (code) => {
    if (disposed) return;
    disposed = true;
    const reason = code ? `研究助手工作线程异常退出（${code}）` : "研究助手工作线程已关闭";
    rejectPending(reason);
    notifyFailure(reason);
  });
  const cancelStartup = () => {
    if (disposed) return;
    disposed = true;
    rejectPending("研究助手启动已取消");
    void worker.terminate();
  };
  if (signal) {
    if (signal.aborted) cancelStartup();
    else signal.addEventListener("abort", cancelStartup, { once: true });
  }
  try {
    await request("init", { service, cwd, history, scope, tools: tools.map(({ name, label, description }) => ({ name, label, description })) });
  } catch (error) {
    disposed = true;
    rejectPending(safe(error.message));
    await worker.terminate();
    throw error;
  }
  signal?.removeEventListener("abort", cancelStartup);
  return {
    prompt: (text) => request("prompt", { text }),
    abort: async () => {
      for (const controller of controllers.values()) controller.abort();
      if (!disposed) await request("abort");
    },
    setGeneration: (generation) => { if (!disposed) worker.postMessage({ type: "generation", generation }); },
    dispose: () => {
      signal?.removeEventListener("abort", cancelStartup);
      disposed = true;
      rejectPending("研究助手已关闭");
      void worker.terminate();
    },
    activeTools: () => tools.map((tool) => tool.name),
  };
}
module.exports = { createPiWorkerSession };
