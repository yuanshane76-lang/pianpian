import { Check, ChevronDown, FileText, LoaderCircle, RotateCcw, Send, Square, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { PaperRecord } from "../../domain/library";
import {
  abortResearchAgent,
  approveResearchAgent,
  createResearchAgentContext,
  promptResearchAgent,
  startResearchAgent,
  subscribeToResearchAgent,
  updateResearchAgentContext,
} from "../../services/researchAgent";
import type { ResearchAgentEvent, ResearchAgentMessage, ResearchAgentPaperSummary, ResearchAgentToolCall } from "../../services/researchAgentProtocol";
import { getDesktopBridge } from "../../platform/electron";
import { MarkdownContent } from "./MarkdownContent";

interface ResearchDocument {
  title: string;
  markdown: string;
}

interface ResearchAssistantProps {
  paper: PaperRecord;
  library: PaperRecord[];
  onAddPaper: (paper: ResearchAgentPaperSummary) => { id: string; duplicate: boolean } | void;
  onJump: (blockId: string) => void;
  onSaveDocument?: (document: ResearchDocument) => void;
  available: boolean;
  configurationRevision?: string;
  onOpenSettings: () => void;
}

type TimelineItem =
  | { type: "message"; message: ResearchAgentMessage }
  | { type: "tool"; tool: ResearchAgentToolCall };

const toolLabels: Record<string, string> = {
  read_current_paper: "读取当前论文",
  search_library: "搜索本地文献库",
  search_literature: "检索公开文献",
  add_paper_to_library: "请求加入文献库",
  create_document: "生成 Markdown 文档",
};

function toolStatus(status: ResearchAgentToolCall["status"]) {
  return {
    queued: "排队中",
    running: "执行中",
    completed: "已完成",
    failed: "失败",
    awaiting_approval: "等待确认",
    rejected: "已拒绝",
  }[status];
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function ToolCard({ tool, approvalPaper, onApprove, onReject, onSaveDocument }: {
  tool: ResearchAgentToolCall;
  approvalPaper?: ResearchAgentPaperSummary;
  onApprove?: () => void;
  onReject?: () => void;
  onSaveDocument?: (document: ResearchDocument) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const output = isRecord(tool.output) ? tool.output : undefined;
  const papers = Array.isArray(output?.papers) ? output.papers : [];
  const document = isRecord(output?.document) && typeof output.document.markdown === "string"
    ? output.document as ResearchDocument
    : undefined;

  return (
    <article className={`research-tool-card is-${tool.status}`} aria-label={`工具：${tool.label}`}>
      <button className="research-tool-heading" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
        <span className="research-tool-icon">{tool.status === "running" ? <LoaderCircle className="spin" size={15} /> : <Wrench size={15} />}</span>
        <span className="research-tool-name">{toolLabels[tool.name] ?? tool.label}</span>
        <span className="research-tool-status">{toolStatus(tool.status)}</span>
        <ChevronDown size={14} className={expanded ? "is-open" : ""} />
      </button>
      {tool.error ? <p className="research-tool-error">{tool.error}</p> : null}
      {tool.status === "awaiting_approval" && approvalPaper ? (
        <div className="research-approval">
          <div>
            <strong>加入《{approvalPaper.title}》？</strong>
            <span>{approvalPaper.authors.join("、") || "作者待补充"} · {approvalPaper.year ?? "年份待补充"}</span>
          </div>
          <div className="research-approval-actions">
            <button type="button" className="primary-button compact" onClick={onApprove}><Check size={14} />确认加入</button>
            <button type="button" className="secondary-button compact" onClick={onReject}><X size={14} />拒绝</button>
          </div>
        </div>
      ) : null}
      {tool.status === "completed" && papers.length ? (
        <div className="research-result-list">
          {papers.slice(0, 5).map((paper: any, index: number) => (
            <div className="research-result-item" key={`${paper.doi ?? paper.title}-${index}`}>
              <span className="research-result-index">{index + 1}</span>
              <div><strong>{paper.title}</strong><span>{paper.authors?.join("、") || "作者待补充"} · {paper.year ?? "年份待补充"}{paper.doi ? ` · ${paper.doi}` : ""}</span></div>
            </div>
          ))}
        </div>
      ) : null}
      {document ? (
        <div className="research-document-card">
          <div><FileText size={15} /><strong>{document.title}</strong></div>
          <button type="button" className="secondary-button compact" aria-label="保存 Markdown 文档" onClick={() => onSaveDocument?.(document)}>保存草稿</button>
        </div>
      ) : null}
      {expanded ? <pre className="research-tool-output">{JSON.stringify(tool.output ?? tool.input, null, 2)}</pre> : null}
    </article>
  );
}

function updateTimeline(items: TimelineItem[], next: TimelineItem): TimelineItem[] {
  const id = next.type === "message" ? next.message.id : next.tool.id;
  const index = items.findIndex((item) => (item.type === "message" ? item.message.id : item.tool.id) === id);
  if (index < 0) return [...items, next];
  return items.map((item, itemIndex) => itemIndex === index ? next : item);
}

export function ResearchAssistant({ paper, library, onAddPaper, onJump, onSaveDocument, available, onOpenSettings, configurationRevision }: ResearchAssistantProps) {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [approvalByToolId, setApprovalByToolId] = useState<Record<string, { approvalId: string; paper: ResearchAgentPaperSummary }>>({});
  const [streaming, setStreaming] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastQuestion = useRef("");
  const paperContext = useMemo(() => createResearchAgentContext(paper, library), [
    paper.id, paper.title, paper.authors, paper.year, paper.blockData,
    library.map((item) => `${item.id}:${item.title}:${item.doi ?? ""}:${item.year ?? ""}`).join("|"),
  ]);
  const startedRef = useRef(false);
  const latestContext = useRef(paperContext);
  latestContext.current = paperContext;
  const confirmingTools = useRef(new Set<string>());
  const sessionEpoch = useRef(0);
  const activeApprovals = useRef(approvalByToolId);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    sessionEpoch.current += 1;
    activeApprovals.current = {};
    setTimeline([]);
    setBusy(false);
    setReady(false);
    setQuestion("");
    setError(null);
    setSavedNotice(null);
    setApprovalByToolId({});
    setStreaming({});
    const unsubscribe = subscribeToResearchAgent((event: ResearchAgentEvent) => {
      if (disposed) return;
      if (event.type === "message_start") setTimeline((current) => updateTimeline(current, { type: "message", message: event.message }));
      if (event.type === "message_delta") {
        setStreaming((current) => ({ ...current, [event.messageId]: `${current[event.messageId] ?? ""}${event.delta}` }));
        setTimeline((current) => updateTimeline(current, {
          type: "message",
          message: { id: event.messageId, role: "assistant", content: "" },
        }));
      }
      if (event.type === "message_end") {
        setStreaming((current) => {
          const next = { ...current };
          delete next[event.message.id];
          return next;
        });
        setTimeline((current) => updateTimeline(current, { type: "message", message: event.message }));
      }
      if (event.type === "tool_start" || event.type === "tool_update" || event.type === "tool_end") {
        setTimeline((current) => updateTimeline(current, { type: "tool", tool: event.tool }));
      }
      if (event.type === "approval_required") {
        activeApprovals.current = { ...activeApprovals.current, [event.toolCallId]: { approvalId: event.approvalId, paper: event.paper } };
        setApprovalByToolId((current) => ({ ...current, [event.toolCallId]: { approvalId: event.approvalId, paper: event.paper } }));
        setTimeline((current) => updateTimeline(current, {
          type: "tool",
          tool: {
            id: event.toolCallId,
            name: "add_paper_to_library",
            label: "请求加入文献库",
            status: "awaiting_approval",
            input: {},
            output: { paper: event.paper },
          },
        }));
      }
      if (event.type === "agent_error") {
        activeApprovals.current = {};
        setApprovalByToolId({});
        setError(event.message);
        setBusy(false);
      }
      if (event.type === "agent_end") {
        activeApprovals.current = {};
        setBusy(false);
        setApprovalByToolId({});
        setTimeline((current) => current.map((item) => item.type === "tool" && ["queued", "running", "awaiting_approval"].includes(item.tool.status)
          ? { ...item, tool: { ...item.tool, status: "rejected", error: "执行已结束" } } : item));
      }
    });
    void startResearchAgent(paperContext).then(() => {
      if (!disposed) {
        startedRef.current = true;
        setReady(true);
        void updateResearchAgentContext(latestContext.current).catch((reason) => {
          if (!disposed) setError(reason instanceof Error ? reason.message : "论文上下文更新失败");
        });
      }
    }).catch((reason) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : "研究助手启动失败");
    });
    return () => {
      disposed = true;
      sessionEpoch.current += 1;
      activeApprovals.current = {};
      startedRef.current = false;
      unsubscribe();
      void abortResearchAgent().catch(() => undefined);
    };
  }, [paper.id, paper.blockData, configurationRevision]);

  useEffect(() => {
    if (!startedRef.current) return;
    void updateResearchAgentContext(paperContext).catch((reason) => {
      if (reason instanceof Error && !/会话不存在/.test(reason.message)) setError(reason.message);
    });
  }, [paperContext]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element && typeof element.scrollTo === "function") element.scrollTo({ top: element.scrollHeight });
  }, [timeline, streaming, error]);

  async function submit(retryQuestion?: string) {
    const value = (retryQuestion ?? question).trim();
    if (!value || busy || !ready || !available) return;
    setQuestion("");
    setError(null);
    setBusy(true);
    lastQuestion.current = value;
    try {
      await promptResearchAgent(value);
    } catch (reason) {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : "发送失败，请重试");
    }
  }

  async function approve(toolId: string, approved: boolean) {
    const approval = activeApprovals.current[toolId];
    if (!approval || confirmingTools.current.has(toolId)) return;
    const epoch = sessionEpoch.current;
    const stillActive = () => sessionEpoch.current === epoch
      && activeApprovals.current[toolId]?.approvalId === approval.approvalId;
    confirmingTools.current.add(toolId);
    let result;
    try {
      if (approved) {
        const reserved = await approveResearchAgent({ approvalId: approval.approvalId, approved: true });
        if (!stillActive()) return;
        if (!reserved) throw new Error("这条确认已失效，请重新发起加入请求");
        result = onAddPaper(approval.paper) || { completed: true };
      }
      const completed = await approveResearchAgent({ approvalId: approval.approvalId, approved, result });
      if (!completed) throw new Error("文献库写入确认已失效");
    } catch (reason) {
      if (stillActive()) setError(reason instanceof Error ? reason.message : "文献库写入失败，请重试");
      await approveResearchAgent({ approvalId: approval.approvalId, approved: false }).catch(() => undefined);
      return;
    } finally {
      confirmingTools.current.delete(toolId);
    }
    if (!stillActive()) return;
    delete activeApprovals.current[toolId];
    setApprovalByToolId((current) => {
      const next = { ...current };
      delete next[toolId];
      return next;
    });
    if (!approved) setTimeline((current) => current.map((item) => item.type === "tool" && item.tool.id === toolId
      ? { ...item, tool: { ...item.tool, status: "rejected" } } : item));
  }

  async function stop() {
    activeApprovals.current = {};
    setApprovalByToolId({});
    try { await abortResearchAgent(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "停止失败，请重试"); }
  }

  async function saveDocument(draft: ResearchDocument) {
    if (onSaveDocument) {
      onSaveDocument(draft);
      return;
    }
    const bridge = getDesktopBridge();
    if (bridge) {
      try {
        const result = await bridge.invoke<{ saved: boolean }>("zhiyan:agent:save-document", draft);
        if (result.saved) setSavedNotice(`《${draft.title}》已保存`);
      }
      catch (reason) { setError(reason instanceof Error ? reason.message : "文档保存失败"); }
      return;
    }
    const blob = new Blob([draft.markdown], { type: "text/markdown;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${draft.title.replace(/[\\/:*?"<>|]/g, "_")}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }

  const hasConversation = timeline.length > 0;
  return (
    <section className="research-assistant-panel" aria-label="研究 Agent">
      <div className="research-agent-banner">
        <div className="research-agent-title"><span className="research-agent-mark"><Wrench size={15} /></span><div><strong>研究 Agent</strong><span>Pi · 受控工具模式</span></div></div>
        <span className={`research-agent-state ${busy ? "is-busy" : ""}`}><span className="status-dot" />{busy ? "工作中" : ready ? "就绪" : available ? "连接中" : "待配置"}</span>
      </div>
      <div ref={scrollRef} className="research-agent-scroll">
        {!hasConversation ? <div className="research-agent-empty"><div className="research-agent-empty-icon"><FileText size={22} /></div><strong>从这篇论文开始研究</strong><p>你可以让我读懂论文、检索相关文献，或者生成一份阅读笔记。</p><div className="research-agent-prompts"><button type="button" onClick={() => setQuestion("概括这篇论文的研究问题、方法和主要结论")}>概括论文</button><button type="button" onClick={() => setQuestion("查找与这篇论文相关的文献")}>查找文献</button><button type="button" onClick={() => setQuestion("生成一份阅读笔记文档")}>生成笔记</button></div></div> : null}
        {timeline.map((item) => {
          if (item.type === "tool") {
            const approval = approvalByToolId[item.tool.id];
            const output = isRecord(item.tool.output) ? item.tool.output : undefined;
            return <div key={`tool-${item.tool.id}`}><ToolCard tool={item.tool} approvalPaper={approval?.paper} onApprove={() => void approve(item.tool.id, true)} onReject={() => void approve(item.tool.id, false)} onSaveDocument={(draft) => void saveDocument(draft)} />{Array.isArray(output?.citations) ? <div className="research-citations">{output.citations.slice(0, 4).map((citation: any) => <button key={citation.blockId} type="button" onClick={() => onJump(citation.blockId)}>{citation.label}</button>)}</div> : null}</div>;
          }
          const content = streaming[item.message.id] ?? item.message.content;
          return <article className={`research-message is-${item.message.role}`} key={`message-${item.message.id}`}><div className="research-message-label">{item.message.role === "user" ? "你" : "研究 Agent"}</div><div className="research-message-content">{content ? <MarkdownContent text={content} /> : <span className="research-placeholder">正在组织回答…</span>}</div></article>;
        })}
        {error ? <div className="research-agent-error" role="alert"><span>{error}</span>{lastQuestion.current ? <button type="button" disabled={busy} onClick={() => void submit(lastQuestion.current)}><RotateCcw size={14} />重试问题</button> : null}</div> : null}
      </div>
      <div className="research-agent-composer">
        {savedNotice ? <div className="research-save-notice" role="status">{savedNotice}</div> : null}
        {!available ? <button type="button" className="research-config-hint" onClick={onOpenSettings}>请先配置模型服务，配置后即可启用研究 Agent。</button> : null}
        <div className="research-input-wrap"><textarea aria-label="向研究 Agent 提问" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={onKeyDown} placeholder="问问这篇论文，或让 Agent 查找相关文献…" rows={3} /><div className="research-input-actions"><span>Ctrl / ⌘ + Enter 发送</span>{busy ? <button type="button" className="research-stop-button" aria-label="停止 Agent" onClick={() => void stop()}><Square size={14} />停止</button> : <button type="button" className="research-send-button" aria-label="发送给研究 Agent" disabled={!question.trim() || !ready || !available} onClick={() => void submit()}><Send size={15} /></button>}</div></div>
      </div>
    </section>
  );
}
