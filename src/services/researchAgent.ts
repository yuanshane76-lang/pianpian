import type { PaperRecord } from "../domain/library";
import { getDesktopBridge } from "../platform/electron";
import { normalizeResearchAgentEvent, type ResearchAgentEvent, type ResearchAgentMessage, type ResearchAgentPaperSummary } from "./researchAgentProtocol";

export interface ResearchAgentContext {
  paper: {
    id: string;
    title: string;
    authors: string[];
    year: number | null;
    blocks: Array<{ id: string; pageNumber: number; text: string }>;
  };
  library: Array<{ id: string; title: string; authors: string[]; year: number | null; doi?: string }>;
}

export function createResearchAgentContext(paper: PaperRecord, library: PaperRecord[]): ResearchAgentContext {
  let remaining = 500_000;
  return {
    paper: {
      id: paper.id,
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      blocks: (paper.blockData ?? []).slice(0, 800).map((block) => {
        const text = block.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, Math.min(6000, remaining));
        remaining -= text.length;
        return { id: block.id, pageNumber: block.pageNumber, text };
      }).filter((block) => block.text),
    },
    library: library.slice(0, 500).map((item) => ({
      id: item.id,
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
    try { event = normalizeResearchAgentEvent(payload); }
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

export async function abortResearchAgent(): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  await bridge.invoke("zhiyan:agent:abort");
}

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
