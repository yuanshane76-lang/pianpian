const { assertAppSender } = require("./ipc-security.cjs");
const { createResearchAgentRuntime } = require("./research-agent-runtime.cjs");
const { listBundledResearchSkills } = require("./research-skills.cjs");

const EVENT_CHANNEL = "zhiyan:agent:event";

function registerResearchAgentHandlers({ ipcMain, isDev, readSettings, createRuntime = createResearchAgentRuntime, runtimeStore = new Map(), conversationStore, readLibraryPaper, canWrite = () => true, semanticScholarClient } = {}) {
  const secure = (event) => {
    assertAppSender(event, isDev);
    if (!canWrite()) throw new Error("正在准备更新，请稍候。");
  };
  const bindings = new Map();
  const starts = new Map();
  let activeHistoryOperations = 0;
  const watchedSenders = new WeakSet();
  const flush = async (binding) => { await binding?.flush?.(); };
  for (const action of ["list", "create", "get", "rename", "delete"]) {
    ipcMain.handle(`zhiyan:agent:conversations:${action}`, async (event, input) => {
      secure(event);
      activeHistoryOperations++;
      try {
      if (!conversationStore) throw new Error("对话历史存储不可用");
      await flush(bindings.get(event.sender.id));
      if (action === "delete") {
        for (const [senderId, binding] of bindings) if (binding.id === input) {
          await runtimeStore.get(senderId)?.abort(); await flush(binding);
          runtimeStore.get(senderId)?.dispose(); runtimeStore.delete(senderId); bindings.delete(senderId);
        }
        return await conversationStore.remove(input);
      }
      return await conversationStore[action](input);
      } finally { activeHistoryOperations--; }
    });
  }
  ipcMain.handle("zhiyan:agent:skills", (event) => {
    secure(event);
    return listBundledResearchSkills();
  });
  const getRuntime = (event) => {
    const id = event.sender.id;
    const runtime = runtimeStore.get(id);
    if (!runtime) throw new Error("对话会话不存在，请重新打开篇篇对话");
    return runtime;
  };
  ipcMain.handle("zhiyan:agent:start", async (event, context) => {
    secure(event);
    // Serialize starts per window; React lifecycle and rapid history clicks may overlap.
    const previous = starts.get(event.sender.id) || Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
    if (conversationStore && !context?.conversationId) throw new Error("请先新建或选择对话");
    const old = runtimeStore.get(event.sender.id);
    await old?.abort();
    await flush(bindings.get(event.sender.id));
    let history;
    if (context?.conversationId) {
      if (!conversationStore) throw new Error("对话历史存储不可用");
      await flush(bindings.get(event.sender.id));
      const record = await conversationStore.get(context.conversationId);
      const scope = context.scope === "library" ? "library" : "paper";
      if (record.scope !== scope || (scope === "paper" && record.paperId !== context.paper?.id)) throw new Error("对话与当前论文范围不一致");
      history = record.timeline;
    }
    old?.dispose();
    let pending = Promise.resolve(), failure = null, timer = null;
    const unsaved = [];
    const deltas = new Map();
    const binding = { id: context?.conversationId, flush: async () => {
      if (timer) { clearTimeout(timer); timer = null; }
      for (const [messageId, delta] of deltas) enqueue({ type: "message_delta", messageId, delta });
      deltas.clear(); await drain();
      if (failure) throw failure;
    } };
    function enqueue(payload) {
      if (!["message_start", "message_delta", "message_end", "tool_start", "tool_end"].includes(payload.type)) return;
      unsaved.push(payload);
      void drain();
    }
    function drain() {
      pending = pending.then(async () => {
        while (unsaved.length) { await conversationStore.record(binding.id, unsaved[0]); unsaved.shift(); }
        failure = null;
      }).catch(() => {
        failure = new Error("对话历史保存失败，请检查本地磁盘；当前内容尚未安全保存");
        if (!event.sender.isDestroyed()) event.sender.send(EVENT_CHANNEL, { type: "agent_error", message: failure.message, recoverable: true, conversationId: binding.id });
      });
      return pending;
    }
    const runtime = createRuntime({
      readLibraryPaper,
      semanticScholarClient,
      emit: (payload) => {
        if (binding.id) {
          if (payload.type === "message_delta") {
            deltas.set(payload.messageId, (deltas.get(payload.messageId) || "") + payload.delta);
            if (!timer) timer = setTimeout(() => { void binding.flush().catch(() => {}); }, 200);
          } else {
            for (const [messageId, delta] of deltas) enqueue({ type: "message_delta", messageId, delta });
            deltas.clear(); enqueue(payload);
          }
        }
        if (!event.sender.isDestroyed()) event.sender.send(EVENT_CHANNEL, binding.id ? { ...payload, conversationId: binding.id } : payload);
      },
    });
    bindings.set(event.sender.id, binding);
    runtimeStore.set(event.sender.id, runtime);
    if (!watchedSenders.has(event.sender)) {
      watchedSenders.add(event.sender);
      event.sender.once?.("destroyed", () => {
        const active = runtimeStore.get(event.sender.id);
        const activeBinding = bindings.get(event.sender.id);
        runtimeStore.delete(event.sender.id);
        active?.dispose();
        void flush(activeBinding).then(() => {
          if (bindings.get(event.sender.id) === activeBinding) bindings.delete(event.sender.id);
        }).catch(() => {});
      });
    }
    try {
      return history ? await runtime.start(context, readSettings(), history) : await runtime.start(context, readSettings());
    } catch (error) {
      runtime.dispose();
      if (runtimeStore.get(event.sender.id) === runtime) runtimeStore.delete(event.sender.id);
      throw error;
    }
    });
    starts.set(event.sender.id, operation);
    try { return await operation; } finally { if (starts.get(event.sender.id) === operation) starts.delete(event.sender.id); }
  });
  ipcMain.handle("zhiyan:agent:prompt", async (event, prompt) => {
    secure(event);
    await getRuntime(event).prompt(prompt);
    await flush(bindings.get(event.sender.id));
  });
  ipcMain.handle("zhiyan:agent:update-context", async (event, context) => {
    secure(event);
    return getRuntime(event).updateContext(context);
  });
  ipcMain.handle("zhiyan:agent:abort", async (event, input) => {
    secure(event);
    if (input?.conversationId && bindings.get(event.sender.id)?.id !== input.conversationId) return;
    await runtimeStore.get(event.sender.id)?.abort();
    await flush(bindings.get(event.sender.id));
  });
  ipcMain.handle("zhiyan:agent:approve", async (event, input) => {
    secure(event);
    if (!input || typeof input !== "object" || typeof input.approvalId !== "string"
      || input.approvalId.length > 200 || typeof input.approved !== "boolean") {
      throw new Error("审批参数无效");
    }
    if (input.message !== undefined && (typeof input.message !== "string" || input.message.length > 2_000)) {
      throw new Error("审批说明过长");
    }
    if (input.result !== undefined) {
      let size;
      try { size = JSON.stringify(input.result).length; } catch { throw new Error("审批结果无效"); }
      if (size > 100_000) throw new Error("审批结果过大");
    }
    return getRuntime(event).approve(input);
  });
  const dispose = async () => {
    const runtimes = [...runtimeStore.values()];
    await Promise.all(runtimes.map(async (runtime) => { try { await runtime.abort(); } finally { runtime.dispose(); } }));
    runtimeStore.clear();
    await Promise.all([...bindings.values()].map((binding) => flush(binding)));
    bindings.clear();
  };
  dispose.isBusy = () => activeHistoryOperations > 0 || starts.size > 0 || [...runtimeStore.values()].some((runtime) => runtime.busy);
  dispose.flush = async () => { await Promise.all([...bindings.values()].map((binding) => flush(binding))); };
  return dispose;
}

module.exports = { EVENT_CHANNEL, registerResearchAgentHandlers };
