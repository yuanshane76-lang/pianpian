const { parentPort } = require("node:worker_threads");
const { createLocalPiSession } = require("./pi-agent.cjs");
let session;
const pendingTools = new Map();
function errorText(error) { return typeof error?.message === "string" ? error.message : "研究助手工作线程失败"; }
parentPort.on("message", async (message) => {
  if (message.type === "tool_result") {
    const pending = pendingTools.get(message.id);
    if (!pending) return;
    pendingTools.delete(message.id);
    message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result);
    return;
  }
  try {
    if (message.type === "init") {
      session = await createLocalPiSession({
        service: message.service, cwd: message.cwd,
        history: message.history, scope: message.scope,
        emit: (event) => parentPort.postMessage({ type: "event", event }),
        tools: message.tools.map((tool) => ({ ...tool, execute: (id, params, signal) => new Promise((resolve, reject) => {
          pendingTools.set(id, { resolve, reject });
          parentPort.postMessage({ type: "tool", id, name: tool.name, params });
          signal?.addEventListener("abort", () => parentPort.postMessage({ type: "tool_abort", id }), { once: true });
        }) })),
      });
    } else if (message.type === "prompt") await session.prompt(message.text);
    else if (message.type === "abort") await session.abort();
    else if (message.type === "generation") { session?.setGeneration(message.generation); return; }
    parentPort.postMessage({ type: "response", id: message.id, result: true });
  } catch (error) {
    parentPort.postMessage({ type: "response", id: message.id, error: errorText(error) });
  }
});
