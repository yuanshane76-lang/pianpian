import { BookOpen, Check, ChevronDown, FileText, History, LoaderCircle, Plus, Pencil, Trash2, RotateCcw, Search, Send, Sparkles, Square, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { PaperRecord } from "../../domain/library";
import { currentPaperCitations } from "../../domain/paperCitations";
import {
  abortResearchAgent,
  approveResearchAgent,
  createResearchAgentContext,
  getResearchAgentSkills,
  promptResearchAgent,
  startResearchAgent,
  subscribeToResearchAgent,
  updateResearchAgentContext,
  listResearchConversations, createResearchConversation, getResearchConversation, renameResearchConversation, deleteResearchConversation,
  type ConversationSummary, type ConversationScope,
} from "../../services/researchAgent";
import type { ResearchAgentEvent, ResearchAgentMessage, ResearchAgentPaperSummary, ResearchAgentSkill, ResearchAgentToolCall } from "../../services/researchAgentProtocol";
import { getDesktopBridge } from "../../platform/electron";
import { MarkdownContent } from "./MarkdownContent";
import { useConversationScroll } from "./useConversationScroll";
import "./ResearchAssistant.css";

interface ResearchDocument {
  title: string;
  markdown: string;
}

interface ResearchAssistantProps {
  scope?: "paper" | "library";
  paper: PaperRecord;
  library: PaperRecord[];
  onAddPaper: (paper: ResearchAgentPaperSummary) => { id: string; duplicate: boolean } | void;
  onJump: (blockId: string) => void;
  onJumpPaper?: (paperId: string, blockId: string) => void;
  onSaveDocument?: (document: ResearchDocument) => void;
  available: boolean;
  configurationRevision?: string;
  onOpenSettings: () => void;
}

type TimelineItem =
  | { type: "message"; message: ResearchAgentMessage }
  | { type: "tool"; tool: ResearchAgentToolCall };

const toolLabels: Record<string, string> = {
  read_research_skill: "读取预置研究技能",
  read_current_paper: "读取论文正文",
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
  const Icon = tool.name === "read_current_paper" ? BookOpen : tool.name.includes("search") ? Search
    : tool.name === "read_research_skill" ? Sparkles : tool.name === "create_document" ? FileText : Wrench;
  const summary = tool.name === "read_current_paper" ? output?.paper?.blocks
    ? `已读取 ${output.paper.blocks.length} 个原文块${tool.input.query ? ` · ${tool.input.query}` : ""}` : "读取论文原文"
    : tool.name === "read_research_skill" ? output?.title ?? "选择研究流程"
    : tool.name.includes("search") ? `${tool.input.query ?? ""}${papers.length ? ` · ${papers.length} 篇结果` : ""}`
    : document?.title ?? tool.input.title ?? "";

  return (
    <article className={`research-tool-card is-${tool.status}`} aria-label={`工具：${tool.label}`}>
      <button className="research-tool-heading" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
        <span className="research-tool-icon">{tool.status === "running" ? <LoaderCircle className="spin" size={14} />
          : tool.status === "completed" ? <Check size={14} /> : tool.status === "failed" ? <X size={14} /> : <Icon size={14} />}</span>
        <span className="research-tool-copy"><span className="research-tool-name">{toolLabels[tool.name] ?? tool.label}</span>
          {summary ? <span className="research-tool-summary">{String(summary)}</span> : null}</span>
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
      {expanded && tool.status === "completed" && papers.length ? (
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
      {expanded ? <div className="research-tool-details">
        <span><Icon size={13} />{toolLabels[tool.name] ?? tool.label} · {toolStatus(tool.status)}</span>
        <details><summary>查看调用详情</summary><pre className="research-tool-output">{JSON.stringify(tool.output ?? tool.input, null, 2)}</pre></details>
      </div> : null}
    </article>
  );
}

function updateTimeline(items: TimelineItem[], next: TimelineItem): TimelineItem[] {
  const id = next.type === "message" ? next.message.id : next.tool.id;
  const index = items.findIndex((item) => (item.type === "message" ? item.message.id : item.tool.id) === id);
  if (index < 0) return [...items, next];
  return items.map((item, itemIndex) => itemIndex === index ? next : item);
}

export function ResearchAssistant({ paper, library, scope = "paper", onAddPaper, onJump, onJumpPaper, onSaveDocument, available, onOpenSettings, configurationRevision }: ResearchAssistantProps) {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [approvalByToolId, setApprovalByToolId] = useState<Record<string, { approvalId: string; paper: ResearchAgentPaperSummary }>>({});
  const [streaming, setStreaming] = useState<Record<string, string>>({});
  const [skills, setSkills] = useState<ResearchAgentSkill[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeTitle, setActiveTitle] = useState("新对话");
  const [selection, setSelection] = useState<{ id?: string; fresh?: boolean; sequence: number }>({ sequence: 0 });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const conversationId = useRef<string | undefined>();
  const conversationScope = useMemo<ConversationScope>(() => scope === "library" ? { scope } : { scope, paperId: paper.id, paperTitle: paper.title }, [scope, paper.id, paper.title]);
  const { scrollRef, contentRef, onScroll, followLatest } = useConversationScroll([timeline, streaming, error]);
  const lastQuestion = useRef("");
  const paperContext = useMemo(() => createResearchAgentContext(paper, library, scope), [
    scope,
    paper.id, paper.title, paper.authors, paper.year, paper.blockData,
    library.map((item) => `${item.id}:${item.title}:${item.doi ?? ""}:${item.year ?? ""}:${item.originalId ?? ""}`).join("|"),
  ]);
  const startedRef = useRef(false);
  const latestContext = useRef(paperContext);
  latestContext.current = paperContext;
  const confirmingTools = useRef(new Set<string>());
  const sessionEpoch = useRef(0);
  const activeApprovals = useRef(approvalByToolId);
  const [ready, setReady] = useState(false);
  async function refreshHistory(query = historyQuery) {
    const items = await listResearchConversations(conversationScope, query);
    setConversations(items);
    const active = items.find((item) => item.id === conversationId.current);
    if (active) setActiveTitle(active.title);
  }
  useEffect(() => {
    let disposed = false;
    const timer = setTimeout(() => { void listResearchConversations(conversationScope, historyQuery).then((items) => {
      if (!disposed) setConversations(items);
    }).catch((reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : "历史搜索失败"); }); }, 180);
    return () => { disposed = true; clearTimeout(timer); };
  }, [conversationScope, historyQuery]);

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
    setHistoryLoading(true);
    followLatest();
    void getResearchAgentSkills().then((catalogue) => {
      if (!disposed) setSkills(catalogue);
    }).catch(() => {
      if (!disposed) setError("预置研究技能无法加载，请重新打开研究助手");
    });
    const unsubscribe = subscribeToResearchAgent((event: ResearchAgentEvent) => {
      if (disposed) return;
      if (event.conversationId && event.conversationId !== conversationId.current) return;
      if (event.type === "session_started" && event.skills) setSkills(event.skills);
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
        if (!event.recoverable) {
          startedRef.current = false;
          setReady(false);
        }
      }
      if (event.type === "agent_end") {
        activeApprovals.current = {};
        setBusy(false);
        setApprovalByToolId({});
        setTimeline((current) => current.map((item) => item.type === "tool" && ["queued", "running", "awaiting_approval"].includes(item.tool.status)
          ? { ...item, tool: { ...item.tool, status: "rejected", error: "执行已结束" } } : item));
        void refreshHistory().catch((reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : "历史刷新失败"); });
      }
    });
    let ownedId: string | undefined;
    void (async () => {
      const items = await listResearchConversations(conversationScope);
      if (disposed) return;
      const requested = selection.id && items.some((item) => item.id === selection.id) ? selection.id : undefined;
      const current = items.find((item) => item.id === conversationId.current)?.id;
      const id = selection.fresh ? undefined : requested ?? current ?? items[0]?.id;
      if (conversationId.current) await abortResearchAgent(conversationId.current);
      const record = id ? await getResearchConversation(id) : await createResearchConversation(conversationScope);
      if (disposed) return;
      ownedId = record.id;
      conversationId.current = record.id;
      setSelection((current) => current.sequence === selection.sequence ? { id: record.id, sequence: current.sequence } : current);
      setTimeline(record.timeline);
      setActiveTitle(record.title);
      setHistoryLoading(false);
      await refreshHistory();
      if (!available || disposed) return;
      await startResearchAgent({ ...latestContext.current, conversationId: record.id });
      if (!disposed) {
        startedRef.current = true;
        setReady(true);
        void updateResearchAgentContext({ ...latestContext.current, conversationId: record.id }).catch((reason) => {
          if (!disposed) setError(reason instanceof Error ? reason.message : "论文上下文更新失败");
        });
      }
    })().catch((reason) => {
      if (!disposed) { setHistoryLoading(false); setError(reason instanceof Error ? reason.message : "研究助手启动失败"); }
    });
    return () => {
      disposed = true;
      sessionEpoch.current += 1;
      activeApprovals.current = {};
      startedRef.current = false;
      unsubscribe();
      if (ownedId) void abortResearchAgent(ownedId).catch(() => undefined);
    };
  }, [scope, paper.id, configurationRevision, available, selection.sequence]);

  useEffect(() => {
    if (!startedRef.current) return;
    void updateResearchAgentContext({ ...paperContext, conversationId: conversationId.current }).catch((reason) => {
      if (reason instanceof Error && !/会话不存在/.test(reason.message)) setError(reason.message);
    });
  }, [paperContext]);

  async function reconnect() {
    try {
      if (!conversationId.current) throw new Error("请先新建或选择对话");
      await startResearchAgent({ ...latestContext.current, conversationId: conversationId.current });
      startedRef.current = true;
      setReady(true);
      await updateResearchAgentContext(latestContext.current);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "研究助手重新连接失败，请重试");
      return false;
    }
  }

  async function submit(retryQuestion?: string) {
    const value = (retryQuestion ?? question).trim();
    if (!value || busy || !available) return;
    if (historyLoading) return;
    if (!ready && !(await reconnect())) return;
    setQuestion("");
    setError(null);
    setBusy(true);
    followLatest();
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
    try { await abortResearchAgent(conversationId.current); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "停止失败，请重试"); }
  }

  function selectConversation(id?: string) {
    setSelection((current) => ({ id, fresh: !id, sequence: current.sequence + 1 }));
    setRenaming(null); setDeleting(null);
  }
  async function renameConversation(id: string) {
    try { await renameResearchConversation(id, renameTitle); setRenaming(null); await refreshHistory(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "重命名失败"); }
  }
  async function removeConversation(id: string) {
    try {
      await deleteResearchConversation(id); setDeleting(null);
      if (conversationId.current === id) { conversationId.current = undefined; selectConversation(); }
      await refreshHistory();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "删除失败"); }
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
  function verifiedReferences(candidates: unknown) {
    if (scope === "paper") return currentPaperCitations(paper, candidates);
    if (!Array.isArray(candidates)) return [];
    return candidates.flatMap((candidate) => {
      const target = library.find((item) => item.id === candidate?.paperId);
      return target ? currentPaperCitations(target, [candidate]).map((source) => ({ blockId: candidate.referenceId || `${target.id}::${source.blockId}` })) : [];
    });
  }
  function jumpToReference(referenceId: string) {
    if (scope === "paper") { onJump(referenceId); return; }
    for (const target of library) {
      const block = target.blockData?.find((item) => `${target.id}::${item.id}` === referenceId);
      if (block) { onJumpPaper?.(target.id, block.id); return; }
    }
  }
  const readSources = useMemo(() => verifiedReferences(timeline.flatMap((item) => {
    if (item.type !== "tool" || item.tool.name !== "read_current_paper" || item.tool.status !== "completed") return [];
    const output = isRecord(item.tool.output) ? item.tool.output : undefined;
    if (!output?.paper?.id || !Array.isArray(output.paper.blocks)) return [];
    return output.paper.blocks.map((block: { id: string; referenceId?: string }) => ({ paperId: output.paper.id, blockId: block.id, referenceId: block.referenceId }));
  })), [timeline, scope, paper.id, paper.blockData, library]);
  return (
    <section className="research-assistant-panel" aria-label="研究 Agent">
      <div className="research-agent-banner">
        <div className="research-agent-title"><span className="research-agent-mark"><Sparkles size={15} /></span><div><strong>{scope === "library" ? "全库研究助手" : "单篇论文助手"}</strong><span>{scope === "library" ? "检索已有文献与已解析正文" : "仅针对当前论文 · 独立历史"}</span></div></div>
        <span className={`research-agent-state ${busy ? "is-busy" : ""}`}><span className="status-dot" />{busy ? "工作中" : ready ? "就绪" : available ? "连接中" : "待配置"}</span>
      </div>
      <div className="research-history-toolbar"><button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}><History size={14} />历史对话<ChevronDown size={13} /></button><span title={activeTitle}>{activeTitle}</span><button type="button" disabled={historyLoading} onClick={() => selectConversation()}><Plus size={14} />新建</button></div>
      {historyOpen ? <section className="research-history" aria-label={scope === "library" ? "全库对话历史" : "当前论文对话历史"}>
        <input aria-label="搜索历史对话" placeholder="搜索标题或消息内容" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} />
        <div className="research-history-list">{conversations.map((item) => <div className={`research-history-item ${item.id === conversationId.current ? "is-active" : ""}`} key={item.id}>
          {renaming === item.id ? <form onSubmit={(event) => { event.preventDefault(); void renameConversation(item.id); }}><input autoFocus aria-label="对话标题" maxLength={100} value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} /><button type="submit">保存</button><button type="button" onClick={() => setRenaming(null)}>取消</button></form> : <>
            <button type="button" className="research-history-select" disabled={historyLoading} aria-current={item.id === conversationId.current ? "true" : undefined} onClick={() => selectConversation(item.id)}><strong>{item.title}</strong><span>{new Date(item.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {item.messageCount ?? 0} 条消息</span><small>{item.preview}</small></button>
            <button type="button" aria-label={`重命名对话：${item.title}`} onClick={() => { setRenaming(item.id); setRenameTitle(item.title); }}><Pencil size={13} /></button><button type="button" aria-label={`删除对话：${item.title}`} onClick={() => setDeleting(item.id)}><Trash2 size={13} /></button>
          </>}
          {deleting === item.id ? <div className="research-history-confirm"><span>永久删除此对话？</span><button type="button" onClick={() => void removeConversation(item.id)}>确认删除</button><button type="button" onClick={() => setDeleting(null)}>取消</button></div> : null}
        </div>)}{!conversations.length ? <p>{historyQuery ? "没有匹配的历史对话" : "暂无历史对话"}</p> : null}</div>
        <small>历史仅保存在本机；恢复会继续上下文，不会重复执行旧操作。</small>
      </section> : null}
      {skills.length ? <details className="research-skills"><summary>预置研究技能 · {skills.length} 项</summary><div className="research-skills-list">{skills.map((skill) =>
        <button key={skill.name} type="button" onClick={() => setQuestion(skill.prompt)}>{skill.title}</button>)}</div></details> : null}
      <div ref={scrollRef} onScroll={onScroll} className="research-agent-scroll">
        <div ref={contentRef} className="research-agent-content">
        {!hasConversation ? <div className="research-agent-empty"><div className="research-agent-empty-icon"><FileText size={22} /></div><strong>{scope === "library" ? "从整个文献库开始研究" : "从这篇论文开始研究"}</strong><p>{scope === "library" ? "按主题检索已有论文，读取已解析正文并对比证据。未解析论文只能检索元数据。" : "你可以让我读懂论文、检索相关文献，或者生成一份阅读笔记。"}</p><div className="research-agent-prompts"><button type="button" onClick={() => setQuestion(scope === "library" ? "检索文献库中与我的研究主题相关的论文，请先问我主题" : "概括这篇论文的研究问题、方法和主要结论")}>{scope === "library" ? "检索已有论文" : "概括论文"}</button><button type="button" onClick={() => setQuestion(scope === "library" ? "帮我比较已有论文的方法，请先问我要比较的主题" : "查找与这篇论文相关的文献")}>{scope === "library" ? "对比研究方法" : "查找文献"}</button><button type="button" onClick={() => setQuestion("生成一份阅读笔记文档")}>生成笔记</button></div></div> : null}
        {timeline.map((item) => {
          if (item.type === "tool") {
            const approval = approvalByToolId[item.tool.id];
            return <ToolCard key={`tool-${item.tool.id}`} tool={item.tool} approvalPaper={approval?.paper}
              onApprove={() => void approve(item.tool.id, true)} onReject={() => void approve(item.tool.id, false)}
              onSaveDocument={(draft) => void saveDocument(draft)} />;
          }
          const content = streaming[item.message.id] ?? item.message.content;
          const references = item.message.role === "assistant" ? verifiedReferences(item.message.citations) : [];
          return <article className={`research-message is-${item.message.role}`} key={`message-${item.message.id}`}>
            <div className="research-message-label">{item.message.role === "user" ? "你" : "研究 Agent"}</div>
            <div className="research-message-content">{content ? <MarkdownContent text={content}
              citations={item.message.role === "assistant" ? streaming[item.message.id] !== undefined ? readSources : references : []}
              onCitation={jumpToReference} /> : <span className="research-placeholder">正在组织回答…</span>}</div>
          </article>;
        })}
        {error ? <div className="research-agent-error" role="alert"><span>{error}</span>{lastQuestion.current ? <button type="button" disabled={busy} onClick={() => void submit(lastQuestion.current)}><RotateCcw size={14} />重试问题</button> : null}</div> : null}
        </div>
      </div>
      <div className="research-agent-composer">
        {savedNotice ? <div className="research-save-notice" role="status">{savedNotice}</div> : null}
        {!available ? <button type="button" className="research-config-hint" onClick={onOpenSettings}>请先配置模型服务，配置后即可启用研究 Agent。</button> : null}
        <div className="research-input-wrap"><textarea aria-label="向研究 Agent 提问" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={onKeyDown} placeholder={scope === "library" ? "检索已有论文，比较方法或整理证据…" : "问问这篇论文，或让 Agent 查找相关文献…"} rows={3} /><div className="research-input-actions"><span>{historyLoading ? "正在恢复对话…" : "Ctrl / ⌘ + Enter 发送"}</span>{busy ? <button type="button" className="research-stop-button" aria-label="停止 Agent" onClick={() => void stop()}><Square size={14} />停止</button> : <button type="button" className="research-send-button" aria-label="发送给研究 Agent" disabled={!question.trim() || !ready || !available} onClick={() => void submit()}><Send size={15} /></button>}</div></div>
      </div>
    </section>
  );
}
