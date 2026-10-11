import { describe, expect, it } from "vitest";
import {
  normalizeResearchAgentEvent,
  type ResearchAgentEvent,
  type ResearchAgentToolCall,
} from "./researchAgentProtocol";

describe("research agent protocol", () => {
  it("accepts a tool start event and preserves its structured input", () => {
    const event = normalizeResearchAgentEvent({
      type: "tool_start",
      tool: {
        id: "tool-1",
        name: "search_literature",
        label: "检索文献",
        status: "running",
        input: { query: "graph neural networks", limit: 3 },
      },
    });

    expect(event).toEqual<ResearchAgentEvent>({
      type: "tool_start",
      tool: {
        id: "tool-1",
        name: "search_literature",
        label: "检索文献",
        status: "running",
        input: { query: "graph neural networks", limit: 3 },
      },
    });
  });

  it("rejects unknown tool states and oversized message deltas", () => {
    expect(() =>
      normalizeResearchAgentEvent({
        type: "tool_end",
        tool: {
          id: "tool-1",
          name: "search_literature",
          label: "检索文献",
          status: "unknown",
          input: {},
        },
      }),
    ).toThrow("工具状态无效");

    expect(() =>
      normalizeResearchAgentEvent({
        type: "message_delta",
        messageId: "message-1",
        delta: "a".repeat(20_001),
      }),
    ).toThrow("消息片段过长");
  });

  it("normalizes approval requests with a safe paper summary", () => {
    const event = normalizeResearchAgentEvent({
      type: "approval_required",
      approvalId: "approval-1",
      toolCallId: "tool-2",
      paper: {
        title: "A paper",
        authors: ["Alice"],
        year: 2025,
        doi: "10.1234/example",
        landingUrl: "https://example.org/paper",
      },
    });

    expect(event).toMatchObject({
      type: "approval_required",
      approvalId: "approval-1",
      toolCallId: "tool-2",
      paper: {
        title: "A paper",
        authors: ["Alice"],
        year: 2025,
      },
    });
  });

  it("accepts the complete shape used by the renderer", () => {
    const tool: ResearchAgentToolCall = {
      id: "tool-3",
      name: "read_current_paper",
      label: "读取当前论文",
      status: "completed",
      input: { paperId: "paper-1" },
      output: { pages: [1, 2] },
    };

    expect(normalizeResearchAgentEvent({ type: "tool_end", tool })).toEqual({
      type: "tool_end",
      tool,
    });
  });
});
