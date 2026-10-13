const { randomUUID } = require("node:crypto");
const { createToolDefinitions, normalizeContext } = require("./research-agent-tools.cjs");
const { createPiSession, safeError } = require("./pi-agent.cjs");
const { listBundledResearchSkills } = require("./research-skills.cjs");
const { resolveMessageCitations } = require("./research-citations.cjs");

function createResearchAgentRuntime({ emit, fetchImpl = globalThis.fetch, piSessionFactory = createPiSession } = {}) {
  if (typeof emit !== "function") throw new Error("Agent 事件发送器无效");
  let context;
  let sessionId = null;
  let disposed = false;
  let aborted = false;
  let messageCount = 0;
  let piSession = null;
  let busy = false;
  let serviceKey = "";
  let generation = 0;
  let lifecycle = 0;
  let contextRevision = 0;
  let startingController = null;
  const pendingApprovals = new Map();
  const citationEvidence = new Map();

  function publish(event) {
    if (!disposed) emit(event);
  }

  function approvalRequest(request, signal) {
    return new Promise((resolve) => {
      const pending = { resolve, reserved: false, cleanup: () => signal?.removeEventListener("abort", cancel) };
      function cancel() {
        if (pendingApprovals.get(request.approvalId) !== pending) return;
        pendingApprovals.delete(request.approvalId);
        pending.cleanup();
        resolve({ approved: false, message: "用户已停止 Agent" });
      }
      if (signal?.aborted) {
        resolve({ approved: false, message: "用户已停止 Agent" });
        return;
      }
      pendingApprovals.set(request.approvalId, pending);
      signal?.addEventListener("abort", cancel, { once: true });
      publish({ type: "approval_required", ...request });
    });
  }

  function clearPendingApprovals(message) {
    for (const pending of pendingApprovals.values()) {
      pending.cleanup();
      pending.resolve({ approved: false, message });
    }
    pendingApprovals.clear();
  }

  function handleSessionFailure(reason, expectedLifecycle) {
    if (disposed || lifecycle !== expectedLifecycle) return;
    lifecycle += 1;
    generation += 1;
    aborted = true;
    busy = false;
    sessionId = null;
    citationEvidence.clear();
    clearPendingApprovals("研究助手已关闭");
    piSession = null;
    publish({ type: "agent_error", message: "研究助手工作线程已退出，请重新连接后重试", recoverable: false });
  }

  function approve(input) {
    if (!input || typeof input.approvalId !== "string" || input.approvalId.length > 200
      || typeof input.approved !== "boolean") return false;
    if (input.message !== undefined && (typeof input.message !== "string" || input.message.length > 2_000)) return false;
    if (input.result !== undefined) {
      let resultSize;
      try { resultSize = JSON.stringify(input.result).length; } catch { return false; }
      if (resultSize > 100_000) return false;
    }
    const pending = pendingApprovals.get(input.approvalId);
    if (!pending) return false;
    if (input.approved && input.result === undefined && !pending.reserved) {
      pending.reserved = true;
      return true;
    }
    if (input.approved && input.result === undefined) return false;
    pendingApprovals.delete(input.approvalId);
    pending.cleanup();
    pending.resolve({ approved: input.approved, result: input.result, message: input.message });
    return true;
  }

  function toolEvent(type, tool) {
    publish({ type, tool: { ...tool, startedAt: tool.startedAt || new Date().toISOString() } });
  }

  async function runTool(name, input = {}, toolCallId, signal) {
    const toolGeneration = generation;
    const toolContextRevision = contextRevision;
    const toolPaperId = context?.paper.id;
    const definition = createToolDefinitions({
      getContext: () => context,
      emitApproval: (request) => approvalRequest(request, signal),
      fetchImpl,
    }).find((candidate) => candidate.name === name);
    if (!definition) throw new Error(`未注册工具：${name}`);
    if (signal?.aborted || aborted) throw new Error("请求已停止");
    const id = toolCallId || randomUUID();
    const tool = { id, name, label: definition.label, status: "running", input };
    toolEvent("tool_start", tool);
    try {
      const result = await definition.execute(id, input, signal, undefined, {});
      if (toolGeneration !== generation || toolContextRevision !== contextRevision || signal?.aborted || aborted) throw new Error("请求已停止");
      const output = result?.structuredContent ?? result?.content?.map((item) => item.text).join("") ?? result;
      if (name === "read_current_paper" && output?.paper?.id === toolPaperId && toolContextRevision === contextRevision) {
        for (const block of output.paper.blocks) {
          citationEvidence.set(block.id, {
            paperId: toolPaperId, blockId: block.id, pageNumber: block.pageNumber,
            label: `第 ${block.pageNumber} 页`,
          });
        }
      }
      if (name === "add_paper_to_library" && output?.status === "added" && output.paper) {
        const added = output.paper;
        const exists = context.library.some((item) =>
          item.doi && added.doi && item.doi.toLocaleLowerCase() === added.doi.toLocaleLowerCase()
          || item.title.toLocaleLowerCase() === added.title.toLocaleLowerCase());
        if (!exists) context.library = [{
          id: output.result?.id || randomUUID(), title: added.title,
          authors: added.authors || [], year: added.year ?? null, doi: added.doi,
        }, ...context.library].slice(0, 500);
      }
      const completed = { ...tool, status: output?.status === "rejected" ? "rejected" : "completed", output, finishedAt: new Date().toISOString() };
      toolEvent("tool_end", completed);
      return output;
    } catch (error) {
      if (toolGeneration !== generation || signal?.aborted || aborted) throw error;
      const failed = { ...tool, status: "failed", error: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() };
      toolEvent("tool_end", failed);
      throw error;
    }
  }

  async function start(nextContext, settings = {}) {
    await abort();
    if (disposed) throw new Error("Agent 已关闭");
    piSession?.dispose();
    piSession = null;
    context = normalizeContext(nextContext);
    citationEvidence.clear();
    const service = settings[settings.aiProvider];
    if (!service || typeof service.apiKey !== "string" || !service.apiKey.trim()) {
      throw new Error("请先在服务配置中设置当前模型密钥");
    }
    sessionId = randomUUID();
    aborted = false;
    const startGeneration = generation;
    const startLifecycle = ++lifecycle;
    const startController = new AbortController();
    startingController = startController;
    serviceKey = service.apiKey;
    const tools = createToolDefinitions({ getContext: () => context, emitApproval: approvalRequest, fetchImpl });
    let nextSession;
    try {
      nextSession = await piSessionFactory({
        service,
        signal: startController.signal,
        onFailure: (reason) => handleSessionFailure(reason, startLifecycle),
        emit: (event) => {
          if (lifecycle === startLifecycle && !aborted && busy) {
            if (event.type === "message_end" && event.message.role === "assistant") {
              publish({ ...event, message: { ...event.message,
                citations: resolveMessageCitations(event.message.content, citationEvidence) } });
            } else publish(event);
          }
        },
        tools: tools.map((tool) => ({ ...tool, execute: async (id, params, signal) => {
          const output = await runTool(tool.name, params, id, signal);
          return { content: [{ type: "text", text: JSON.stringify(output) }], details: output };
        } })),
      });
    } finally {
      if (startingController === startController) startingController = null;
    }
    if (disposed || generation !== startGeneration || startController.signal.aborted || !sessionId) {
      await nextSession?.abort?.();
      nextSession?.dispose?.();
      throw new Error("Agent 启动已取消");
    }
    piSession = nextSession;
    piSession.setGeneration?.(startGeneration);
    publish({ type: "session_started", sessionId, skills: listBundledResearchSkills() });
    return { sessionId };
  }

  async function prompt(value) {
    if (disposed) throw new Error("Agent 已关闭");
    if (!context || !sessionId) throw new Error("Agent 尚未启动");
    if (busy) throw new Error("Agent 正在处理上一条问题");
    const promptText = typeof value === "string" ? value.trim() : "";
    if (!promptText || promptText.length > 8_000) throw new Error("问题无效");
    aborted = false;
    busy = true;
    const runGeneration = generation;
    piSession?.setGeneration?.(runGeneration);
    const userMessage = { id: randomUUID(), role: "user", content: promptText, createdAt: new Date().toISOString() };
    publish({ type: "message_start", message: userMessage });
    try {
      await piSession.prompt(promptText);
    } catch (error) {
      if (!aborted && generation === runGeneration) {
        publish({ type: "agent_error", message: safeError(error?.message, serviceKey), recoverable: true });
      }
    } finally {
      if (generation === runGeneration) {
        busy = false;
        if (!aborted) publish({ type: "agent_end" });
      }
    }
    if (aborted || generation !== runGeneration) return;
    messageCount += 1;
  }

  function updateContext(nextContext) {
    if (disposed || !sessionId) throw new Error("Agent 会话不存在");
    const next = normalizeContext(nextContext);
    if (next.paper.id !== context.paper.id || JSON.stringify(next.paper.blocks) !== JSON.stringify(context.paper.blocks)) {
      contextRevision += 1;
      citationEvidence.clear();
    }
    context = next;
    return true;
  }

  async function abort() {
    aborted = true;
    generation += 1;
    startingController?.abort();
    piSession?.setGeneration?.(null);
    clearPendingApprovals("用户已停止 Agent");
    await piSession?.abort();
    if (busy) publish({ type: "agent_end" });
    busy = false;
  }

  function dispose() {
    disposed = true;
    lifecycle += 1;
    generation += 1;
    startingController?.abort();
    piSession?.setGeneration?.(null);
    void piSession?.abort().catch(() => undefined);
    piSession?.dispose();
    clearPendingApprovals("会话已关闭");
  }

  return { start, updateContext, prompt, abort, approve, dispose, get messageCount() { return messageCount; } };
}

module.exports = { createResearchAgentRuntime, normalizeContext };
