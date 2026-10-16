// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const roots: string[] = [];
async function fixture() {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "zhiyan-conversations-"));
  roots.push(rootDirectory);
  const { createConversationStore } = require("../../electron/research-conversations.cjs");
  return { rootDirectory, store: createConversationStore({ rootDirectory }), createConversationStore };
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe("durable research conversations", () => {
  it("serializes concurrent writes, reuses only empty drafts and never recreates a deleted record", async () => {
    const { store } = await fixture();
    const [first, same] = await Promise.all([store.create({ scope: "library", reuseEmpty: true }), store.create({ scope: "library", reuseEmpty: true })]);
    expect(first.id).toBe(same.id);
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.record(first.id, { type: "message_delta", messageId: "a", delta: String(i) })));
    expect((await store.get(first.id)).timeline[0].message.content).toBe("0123456789");
    const next = await store.create({ scope: "library", reuseEmpty: true });
    expect(next.id).not.toBe(first.id);
    await store.remove(first.id);
    await expect(store.record(first.id, { type: "message_delta", messageId: "a", delta: "late" })).rejects.toThrow("删除");
    expect((await store.list({ scope: "library" })).map((x: any) => x.id)).toEqual([next.id]);
  });
  it("creates isolated histories, searches message content, renames and deletes durably", async () => {
    const { store, rootDirectory, createConversationStore } = await fixture();
    const global = await store.create({ scope: "library" });
    const paper = await store.create({ scope: "paper", paperId: "p1", paperTitle: "论文一" });
    await store.record(global.id, { type: "message_start", message: { id: "u1", role: "user", content: "比较注意力方法" } });
    await store.record(global.id, { type: "message_delta", messageId: "a1", delta: "已有结论" });
    await store.record(global.id, { type: "message_end", message: { id: "a1", role: "assistant", content: "已有结论" } });
    expect((await store.list({ scope: "library", query: "注意力" })).map((x: any) => x.id)).toEqual([global.id]);
    expect((await store.list({ scope: "paper", paperId: "p1" })).map((x: any) => x.id)).toEqual([paper.id]);
    expect(await store.list({ scope: "paper", paperId: "p2" })).toEqual([]);
    await store.rename({ id: global.id, title: "方法对比" });
    const reloaded = createConversationStore({ rootDirectory });
    expect(await reloaded.get(global.id)).toMatchObject({ title: "方法对比", timeline: [
      { type: "message", message: { content: "比较注意力方法" } }, { type: "message", message: { content: "已有结论" } },
    ] });
    await reloaded.remove(global.id);
    expect(await createConversationStore({ rootDirectory }).list({ scope: "library" })).toEqual([]);
  });
  it("preserves partial output but never revives old approvals or running tools", async () => {
    const { store, rootDirectory, createConversationStore } = await fixture();
    const item = await store.create({ scope: "library" });
    await store.record(item.id, { type: "message_delta", messageId: "a", delta: "未完成的回答" });
    await store.record(item.id, { type: "tool_start", tool: { id: "t", name: "add_paper_to_library", label: "加入", input: {}, status: "running" } });
    const restored = await createConversationStore({ rootDirectory }).get(item.id);
    expect(restored.timeline[0].message.content).toBe("未完成的回答");
    expect(restored.timeline[1].tool.status).toBe("rejected");
  });
  it("shows readable history previews without changing stored source references", async () => {
    const { store } = await fixture();
    const item = await store.create({ scope: "library" });
    const content = "实验结论[引用:paper-1::paragraph-2]。";
    await store.record(item.id, { type: "message_end", message: { id: "a", role: "assistant", content } });
    expect((await store.list({ scope: "library" }))[0].preview).toBe("实验结论[引用]。");
    expect((await store.get(item.id)).timeline[0].message.content).toBe(content);
  });
  it("rejects unsafe IDs and corrupt data without replacing the original file", async () => {
    const { store, rootDirectory } = await fixture();
    await expect(store.get("../outside")).rejects.toThrow();
    await expect(store.create({ scope: "paper" })).rejects.toThrow();
    await store.create({ scope: "library" });
    const file = path.join(rootDirectory, "conversations.json");
    await writeFile(file, "broken-json");
    const { createConversationStore } = require("../../electron/research-conversations.cjs");
    await expect(createConversationStore({ rootDirectory }).create({ scope: "library" })).rejects.toThrow("历史");
    expect(await readFile(file, "utf8")).toBe("broken-json");
  });
});
