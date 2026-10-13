const { assertAppSender } = require("./ipc-security.cjs");
const { createResearchAgentRuntime } = require("./research-agent-runtime.cjs");
const { listBundledResearchSkills } = require("./research-skills.cjs");

const EVENT_CHANNEL = "zhiyan:agent:event";

function registerResearchAgentHandlers({ ipcMain, isDev, readSettings, createRuntime = createResearchAgentRuntime, runtimeStore = new Map() }) {
  const secure = (event) => assertAppSender(event, isDev);
  ipcMain.handle("zhiyan:agent:skills", (event) => {
    secure(event);
    return listBundledResearchSkills();
  });
  const getRuntime = (event) => {
    const id = event.sender.id;
    const runtime = runtimeStore.get(id);
    if (!runtime) throw new Error("Agent 会话不存在，请重新打开研究助手");
    return runtime;
  };
  ipcMain.handle("zhiyan:agent:start", async (event, context) => {
    secure(event);
    const old = runtimeStore.get(event.sender.id);
    old?.dispose();
    const runtime = createRuntime({
      emit: (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send(EVENT_CHANNEL, payload);
      },
    });
    runtimeStore.set(event.sender.id, runtime);
    event.sender.once?.("destroyed", () => {
      if (runtimeStore.get(event.sender.id) === runtime) runtimeStore.delete(event.sender.id);
      runtime.dispose();
    });
    try {
      return await runtime.start(context, readSettings());
    } catch (error) {
      runtime.dispose();
      if (runtimeStore.get(event.sender.id) === runtime) runtimeStore.delete(event.sender.id);
      throw error;
    }
  });
  ipcMain.handle("zhiyan:agent:prompt", async (event, prompt) => {
    secure(event);
    return getRuntime(event).prompt(prompt);
  });
  ipcMain.handle("zhiyan:agent:update-context", async (event, context) => {
    secure(event);
    return getRuntime(event).updateContext(context);
  });
  ipcMain.handle("zhiyan:agent:abort", async (event) => {
    secure(event);
    return runtimeStore.get(event.sender.id)?.abort();
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
  const dispose = () => {
    for (const runtime of runtimeStore.values()) runtime.dispose();
    runtimeStore.clear();
  };
  return dispose;
}

module.exports = { EVENT_CHANNEL, registerResearchAgentHandlers };
