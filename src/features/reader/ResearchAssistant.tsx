import { BookOpen, Check, ChevronDown, FileText, History, LoaderCircle, Plus, Pencil, Trash2, RotateCcw, Search, Send, Sparkles, Square, Wrench, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
import type { ResearchAgentEvent, ResearchAgentImportReceipt, ResearchAgentMessage, ResearchAgentPaperSummary, ResearchAgentSkill, ResearchAgentToolCall } from "../../services/researchAgentProtocol";
import { getDesktopBridge } from "../../platform/electron";
import { MarkdownContent } from "./MarkdownContent";
import { useConversationScroll } from "./useConversationScroll";
import "./ResearchAssistant.css";
import { Pianpian } from "../../brand/Pianpian";

interface ResearchDocument {
  title: string;
  markdown: string;
}

interface ResearchAssistantProps {
  scope?: "paper" | "library";
  paper: PaperRecord;
  library: PaperRecord[];
  onAddPaper: (paper: ResearchAgentPaperSummary, signal: AbortSignal) => Promise<ResearchAgentImportReceipt>;
  onJump: (blockId: string) => void;
  onJumpPaper?: (paperId: string, blockId: string) => void;
  onSaveDocument?: (document: ResearchDocument) => void;
  available: boolean;
  configurationRevision?: string;
  onOpenSettings: () => void;
  active?: boolean;
}

type TimelineItem =
  | { type: "message"; message: ResearchAgentMessage }
  | { type: "tool"; tool: ResearchAgentToolCall };

const toolLabels: Record<string, string> = {
  read_research_skill: "选择阅读方法",
  read_current_paper: "阅读论文原文",
  search_library: "在文献库里找线索",
  search_literature: "查找相关论文",
  search_web: "联网搜索",
  fetch_web_page: "读取网页",
  add_paper_to_library: "确认加入文献库",
  create_document: "整理阅读笔记",
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

function ToolCard({ tool, approvalPaper, onApprove, onReject, approving, onSaveDocument }: {
  tool: ResearchAgentToolCall;
  approvalPaper?: ResearchAgentPaperSummary;
  onApprove?: () => void;
  onReject?: () => void;
  approving?: boolean;
  onSaveDocument?: (document: ResearchDocument) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const output = isRecord(tool.output) ? tool.output : undefined;
  const papers = Array.isArray(output?.papers) ? output.papers : [];
  const webResults = Array.isArray(output?.results) ? output.results : [];
  const document = isRecord(output?.document) && typeof output.document.markdown === "string"
    ? output.document as ResearchDocument
    : undefined;
  const Icon = tool.name === "read_current_paper" ? BookOpen : tool.name.includes("search") ? Search
    : tool.name === "read_research_skill" ? Sparkles : tool.name === "create_document" ? FileText : Wrench;
  const summary = tool.name === "read_current_paper" ? output?.paper?.blocks
    ? `已读取 ${output.paper.blocks.length} 个原文块${tool.input.query ? ` · ${tool.input.query}` : ""}` : "读取论文原文"
    : tool.name === "read_research_skill" ? output?.title ?? "选择研究流程"
    : tool.name === "fetch_web_page" ? output?.title || tool.input.url || "读取网页"
    : tool.name === "search_web" ? `${tool.input.query ?? ""}${webResults.length ? ` · ${webResults.length} 条网页` : ""}`
    : tool.name === "add_paper_to_library" && output?.result?.kind === "pdf" ? output.result.duplicate ? "PDF 已在文献库中" : "PDF 已下载并保存"
    : tool.name === "add_paper_to_library" && output?.result?.kind === "metadata" ? "仅论文元数据已保存"
    : tool.name.includes("search") ? `${tool.input.query ?? ""}${papers.length ? ` · ${papers.length} 篇结果` : ""}${output?.source ? ` · ${output.source}` : ""}${output?.unavailableSources?.length ? ` · ${output.unavailableSources.join("、")}暂不可用` : ""}`
    : document?.title ?? tool.input.title ?? "";

  return (
    <article className={`research-tool-card is-${tool.status}`} aria-label={`工具：${toolLabels[tool.name] ?? tool.label}`}>
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
            <span>{approvalPaper.authors.join("、") || "作者待补充"} · {approvalPaper.year ?? "年份待补充"}{approvalPaper.arxivId ? " · 确认后下载并保存 PDF" : " · 仅保存论文元数据"}</span>
          </div>
          <div className="research-approval-actions">
            <button type="button" className="primary-button compact" disabled={approving} onClick={onApprove}>
              {approving ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
              {approving ? approvalPaper.arxivId ? "正在下载并保存…" : "正在加入…" : approvalPaper.arxivId ? "确认下载 PDF" : "确认加入元数据"}
            </button>
            <button type="button" className="secondary-button compact" disabled={approving} onClick={onReject}><X size={14} />拒绝</button>
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
      {expanded && tool.status === "completed" && webResults.length ? (
        <div className="research-result-list">
          {webResults.slice(0, 5).map((result: any, index: number) => (
            <div className="research-result-item" key={`${result.url ?? result.title}-${index}`}>
              <span className="research-result-index">{index + 1}</span>
              <div><strong>{result.title || result.url}</strong><span>{result.siteName || result.site_name || result.snippet || result.url}</span></div>
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

export function ResearchAssistant({ paper, library, scope = "paper", onAddPaper, onJump, onJumpPaper, onSaveDocument, available, onOpenSettings, configurationRevision, active = true }: ResearchAssistantProps) {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [approvalByToolId, setApprovalByToolId] = useState<Record<string, { approvalId: string; paper: ResearchAgentPaperSummary }>>({});
  const [confirmingApprovals, setConfirmingApprovals] = useState<Record<string, boolean>>({});
  const [streaming, setStreaming] = useState<Record<string, string>>({});
  const [skills, setSkills] = useState<ResearchAgentSkill[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [openMenu, setOpenMenu] = useState<"history" | "skills" | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const skillsButtonRef = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const menuId = useId();
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
  const approvalAbortControllers = useRef(new Map<string, AbortController>());
  function cancelPendingImports() {
    for (const controller of approvalAbortControllers.current.values()) controller.abort();
    approvalAbortControllers.current.clear();
  }
  const sessionEpoch = useRef(0);
  const activeApprovals = useRef(approvalByToolId);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!openMenu) return;
    const toolbar = toolbarRef.current;
    toolbar?.querySelector<HTMLElement>(openMenu === "history" ? 'input[aria-label="搜索历史对话"]' : ".research-skills-list button")?.focus();
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !toolbar?.contains(event.target)) setOpenMenu(null);
    }
    function dismissOnFocus(event: FocusEvent) {
      if (event.target instanceof Node && !toolbar?.contains(event.target)) setOpenMenu(null);
    }
    function dismissOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenMenu(null);
      (openMenu === "history" ? historyButtonRef : skillsButtonRef).current?.focus();
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOnFocus);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOnFocus);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [openMenu]);
  useEffect(() => {
    if (active) return;
    setOpenMenu(null);
    if (toolbarRef.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
  }, [active]);
  useEffect(() => { setOpenMenu(null); }, [scope, paper.id]);
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
    cancelPendingImports();
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
      if (!disposed) setError("篇篇的拿手活无法加载，请重新打开对话");
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
        cancelPendingImports();
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
        cancelPendingImports();
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
      if (!disposed) { setHistoryLoading(false); setError(reason instanceof Error ? reason.message : "篇篇暂时无法连接，请重试"); }
    });
    return () => {
      disposed = true;
      cancelPendingImports();
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
      setError(reason instanceof Error ? reason.message : "篇篇重新连接失败，请重试");
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
    const controller = new AbortController();
    approvalAbortControllers.current.set(toolId, controller);
    setConfirmingApprovals((current) => ({ ...current, [toolId]: true }));
    let result;
    try {
      if (approved) {
        const reserved = await approveResearchAgent({ approvalId: approval.approvalId, approved: true });
        if (!stillActive()) return;
        if (!reserved) throw new Error("这条确认已失效，请重新发起加入请求");
        result = await onAddPaper(approval.paper, controller.signal);
        if (!result || result.persisted !== true || typeof result.id !== "string" || !result.id
          || typeof result.duplicate !== "boolean" || !["pdf", "metadata"].includes(result.kind)) {
          throw new Error("文献库没有返回已保存回执，未确认加入成功");
        }
      }
      if (!stillActive() || controller.signal.aborted) return;
      const completed = await approveResearchAgent({ approvalId: approval.approvalId, approved, result });
      if (!completed) throw new Error("文献库写入确认已失效");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "文献库写入失败，请重试";
      if (stillActive()) setError(message);
      await approveResearchAgent({ approvalId: approval.approvalId, approved: false, message }).catch(() => undefined);
      return;
    } finally {
      confirmingTools.current.delete(toolId);
      if (approvalAbortControllers.current.get(toolId) === controller) approvalAbortControllers.current.delete(toolId);
      setConfirmingApprovals((current) => {
        const next = { ...current };
        delete next[toolId];
        return next;
      });
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
    cancelPendingImports();
    activeApprovals.current = {};
    setApprovalByToolId({});
    try { await abortResearchAgent(conversationId.current); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "停止失败，请重试"); }
  }

  function selectConversation(id?: string) {
    setOpenMenu(null);
    historyButtonRef.current?.focus();
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
    <section className="research-assistant-panel" aria-label="篇篇对话">
      <div className="research-conversation-toolbar" ref={toolbarRef}>
        <button ref={historyButtonRef} className="research-conversation-select" type="button" aria-label="历史对话" title={`历史对话 · ${activeTitle}`} aria-haspopup="dialog" aria-controls={`${menuId}-history`} aria-expanded={openMenu === "history"} onClick={() => setOpenMenu(openMenu === "history" ? null : "history")}>
          <History size={15} /><span>{activeTitle}</span><ChevronDown size={13} />
        </button>
        <div className="research-toolbar-actions">
          {skills.length ? <button ref={skillsButtonRef} type="button" aria-label="篇篇的拿手活" title="篇篇的拿手活" aria-haspopup="dialog" aria-controls={`${menuId}-skills`} aria-expanded={openMenu === "skills"} onClick={() => setOpenMenu(openMenu === "skills" ? null : "skills")}><Sparkles size={15} /><span>拿手活</span></button> : null}
          <button type="button" disabled={historyLoading} onClick={() => selectConversation()} title="新建对话"><Plus size={16} /><span>新建</span></button>
        </div>
      {openMenu === "history" ? <section id={`${menuId}-history`} className="research-toolbar-popover research-history" role="dialog" aria-label={scope === "library" ? "全库对话历史" : "当前论文对话历史"}>
        <div className="research-popover-heading"><strong>历史对话</strong><span>{scope === "library" ? "整个文献库" : "当前论文"}</span></div>
        <input aria-label="搜索历史对话" placeholder="搜索标题或消息内容" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} />
        <div className="research-history-list">{conversations.map((item) => <div className={`research-history-item ${item.id === conversationId.current ? "is-active" : ""}`} key={item.id}>
          {renaming === item.id ? <form onSubmit={(event) => { event.preventDefault(); void renameConversation(item.id); }}><input autoFocus aria-label="对话标题" maxLength={100} value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} /><button type="submit">保存</button><button type="button" onClick={() => setRenaming(null)}>取消</button></form> : <>
            <button type="button" className="research-history-select" disabled={historyLoading} aria-current={item.id === conversationId.current ? "true" : undefined} onClick={() => selectConversation(item.id)}><strong>{item.title}</strong><span>{new Date(item.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {item.messageCount ?? 0} 条消息</span><small>{item.preview}</small></button>
            <button type="button" aria-label={`重命名对话：${item.title}`} onClick={() => { setRenaming(item.id); setRenameTitle(item.title); }}><Pencil size={13} /></button><button type="button" aria-label={`删除对话：${item.title}`} onClick={() => setDeleting(item.id)}><Trash2 size={13} /></button>
          </>}
          {deleting === item.id ? <div className="research-history-confirm"><span>永久删除此对话？</span><button type="button" onClick={() => void removeConversation(item.id)}>确认删除</button><button type="button" onClick={() => setDeleting(null)}>取消</button></div> : null}
        </div>)}{!conversations.length ? <p>{historyQuery ? "没有匹配的历史对话" : "暂无历史对话"}</p> : null}</div>
        <small>保存在本机 · 选择对话，接着上次聊</small>
      </section> : null}
      {openMenu === "skills" ? <section id={`${menuId}-skills`} className="research-toolbar-popover research-skills" role="dialog" aria-label="篇篇的拿手活">
        <div className="research-popover-heading"><strong>篇篇的拿手活</strong><span>选一个，一起开始</span></div>
        <div className="research-skills-list">{skills.map((skill) =>
          <button key={skill.name} type="button" onClick={() => { setQuestion(skill.prompt); setOpenMenu(null); questionRef.current?.focus(); }}><Sparkles size={15} /><span>{skill.title}</span><Plus size={14} /></button>)}</div>
      </section> : null}
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="research-agent-scroll">
        <div ref={contentRef} className="research-agent-content">
        {!hasConversation ? <div className="research-agent-empty"><div className="research-agent-empty-icon"><Pianpian variant="reading" /></div><strong>{scope === "library" ? "你的文献，我们一起理一理。" : "这篇论文，我们从哪儿读起？"}</strong><p>{scope === "library" ? "告诉篇篇你关心的问题，一起找论文、比较方法、整理阅读笔记。" : "难懂的段落交给我。也可以一起找文献，把读到的收获记下来。"}</p><div className="research-agent-prompts"><button type="button" onClick={() => setQuestion(scope === "library" ? "检索文献库中与我的研究主题相关的论文，请先问我主题" : "概括这篇论文的研究问题、方法和主要结论")}>{scope === "library" ? "找找文献" : "讲讲重点"}</button><button type="button" onClick={() => setQuestion(scope === "library" ? "帮我比较已有论文的方法，请先问我要比较的主题" : "查找与这篇论文相关的文献")}>{scope === "library" ? "比较方法" : "找相关文献"}</button><button type="button" onClick={() => setQuestion("生成一份阅读笔记文档")}>整理笔记</button></div></div> : null}
        {timeline.map((item) => {
          if (item.type === "tool") {
            const approval = approvalByToolId[item.tool.id];
            return <ToolCard key={`tool-${item.tool.id}`} tool={item.tool} approvalPaper={approval?.paper}
              approving={confirmingApprovals[item.tool.id]}
              onApprove={() => void approve(item.tool.id, true)} onReject={() => void approve(item.tool.id, false)}
              onSaveDocument={(draft) => void saveDocument(draft)} />;
          }
          const content = streaming[item.message.id] ?? item.message.content;
          const references = item.message.role === "assistant" ? verifiedReferences(item.message.citations) : [];
          return <article className={`research-message is-${item.message.role}`} key={`message-${item.message.id}`}>
            <div className="research-message-label">{item.message.role === "user" ? "你" : <><Pianpian />篇篇</>}</div>
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
        {!available ? <button type="button" className="research-config-hint" onClick={onOpenSettings}>请先配置模型服务，再和篇篇一起读论文。</button> : null}
        <div className="research-input-wrap"><textarea ref={questionRef} aria-label="向篇篇提问" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={onKeyDown} placeholder={scope === "library" ? "和篇篇一起找论文、比方法、理证据…" : "这篇论文哪里难懂？也可以请篇篇找文献…"} rows={3} /><div className="research-input-actions">
          <div className="research-composer-meta"><span className={`research-agent-state ${busy ? "is-busy" : ""}`}><span className="status-dot" /><span>{historyLoading ? "恢复中" : busy ? "工作中" : ready ? "就绪" : available ? "连接中" : "待配置"}</span></span><span>{scope === "library" ? "整个文献库" : "当前论文"}</span></div>
          <div className="research-send-actions"><span title="Ctrl / ⌘ + Enter 发送">Ctrl ↵</span>{busy ? <button type="button" className="research-stop-button" aria-label="停止回答" onClick={() => void stop()}><Square size={14} />停止</button> : <button type="button" className="research-send-button" aria-label="发送给篇篇" disabled={!question.trim() || !ready || !available} onClick={() => void submit()}><Send size={15} /></button>}</div>
        </div></div>
      </div>
    </section>
  );
}
