export const RESEARCH_AGENT_LIMITS = {
  messageDelta: 20_000,
  message: 200_000,
  toolOutput: 100_000,
  citations: 20,
  authors: 20,
} as const;

export type ResearchAgentToolStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "awaiting_approval"
  | "rejected";

export interface ResearchAgentPaperSummary {
  title: string;
  authors: string[];
  year: number | null;
  doi?: string;
  landingUrl?: string;
  abstract?: string;
  source?: string;
}

export interface ResearchAgentCitation {
  referenceId?: string;
  paperId?: string;
  blockId?: string;
  pageNumber?: number;
  label: string;
}

export interface ResearchAgentToolCall {
  id: string;
  name: string;
  label: string;
  status: ResearchAgentToolStatus;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ResearchAgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: ResearchAgentCitation[];
  createdAt?: string;
}

export interface ResearchAgentApproval {
  approvalId: string;
  toolCallId: string;
  paper: ResearchAgentPaperSummary;
}

export interface ResearchAgentSkill {
  name: string;
  title: string;
  prompt: string;
}

type ResearchAgentEventPayload =
  | { type: "session_started"; sessionId: string; skills?: ResearchAgentSkill[] }
  | { type: "message_start"; message: ResearchAgentMessage }
  | { type: "message_delta"; messageId: string; delta: string }
  | { type: "message_end"; message: ResearchAgentMessage }
  | { type: "tool_start"; tool: ResearchAgentToolCall }
  | { type: "tool_update"; tool: ResearchAgentToolCall }
  | { type: "tool_end"; tool: ResearchAgentToolCall }
  | ({ type: "approval_required" } & ResearchAgentApproval)
  | { type: "agent_end"; messageId?: string }
  | { type: "agent_error"; message: string; recoverable: boolean };
export type ResearchAgentEvent = ResearchAgentEventPayload & { conversationId?: string };

const TOOL_STATUSES = new Set<ResearchAgentToolStatus>([
  "queued",
  "running",
  "completed",
  "failed",
  "awaiting_approval",
  "rejected",
]);

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field}无效`);
  }
  const text = value.trim();
  if (text.length > max) throw new Error(`${field}过长`);
  return text;
}

function optionalText(value: unknown, field: string, max = 20_000): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${field}无效`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${field}过长`);
  return text || undefined;
}

function normalizeAuthors(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > RESEARCH_AGENT_LIMITS.authors) {
    throw new Error("作者列表无效");
  }
  return value.map((author) => requiredText(author, "作者", 200));
}

function normalizePaper(value: unknown): ResearchAgentPaperSummary {
  const source = record(value, "论文信息无效");
  const year = source.year;
  if (year !== null && (typeof year !== "number" || !Number.isInteger(year))) {
    throw new Error("论文年份无效");
  }
  const landingUrl = optionalText(source.landingUrl, "论文链接", 2_000);
  if (landingUrl && !/^https?:\/\//i.test(landingUrl)) {
    throw new Error("论文链接无效");
  }
  return {
    title: requiredText(source.title, "论文标题", 500),
    authors: normalizeAuthors(source.authors ?? []),
    year,
    doi: optionalText(source.doi, "DOI", 500),
    landingUrl,
    abstract: optionalText(source.abstract, "论文摘要", 20_000),
    source: optionalText(source.source, "论文来源", 200),
  };
}

function normalizeTool(value: unknown): ResearchAgentToolCall {
  const source = record(value, "工具信息无效");
  const status = source.status;
  if (typeof status !== "string" || !TOOL_STATUSES.has(status as ResearchAgentToolStatus)) {
    throw new Error("工具状态无效");
  }
  const input = record(source.input ?? {}, "工具参数无效");
  const output = source.output;
  let outputSize = 0;
  if (output !== undefined) {
    try { outputSize = JSON.stringify(output).length; } catch { throw new Error("工具输出无效"); }
  }
  if (outputSize > RESEARCH_AGENT_LIMITS.toolOutput) {
    throw new Error("工具输出过长");
  }
  return {
    id: requiredText(source.id, "工具 ID", 200),
    name: requiredText(source.name, "工具名称", 100),
    label: requiredText(source.label, "工具标题", 100),
    status: status as ResearchAgentToolStatus,
    input,
    ...(output === undefined ? {} : { output }),
    ...(optionalText(source.error, "工具错误", 2_000)
      ? { error: optionalText(source.error, "工具错误", 2_000) }
      : {}),
    ...(optionalText(source.startedAt, "工具开始时间", 100)
      ? { startedAt: optionalText(source.startedAt, "工具开始时间", 100) }
      : {}),
    ...(optionalText(source.finishedAt, "工具结束时间", 100)
      ? { finishedAt: optionalText(source.finishedAt, "工具结束时间", 100) }
      : {}),
  };
}

function normalizeMessage(value: unknown): ResearchAgentMessage {
  const source = record(value, "消息无效");
  const role = source.role;
  if (role !== "user" && role !== "assistant") throw new Error("消息角色无效");
  if (typeof source.content !== "string" || source.content.length > RESEARCH_AGENT_LIMITS.message) throw new Error("消息内容无效");
  const content = source.content;
  const citations = source.citations;
  if (citations !== undefined) {
    if (!Array.isArray(citations) || citations.length > RESEARCH_AGENT_LIMITS.citations) {
      throw new Error("引用列表无效");
    }
  }
  return {
    id: requiredText(source.id, "消息 ID", 200),
    role,
    content,
    ...(Array.isArray(citations)
      ? {
          citations: citations.map((citation) => {
            const item = record(citation, "引用无效");
            return {
              ...(typeof item.paperId === "string" ? { paperId: item.paperId } : {}),
              ...(typeof item.blockId === "string" ? { blockId: item.blockId } : {}),
              ...(typeof item.referenceId === "string" ? { referenceId: item.referenceId } : {}),
              ...(typeof item.pageNumber === "number" ? { pageNumber: item.pageNumber } : {}),
              label: requiredText(item.label, "引用标签", 200),
            };
          }),
        }
      : {}),
    ...(optionalText(source.createdAt, "消息时间", 100)
      ? { createdAt: optionalText(source.createdAt, "消息时间", 100) }
      : {}),
  };
}

export function normalizeResearchAgentSkills(value: unknown): ResearchAgentSkill[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error("研究技能列表无效");
  return value.map((entry) => {
    const source = record(entry, "研究技能无效");
    const name = requiredText(source.name, "技能名称", 64);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error("技能名称无效");
    return { name, title: requiredText(source.title, "技能标题", 100), prompt: requiredText(source.prompt, "技能问题", 2000) };
  });
}

export function normalizeResearchAgentEvent(value: unknown): ResearchAgentEvent {
  const source = record(value, "Agent 事件无效");
  const type = requiredText(source.type, "Agent 事件类型", 100);

  switch (type) {
    case "session_started": {
      return {
        type,
        sessionId: requiredText(source.sessionId, "会话 ID", 200),
        ...(source.skills === undefined ? {} : { skills: normalizeResearchAgentSkills(source.skills) }),
      };
    }
    case "message_start":
    case "message_end":
      return { type, message: normalizeMessage(source.message) };
    case "message_delta": {
      if (typeof source.delta !== "string" || source.delta.length > RESEARCH_AGENT_LIMITS.messageDelta) throw new Error("消息片段过长");
      const delta = source.delta;
      return {
        type,
        messageId: requiredText(source.messageId, "消息 ID", 200),
        delta,
      };
    }
    case "tool_start":
    case "tool_update":
    case "tool_end":
      return { type, tool: normalizeTool(source.tool) };
    case "approval_required":
      return {
        type,
        approvalId: requiredText(source.approvalId, "审批 ID", 200),
        toolCallId: requiredText(source.toolCallId, "工具调用 ID", 200),
        paper: normalizePaper(source.paper),
      };
    case "agent_end":
      return {
        type,
        ...(source.messageId === undefined
          ? {}
          : { messageId: requiredText(source.messageId, "消息 ID", 200) }),
      };
    case "agent_error":
      return {
        type,
        message: requiredText(source.message, "Agent 错误", 4_000),
        recoverable: source.recoverable !== false,
      };
    default:
      throw new Error(`未知 Agent 事件：${type}`);
  }
}
