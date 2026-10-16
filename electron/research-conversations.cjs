const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const MAX_BYTES = 64 * 1024 * 1024;
function validId(id) {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error("对话标识无效");
  return id;
}
function scopeOf(input) {
  if (!input || !["paper", "library"].includes(input.scope)) throw new Error("对话类型无效");
  if (input.scope === "paper" && (typeof input.paperId !== "string" || !input.paperId.trim() || input.paperId.length > 200)) throw new Error("单篇对话缺少论文标识");
  return { scope: input.scope, ...(input.scope === "paper" ? { paperId: input.paperId } : {}) };
}
function restored(record) {
  const result = structuredClone(record);
  for (const item of result.timeline) {
    if (item.type === "tool" && ["queued", "running", "awaiting_approval"].includes(item.tool.status)) {
      item.tool.status = "rejected";
      item.tool.error = "此操作随上次会话结束而中止，请重新发起；不会自动执行历史审批。";
    }
  }
  return result;
}
function summary(record) {
  const { timeline, ...metadata } = record;
  return { ...metadata, messageCount: timeline.filter((x) => x.type === "message").length,
    preview: timeline.filter((x) => x.type === "message").at(-1)?.message.content.replace(/\[引用:[^\]\r\n]+\]/g, "[引用]").slice(0, 100) || "暂无消息" };
}

function createConversationStore({ rootDirectory }) {
  const root = path.resolve(rootDirectory);
  const file = path.join(root, "conversations.json");
  let queue = Promise.resolve();
  const serial = (operation) => {
    const next = queue.then(operation);
    queue = next.catch(() => {});
    return next;
  };
  async function read() {
    await fs.mkdir(root, { recursive: true });
    if ((await fs.lstat(root)).isSymbolicLink()) throw new Error("对话历史目录不能是链接");
    try {
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error("对话历史文件不安全或过大");
      const data = JSON.parse(await fs.readFile(file, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.conversations) || data.conversations.length > 500) throw new Error("格式错误");
      const seen = new Set();
      for (const item of data.conversations) {
        validId(item.id); scopeOf(item);
        if (seen.has(item.id) || typeof item.title !== "string" || !Array.isArray(item.timeline)) throw new Error("格式错误");
        seen.add(item.id);
        for (const entry of item.timeline) {
          if (entry.type === "message") {
            if (!entry.message || !["user", "assistant"].includes(entry.message.role) || typeof entry.message.id !== "string" || typeof entry.message.content !== "string") throw new Error("消息格式错误");
          } else if (entry.type !== "tool" || !entry.tool || typeof entry.tool.id !== "string" || typeof entry.tool.name !== "string") throw new Error("工具格式错误");
        }
      }
      return data;
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, conversations: [] };
      throw new Error("对话历史读取失败，请保留原文件后检查或恢复备份", { cause: error });
    }
  }
  async function write(data) {
    const content = JSON.stringify(data);
    if (Buffer.byteLength(content) > MAX_BYTES) throw new Error("对话历史已达容量上限，请删除不需要的对话");
    const temporary = path.join(root, `.${randomUUID()}.tmp`);
    try { await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 }); await fs.rename(temporary, file); }
    finally { await fs.rm(temporary, { force: true }); }
  }
  const find = (data, id) => {
    validId(id);
    const item = data.conversations.find((x) => x.id === id);
    if (!item) throw new Error("对话已删除或不存在");
    return item;
  };
  return {
    create: (input) => serial(async () => {
      const scope = scopeOf(input); const data = await read();
      if (input.reuseEmpty) {
        const empty = data.conversations.find((x) => x.scope === scope.scope && x.paperId === scope.paperId && x.timeline.length === 0);
        if (empty) return restored(empty);
      }
      if (data.conversations.length >= 500) throw new Error("对话数量已达上限，请先删除不需要的对话");
      const now = Date.now();
      const item = { id: randomUUID(), ...scope, title: input.scope === "paper" ? `关于${String(input.paperTitle || "论文").slice(0, 60)}` : "新的全库对话", customTitle: false, createdAt: now, updatedAt: now, timeline: [] };
      data.conversations.push(item); await write(data); return restored(item);
    }),
    list: (input) => serial(async () => {
      const scope = scopeOf(input); const query = String(input.query || "").slice(0, 300).normalize("NFKC").toLocaleLowerCase();
      const data = await read();
      return data.conversations.filter((x) => x.scope === scope.scope && (scope.scope !== "paper" || x.paperId === scope.paperId))
        .filter((x) => !query || [x.title, ...x.timeline.filter((y) => y.type === "message").map((y) => y.message.content)].join(" ").normalize("NFKC").toLocaleLowerCase().includes(query))
        .sort((a, b) => b.updatedAt - a.updatedAt).map(summary);
    }),
    get: (id) => serial(async () => restored(find(await read(), id))),
    rename: (input) => serial(async () => {
      const title = typeof input?.title === "string" ? input.title.trim() : "";
      if (!title || title.length > 100) throw new Error("对话标题需为 1–100 个字符");
      const data = await read(); const item = find(data, input.id);
      item.title = title; item.customTitle = true; item.updatedAt = Date.now(); await write(data); return summary(item);
    }),
    remove: (id) => serial(async () => {
      const data = await read(); find(data, id); data.conversations = data.conversations.filter((x) => x.id !== id); await write(data); return true;
    }),
    record: (id, event) => serial(async () => {
      if (!event || !["message_start", "message_delta", "message_end", "tool_start", "tool_end"].includes(event.type)) return;
      if (JSON.stringify(event).length > 250000) throw new Error("对话消息过大，无法保存");
      const data = await read(); const item = find(data, id);
      if (event.type === "message_delta") {
        if (typeof event.messageId !== "string" || typeof event.delta !== "string") throw new Error("消息增量无效");
        let entry = item.timeline.find((x) => x.type === "message" && x.message.id === event.messageId);
        if (!entry) { entry = { type: "message", message: { id: event.messageId, role: "assistant", content: "", createdAt: new Date().toISOString() } }; item.timeline.push(entry); }
        entry.message.content = (entry.message.content + event.delta).slice(0, 200000);
      } else {
        const type = event.type.startsWith("message") ? "message" : "tool";
        const value = event[type];
        if (!value || typeof value.id !== "string" || (type === "message" && (!["user", "assistant"].includes(value.role) || typeof value.content !== "string"))) throw new Error("对话事件无效");
        const existing = item.timeline.find((x) => x.type === type && x[type].id === value.id);
        if (existing) existing[type] = structuredClone(value); else item.timeline.push({ type, [type]: structuredClone(value) });
        if (type === "message" && value.role === "user" && !item.customTitle && item.timeline.filter((x) => x.type === "message" && x.message.role === "user").length === 1) item.title = value.content.trim().replace(/\s+/g, " ").slice(0, 60) || item.title;
      }
      item.updatedAt = Date.now(); await write(data);
    }),
  };
}
module.exports = { createConversationStore };
