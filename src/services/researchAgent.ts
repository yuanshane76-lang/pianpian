import type { PaperRecord } from "../domain/library";
import { getDesktopBridge } from "../platform/electron";
import { normalizeResearchAgentEvent, normalizeResearchAgentSkills, type ResearchAgentEvent, type ResearchAgentMessage, type ResearchAgentPaperSummary, type ResearchAgentSkill } from "./researchAgentProtocol";

export interface ResearchAgentContext {
  scope?: "paper" | "library";
  conversationId?: string;
  paper: {
    id: string;
    title: string;
    authors: string[];
    year: number | null;
    blocks: Array<{ id: string; pageNumber: number; text: string }>;
  } | null;
  library: Array<{ id: string; originalId?: string; title: string; authors: string[]; year: number | null; doi?: string }>;
}

export function createResearchAgentContext(paper: PaperRecord, library: PaperRecord[], scope: "paper" | "library" = "paper"): ResearchAgentContext {
  let remaining = 500_000;
  return {
    scope,
    paper: scope === "paper" ? {
      id: paper.id,
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      blocks: (paper.blockData ?? []).slice(0, 800).map((block) => {
        const text = block.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, Math.min(6000, remaining));
        remaining -= text.length;
        return { id: block.id, pageNumber: block.pageNumber, text };
      }).filter((block) => block.text),
    } : null,
    library: library.map((item) => ({
      id: item.id,
      originalId: item.originalId,
      title: item.title,
      authors: item.authors,
      year: item.year,
      doi: item.doi,
    })),
  };
}

export function createAgentMessage(role: ResearchAgentMessage["role"], content: string): ResearchAgentMessage {
  return { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() };
}

export function subscribeToResearchAgent(onEvent: (event: ResearchAgentEvent) => void): () => void {
  const bridge = getDesktopBridge();
  if (!bridge?.on) return () => undefined;
  return bridge.on("zhiyan:agent:event", (payload) => {
    let event: ResearchAgentEvent;
    try {
      event = normalizeResearchAgentEvent(payload);
      if (payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).conversationId === "string") event.conversationId = (payload as { conversationId: string }).conversationId;
    }
    catch {
      const source = payload && typeof payload === "object" ? payload as Record<string, any> : {};
      const id = source.tool?.id ?? source.toolCallId;
      const name = source.tool?.name ?? (source.type === "approval_required" ? "add_paper_to_library" : undefined);
      if (typeof id === "string" && id.length > 0 && id.length <= 200
        && typeof name === "string" && name.length > 0 && name.length <= 100) {
        onEvent({ type: "tool_end", tool: { id, name, label: "工具结果", status: "failed",
          input: {}, error: "工具结果无法显示，请重试或缩小检索范围" } });
      }
      onEvent({ type: "agent_error", message: "工具结果无法显示，本轮已停止，请重试或缩小检索范围", recoverable: true });
      void abortResearchAgent().catch(() => undefined);
      return;
    }
    onEvent(event);
  }) ?? (() => undefined);
}

export async function startResearchAgent(context: ResearchAgentContext): Promise<{ sessionId: string }> {
  const bridge = getDesktopBridge();
  if (!bridge?.on) throw new Error("研究 Agent 需要在纸研桌面端中使用");
  return bridge.invoke("zhiyan:agent:start", context);
}

export async function getResearchAgentSkills(): Promise<ResearchAgentSkill[]> {
  const bridge = getDesktopBridge();
  if (!bridge) return [];
  return normalizeResearchAgentSkills(await bridge.invoke("zhiyan:agent:skills"));
}

export async function promptResearchAgent(prompt: string): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  await bridge.invoke("zhiyan:agent:prompt", prompt);
}

export async function updateResearchAgentContext(context: ResearchAgentContext): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  await bridge.invoke("zhiyan:agent:update-context", context);
}

export async function abortResearchAgent(conversationId?: string): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  if (conversationId) await bridge.invoke("zhiyan:agent:abort", { conversationId });
  else await bridge.invoke("zhiyan:agent:abort");
}

export type ConversationScope = { scope: "library" } | { scope: "paper"; paperId: string; paperTitle?: string };
export type ResearchTimelineItem = { type: "message"; message: ResearchAgentMessage } | { type: "tool"; tool: import("./researchAgentProtocol").ResearchAgentToolCall };
export interface ConversationSummary {
  id: string; scope: "paper" | "library"; paperId?: string; title: string; updatedAt: number; messageCount: number; preview: string;
}
export interface ResearchConversation extends ConversationSummary { timeline: ResearchTimelineItem[] }
async function historyCall<T>(action: string, input: unknown): Promise<T> {
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error("对话历史需要在纸研桌面端中使用");
  return bridge.invoke<T>(`zhiyan:agent:conversations:${action}`, input);
}
function normalizeConversation(value: ResearchConversation): ResearchConversation {
  if (!value || typeof value.id !== "string" || !Array.isArray(value.timeline)) throw new Error("对话历史格式无效");
  return { ...value, timeline: value.timeline.map((item) => {
    const event = normalizeResearchAgentEvent(item.type === "message" ? { type: "message_end", message: item.message } : { type: "tool_end", tool: item.tool });
    if (event.type === "message_end") return { type: "message", message: event.message };
    if (event.type === "tool_end") return { type: "tool", tool: event.tool };
    throw new Error("对话历史条目无效");
  }) };
}
export const listResearchConversations = (scope: ConversationScope, query = "") => historyCall<ConversationSummary[]>("list", { ...scope, query });
export const createResearchConversation = async (scope: ConversationScope) => normalizeConversation(await historyCall<ResearchConversation>("create", { ...scope, reuseEmpty: true }));
export const getResearchConversation = async (id: string) => normalizeConversation(await historyCall<ResearchConversation>("get", id));
export const renameResearchConversation = (id: string, title: string) => historyCall<ConversationSummary>("rename", { id, title });
export const deleteResearchConversation = (id: string) => historyCall<boolean>("delete", id);

export async function approveResearchAgent(input: {
  approvalId: string;
  approved: boolean;
  paper?: ResearchAgentPaperSummary;
  result?: unknown;
}): Promise<boolean> {
  const bridge = getDesktopBridge();
  if (!bridge) return false;
  return bridge.invoke<boolean>("zhiyan:agent:approve", input);
}
