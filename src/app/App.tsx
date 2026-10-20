import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Settings2, X } from "lucide-react";
import { Pianpian } from "../brand/Pianpian";
import {
  getDocumentBlockSignature,
  getDocumentContentSignature,
  getDocumentSourceSignature,
  getDocumentVisualSignature,
  type DocumentBlock,
} from "../domain/documentBlocks";
import {
  buildAnalysisCacheKey,
  buildParagraphCacheIdentity,
  getCachedAnalysis,
  setCachedAnalysis,
  type AnalysisCacheEntry,
  type ParagraphOperation,
} from "../domain/analysis";
import {
  createLibraryGroup,
  deleteLibraryGroup,
  DEFAULT_GROUP_ID,
  filterPapers,
  removePaper,
  sortPapers,
  type LibraryGroup,
  updatePaperMetadata,
  type PaperMetadataPatch,
  type PaperRecord,
} from "../domain/library";
import type { AiRequest } from "../services/ai";
import { loadAnalysisCache, saveAnalysisCache } from "../services/analysisCache";
import { loadGroups, loadPapers, preparePdfFile, saveGroups, saveLibraryGroupsAndPapers, savePapers } from "../services/library";
import { deleteOriginalPdf } from "../services/originalPdf";
import { getAnalysisAvailability, getTranslationTarget, isVisualBlock } from "../domain/readingFlow";
import { canOpenPaper, hasCompletePageBounds, type PaperPipelineState } from "../domain/pipeline";
import { parseChartReading, parseParagraphInsight, parseReadingGuide } from "../domain/learning";
import { loadChartImage } from "../services/chartImage";
import { extractAcademicVocabulary, type AcademicTerm } from "../domain/vocabulary";
import { academicTermKey, addWordbookTerm, resolveWordbookSourceBlock, type WordbookSource, type WordbookEntry } from "../domain/wordbook";
import { loadWordbook, saveWordbook } from "../services/wordbook";
import { WordbookDialog } from "../features/reader/WordbookDialog";
import { LibraryView } from "../features/library/LibraryView";
import { ReaderView } from "../features/reader/ReaderView";
import { ServiceSettingsDialog } from "../features/settings/ServiceSettingsDialog";
import { DEFAULT_SERVICE_SETTINGS, getMissingServiceCredentials, toPublicServiceSettings, type PublicServiceSettings } from "../domain/serviceSettings";
import { getDesktopBridge } from "../platform/electron";
import { ResearchAssistant } from "../features/reader/ResearchAssistant";
import { addLiteraturePaper, upgradeLiteraturePaperWithPdf, type LiteraturePaper } from "../domain/literature";
import type { ResearchAgentImportReceipt, ResearchAgentPaperSummary } from "../services/researchAgentProtocol";
import { UpdateCenter } from "../features/settings/UpdateCenter";

type AppView = "library" | "reader" | "research";
const WORKSPACE_CONTEXT: PaperRecord = {
  id: "research-workspace", title: "研究工作区", authors: [], year: null, sourcePath: "",
  importedAt: "", groupId: DEFAULT_GROUP_ID, favorite: false, blocks: 0, blockData: [],
};
const PARAGRAPH_OPERATIONS: ParagraphOperation[] = ["translate", "explain", "insight", "vocabulary"];
const PARAGRAPH_LABELS: Record<ParagraphOperation, string> = {
  translate: "翻译", explain: "解释", insight: "摘要与作用", vocabulary: "精选词汇",
};
interface AnalysisRequestOptions {
  concurrent?: boolean;
}
interface ParagraphAnalysis {
  requestId: number;
  paperId: string;
  signature: string;
  pending: ParagraphOperation[];
  outputs: Record<ParagraphOperation, string>;
}

export default function App() {
  const [wordbook, setWordbook] = useState(loadWordbook);
  const wordbookRef = useRef(wordbook);
  wordbookRef.current = wordbook;
  const [wordbookOpen, setWordbookOpen] = useState(false);
  const [wordbookWriteError, setWordbookWriteError] = useState<string | null>(null);
  const [sourceNavigation, setSourceNavigation] = useState<{ paperId: string; blockId: string; requestId: number }>();
  const sourceNavigationSequence = useRef(0);
  const [papers, setPapers] = useState<PaperRecord[]>(() => loadPapers());
  const [groups, setGroups] = useState<LibraryGroup[]>(() => loadGroups());
  const [view, setView] = useState<AppView>("library");
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(papers[0]?.id ?? null);
  const [selectedBlock, setSelectedBlock] = useState<DocumentBlock | null>(null);
  const selectedBlockRef = useRef<DocumentBlock | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const [processing, setProcessing] = useState<Record<string, string>>({});
  const activeParsing = useRef(new Set<string>());
  const activeUploads = useRef(new Set<string>());
  const queuedImports = useRef(new Set<string>());
  const taskGenerations = useRef(new Map<string, number>());
  const alive = useRef(true);
  const pollWaiters = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; resolve: () => void }>());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [analysisCache, setAnalysisCache] = useState<Map<string, AnalysisCacheEntry>>(() =>
    loadAnalysisCache(),
  );
  const selectedPaperIdRef = useRef(selectedPaperId);
  const analysisRequestIdRef = useRef(0);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [answer, setAnswer] = useState<string | null>(null);
  const [streamingOutput, setStreamingOutput] = useState<{ operation: AiRequest["operation"]; paperId: string; text: string } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<AiRequest["operation"] | null>(null);
  const [paragraphAnalysis, setParagraphAnalysis] = useState<ParagraphAnalysis | null>(null);
  const activeParagraphAnalysisRef = useRef<string | null>(null);
  const activeChartAnalysisRef = useRef<string | null>(null);
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serviceSettings, setServiceSettings] = useState<PublicServiceSettings>(() =>
    toPublicServiceSettings(DEFAULT_SERVICE_SETTINGS),
  );
  const initialBridge = getDesktopBridge();
  const isDesktop = initialBridge?.isDesktop === true;
  const [settingsReady, setSettingsReady] = useState(!initialBridge);
  const [settingsLoaded, setSettingsLoaded] = useState(!getDesktopBridge());
  const [settingsReadFailed, setSettingsReadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const activeAnalysisAbortRef = useRef(new Set<AbortController>());
  const [pipelineStates, setPipelineStates] = useState<Record<string, PaperPipelineState>>({});
  const serviceSettingsRef = useRef(serviceSettings);
  serviceSettingsRef.current = serviceSettings;

  function cancelActiveAnalysis() {
    for (const controller of activeAnalysisAbortRef.current) controller.abort();
    activeAnalysisAbortRef.current.clear();
  }

  function invalidateAnalysisRequests() {
    cancelActiveAnalysis();
    analysisRequestIdRef.current += 1;
    setStreamingOutput(null);
    setPendingAction(null);
    setParagraphAnalysis(null);
    activeParagraphAnalysisRef.current = null;
    activeChartAnalysisRef.current = null;
    if (!importingRef.current) setIsBusy(false);
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelActiveAnalysis();
      for (const waiter of pollWaiters.current.values()) {
        clearTimeout(waiter.timer);
        waiter.resolve();
      }
      pollWaiters.current.clear();
    };
  }, []);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    let cancelled = false;
    const snapshotGenerations = new Map(papers.map((paper) => [paper.id, taskGenerations.current.get(paper.id) ?? 0]));
    bridge.invoke<PublicServiceSettings>("zhiyan:settings:get")
      .catch((failure) => {
        if (alive.current && !cancelled) setSettingsReadFailed(true);
        throw failure;
      })
      .then((settings) => {
        if (!alive.current || cancelled) return [];
        serviceSettingsRef.current = settings;
        setServiceSettings(settings);
        setSettingsLoaded(true);
        setSettingsReadFailed(false);
        type Snapshot = {
          paperId: string;
          task: { batchId?: string; state?: string; progress?: number; error?: string } | null;
          result: { blocks: DocumentBlock[]; title?: string; pageCount?: number } | null;
          layoutRecoveryNeeded?: boolean;
        };
        const documents = papers
          .filter((paper) => paper.originalId)
          .map((paper) => ({ paperId: paper.id, documentId: paper.originalId }));
        const batches = Array.from({ length: Math.ceil(documents.length / 200) }, (_, index) => documents.slice(index * 200, (index + 1) * 200));
        return Promise.all(batches.map((batch) => bridge.invoke<Snapshot[]>("zhiyan:documents:states", batch))).then((states) => states.flat());
      })
      .then((states) => {
        if (!alive.current || cancelled || !Array.isArray(states)) return;
        setPapers((current) => current.map((paper) => {
          const state = states.find((item) => item.paperId === paper.id);
          if (!state || (taskGenerations.current.get(paper.id) ?? 0) !== snapshotGenerations.get(paper.id)
            || activeUploads.current.has(paper.id) || activeParsing.current.has(paper.id)) return paper;
          if (state.task?.state === "done" && state.result?.blocks?.length && !state.layoutRecoveryNeeded) {
            const positioned = hasCompletePageBounds(state.result.blocks);
            return {
              ...paper,
              blockData: state.result.blocks,
              blocks: state.result.blocks.length,
              title: state.result.title || paper.title,
              pageCount: paper.pageCount || state.result.pageCount,
              parseStatus: positioned ? "ready" : "pending",
              parseError: positioned ? undefined : "MinerU 坐标不完整，请重新解析",
              mineruBatchId: undefined,
            };
          }
          if (state.task?.batchId && (state.layoutRecoveryNeeded || ["waiting-file", "pending", "running", "converting", "downloading"].includes(state.task.state || ""))) {
            return { ...paper, parseStatus: "pending", mineruBatchId: state.task.batchId, parseError: undefined };
          }
          if (state.task?.state === "failed") {
            return { ...paper, parseStatus: "pending", mineruBatchId: state.task.batchId, parseError: state.task.error || "MinerU 解析失败，可重试" };
          }
          return paper;
        }));
        for (const item of states) {
          const paper = papersRef.current.find((candidate) => candidate.id === item.paperId);
          if (!paper || (taskGenerations.current.get(paper.id) ?? 0) !== snapshotGenerations.get(paper.id)
            || activeUploads.current.has(paper.id) || activeParsing.current.has(paper.id)) continue;
          const requiresRecovery = item.layoutRecoveryNeeded || item.task?.batchId
            && ["waiting-file", "pending", "running", "converting", "downloading"].includes(item.task.state || "");
          if (requiresRecovery && !serviceSettingsRef.current.mineru.configured) {
            queuedImports.current.add(paper.id);
            updatePipeline(paper.id, { stage: "partial", source: "mineru", error: undefined,
              mineruMessage: "等待配置 MinerU 后继续已有解析任务" });
            continue;
          }
          if (item.layoutRecoveryNeeded) {
            updatePipeline(paper.id, { stage: "mineru-downloading", source: "mineru", mineruMessage: "正在恢复已有 MinerU 任务的段落坐标…" });
            void pollMineru(paper);
          } else if (item.task?.state === "done" && item.result?.blocks?.length) {
            const positioned = hasCompletePageBounds(item.result.blocks);
            updatePipeline(paper.id, { stage: positioned ? "ready" : "failed", source: "mineru", error: positioned ? undefined : "MinerU 坐标不完整，请重新解析" });
          } else if (item.task?.batchId && ["waiting-file", "pending", "running", "converting", "downloading"].includes(item.task.state || "")) {
            updatePipeline(paper.id, {
              stage: item.task.state === "downloading" ? "mineru-downloading" : "mineru-processing",
              source: "mineru",
              mineruState: item.task.state,
              mineruProgress: item.task.progress,
              mineruMessage: "正在恢复 MinerU 解析任务…",
            });
            void pollMineru(paper);
          } else if (item.task?.state === "failed") {
            updatePipeline(paper.id, { stage: "failed", source: "mineru", error: item.task.error || "MinerU 解析失败，可重试" });
          } else if (!item.task && paper.parseStatus === "pending") {
            queuedImports.current.add(paper.id);
          }
        }
      })
      .catch(() => { if (alive.current && !cancelled) setActionError("无法读取服务配置或解析任务，请打开设置检查后重试。"); })
      .finally(() => { if (alive.current && !cancelled) setSettingsReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setStorageError(!savePapers(papers));
  }, [papers]);

  useEffect(() => {
    saveAnalysisCache(analysisCache);
  }, [analysisCache]);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge?.isDesktop || !bridge.on) return;
    return bridge.on<{ requestId: string }>("zhiyan:update:prepare", ({ requestId }) => {
      let saved = false;
      try {
        if (isBusy || importing || activeParsing.current.size || activeUploads.current.size || wordbookRef.current.error) throw new Error("仍有任务或未恢复的存储错误");
        const snapshot: Record<string, string> = {
          "zhiyan-workbench.papers.v1": JSON.stringify(papersRef.current),
          "zhiyan-workbench.groups.v1": JSON.stringify(groups),
          "zhiyan-workbench.wordbook.v1": JSON.stringify(wordbookRef.current.entries),
          "zhiyan-workbench.analysis.v1": JSON.stringify([...analysisCache.values()]),
        };
        snapshot["zhiyan-workbench.appearance.v1"] =
          window.localStorage.getItem("zhiyan-workbench.appearance.v1") ?? JSON.stringify({ theme: "light" });
        for (const [key, value] of Object.entries(snapshot)) {
          window.localStorage.setItem(key, value);
          if (window.localStorage.getItem(key) !== value) throw new Error("记录保存未完成");
        }
        saved = true;
      } catch { setStorageError(true); }
      void bridge.invoke("zhiyan:update:saved", { requestId, saved }).catch(() => {
        setActionError("更新前保存确认失败，请稍后重试。当前程序没有执行安装。");
      });
    });
  }, [groups, analysisCache, isBusy, importing]);

  useEffect(() => {
    selectedPaperIdRef.current = selectedPaperId;
  }, [selectedPaperId]);

  useEffect(() => {
    selectedBlockRef.current = selectedBlock;
  }, [selectedBlock]);

  const selectedPaper = papers.find((paper) => paper.id === selectedPaperId) ?? null;
  const papersRef = useRef(papers);
  papersRef.current = papers;
  const translationTarget = getTranslationTarget(selectedBlock, selectionText);
  const targetSignature = translationTarget ? getDocumentBlockSignature(translationTarget) : "";
  const visualSignature = selectedBlock && isVisualBlock(selectedBlock) ? getDocumentVisualSignature(selectedBlock) : "";
  const availability = getAnalysisAvailability(serviceSettings);
  const documentSignature = useMemo(() => getDocumentSourceSignature(selectedPaper?.blockData ?? []), [selectedPaper?.blockData]);
  const visiblePapers = useMemo(() => {
    const groupNames = new Map(groups.map((group) => [group.id, group.name]));
    let filtered = filterPapers(papers, query, groupNames);
    if (filter === "favorite") filtered = filtered.filter((paper) => paper.favorite);
    if (filter === "recent") filtered = sortPapers(filtered).slice(0, 5);
    if (filter.startsWith("group:")) {
      const groupId = filter.slice(6);
      filtered = filtered.filter((paper) => paper.groupId === groupId);
    }
    return sortPapers(filtered);
  }, [filter, groups, papers, query]);
  const serviceIdentity = `${serviceSettings.revision}:${serviceSettings.aiProvider}:${serviceSettings[serviceSettings.aiProvider].model}`;
  const serviceIdentityRef = useRef(serviceIdentity);
  serviceIdentityRef.current = serviceIdentity;
  const errorContextRef = useRef("");
  errorContextRef.current = `${selectedPaperId}:${targetSignature || visualSignature}:${serviceIdentity}`;
  const vocabularyBlock = selectedBlock?.kind === "paragraph" ? selectedBlock : null;
  const vocabularySignature = vocabularyBlock ? getDocumentContentSignature(vocabularyBlock) : "";
  const guideKey = vocabularyBlock ? buildParagraphCacheIdentity(selectedPaperId ?? "", vocabularyBlock, "vocabulary", serviceIdentity, documentSignature).key : "";
  const insightKey = translationTarget ? buildParagraphCacheIdentity(selectedPaperId ?? "", translationTarget, "insight", serviceIdentity, documentSignature).key : "";
  const chartKey = buildAnalysisCacheKey(selectedPaperId ?? "", selectedBlock?.id ?? "", "chart", `${serviceIdentity}:${selectedPaper?.originalId}:${documentSignature}:${visualSignature}`);
  const chartReading = useMemo(() => {
    const entry = analysisCache.get(chartKey);
    try { return entry ? parseChartReading(entry.value) : null; } catch { return null; }
  }, [analysisCache, chartKey]);
  const readingGuide = useMemo(() => {
    const entry = analysisCache.get(guideKey);
    try { return entry ? parseReadingGuide(entry.value) : null; } catch { return null; }
  }, [analysisCache, guideKey]);
  const paragraphInsight = useMemo(() => {
    const entry = analysisCache.get(insightKey);
    try { return entry ? parseParagraphInsight(entry.value) : null; } catch { return null; }
  }, [analysisCache, insightKey]);
  const vocabulary = useMemo(() => readingGuide
    ? extractAcademicVocabulary(vocabularyBlock ? [vocabularyBlock] : [], readingGuide.terms).filter((term) => term.source === "ai")
    : [], [vocabularyBlock, readingGuide]);

  function updateWordbook(entries: WordbookEntry[]) {
    if (wordbookRef.current.error) return;
    if (!saveWordbook(entries)) {
      setWordbookWriteError("单词表保存失败，修改未生效。请检查本地存储空间后重试。");
      setWordbookOpen(true);
      return;
    }
    const next = { entries, error: null };
    wordbookRef.current = next;
    setWordbook(next);
    setWordbookWriteError(null);
  }

  function handleSaveTerm(term: AcademicTerm) {
    if (!selectedPaper || !vocabularyBlock) return;
    if (wordbookRef.current.error) { setWordbookOpen(true); return; }
    updateWordbook(addWordbookTerm(wordbookRef.current.entries, term, {
      paperId: selectedPaper.id, paperTitle: selectedPaper.title, blockId: vocabularyBlock.id,
      pageNumber: vocabularyBlock.pageNumber, contentSignature: vocabularySignature, example: term.example,
    }));
  }

  function findWordbookSource(source: WordbookSource) {
    const paper = papers.find((item) => item.id === source.paperId);
    const block = paper?.blockData ? resolveWordbookSourceBlock(paper.blockData, source) : null;
    return paper && block ? { paper, block } : null;
  }

  function handleWordbookJump(source: WordbookSource) {
    const target = findWordbookSource(source);
    if (!target) return;
    if (!canOpenPaper(target.paper, pipelineStates[target.paper.id])) {
      setSelectedPaperId(target.paper.id);
      setView("library");
      setWordbookOpen(false);
      setActionError("请等待这篇论文完成 MinerU 解析与坐标定位后再跳转。");
      return;
    }
    invalidateAnalysisRequests();
    setAnswer(null);
    selectedPaperIdRef.current = target.paper.id;
    selectedBlockRef.current = target.block;
    setSelectedPaperId(target.paper.id);
    setSelectedBlock(target.block);
    setSelectionText("");
    setActionError(null);
    setPapers((current) => current.map((paper) => paper.id === target.paper.id
      ? { ...paper, readingPosition: { mode: "pdf", page: target.block.pageNumber, blockId: target.block.id } } : paper));
    setSourceNavigation({ paperId: target.paper.id, blockId: target.block.id, requestId: ++sourceNavigationSequence.current });
    setView("reader");
    setWordbookOpen(false);
  }

  async function requestAnalysis(
    request: AiRequest,
    onDelta: (delta: string) => void,
    options: AnalysisRequestOptions = {},
  ): Promise<string> {
    if (!settingsReady) throw new Error("服务配置尚未就绪");
    if (!serviceSettings[serviceSettings.aiProvider].configured) {
      throw new Error("当前模型服务未配置密钥，请先打开服务配置。");
    }
    const bridge = getDesktopBridge();
    if (!bridge) throw new Error("真实模型调用仅在桌面程序中可用");
    if (!bridge.stream) throw new Error("桌面版流式 AI 接口不可用，请重启或更新应用。");
    const activeControllers = activeAnalysisAbortRef.current;
    if (!options.concurrent) {
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
    }
    const controller = new AbortController();
    activeControllers.add(controller);
    const sourceBlocks = request.paper.blockData ?? [];
    const selectedIndex = sourceBlocks.findIndex((block) => block.id === request.block?.id);
    const isSelection = ["translate", "explain", "insight", "chart", "vocabulary"].includes(request.operation);
    const contextBlocks = request.operation === "vocabulary"
      ? request.block ? [request.block] : []
      : isSelection
      ? sourceBlocks.slice(Math.max(0, selectedIndex - 1), selectedIndex + 2)
      : sourceBlocks;
    const contextLimit = request.operation === "guide" ? 80000 : 180000;
    let remaining = contextLimit;
    const blockData = contextBlocks.map((block) => {
      const text = block.text.slice(0, isSelection ? 2500 : remaining);
      remaining -= text.length;
      return { ...block, text };
    }).filter((block) => block.text || block.id === request.block?.id);
    const compactRequest: AiRequest = {
      ...request,
      paper: { ...request.paper, blockData },
    };
    try {
      return await bridge.stream<string>("zhiyan:ai:run", compactRequest, (delta) => {
        if (!controller.signal.aborted) onDelta(delta);
      }, (cancel) => {
        const handleAbort = () => cancel();
        if (controller.signal.aborted) {
          cancel();
          return () => undefined;
        }
        controller.signal.addEventListener("abort", handleAbort, { once: true });
        return () => controller.signal.removeEventListener("abort", handleAbort);
      });
    } finally {
      activeControllers.delete(controller);
    }
  }

  function updatePipeline(paperId: string, patch: Partial<PaperPipelineState>) {
    setPipelineStates((current) => {
      const previous = current[paperId] ?? {
        paperId,
        source: "mineru",
        stage: "partial",
      };
      return {
        ...current,
        [paperId]: { ...previous, ...patch },
      };
    });
  }

  async function withAnalysisError(action: () => Promise<void>) {
    const context = errorContextRef.current;
    const requestId = analysisRequestIdRef.current;
    setParagraphAnalysis(null);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      const failure = error as { name?: unknown; message?: unknown } | null;
      if (analysisRequestIdRef.current === requestId && errorContextRef.current === context && failure?.name !== "AbortError") {
        setActionError(typeof failure?.message === "string" ? failure.message : "请求失败，请检查服务配置和网络");
      }
    }
  }

  async function handleImport(file: File): Promise<void> {
    if (importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    setIsBusy(true);
    setErrorMessage(null);
    try {
      const { paper } = await preparePdfFile(file);
      const existing = papersRef.current.find((item) => item.id === paper.id
        || paper.originalId && item.originalId === paper.originalId);
      const imported = existing ?? paper;
      invalidateAnalysisRequests();
      if (!existing) papersRef.current = [paper, ...papersRef.current];
      setPapers((current) => existing ? current : [paper, ...current]);
      setSelectedPaperId(imported.id);
      setSelectedBlock(null);
      setSelectionText("");
      setAnswer(null);
      setView("library");
      if (!existing || !canOpenPaper(existing, pipelineStates[existing.id])) {
        queuedImports.current.add(imported.id);
        if (serviceSettingsRef.current.mineru.configured) {
          queuedImports.current.delete(imported.id);
          void handleEnhance(imported);
        } else {
          updatePipeline(imported.id, { stage: "partial", source: "mineru", error: undefined,
            mineruMessage: "原始 PDF 已保存，配置 MinerU 后自动解析" });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setErrorMessage(`导入失败：${message}`);
    } finally {
      setIsBusy(false);
      importingRef.current = false;
      setImporting(false);
    }
  }

  function taskIsCurrent(paper: PaperRecord) {
    return alive.current && papersRef.current.some((item) => item.id === paper.id && item.originalId === paper.originalId);
  }

  function waitForNextPoll(paperId: string): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pollWaiters.current.delete(paperId); resolve(); }, 3000);
      pollWaiters.current.set(paperId, { timer, resolve });
    });
  }

  async function pollMineru(paper: PaperRecord) {
    const bridge = getDesktopBridge();
    if (!bridge || !paper.originalId || activeParsing.current.has(paper.id)) return;
    activeParsing.current.add(paper.id);
    try {
      for (;;) {
        const task = await bridge.invoke<{ state: string; progress?: number; batchId?: string; error?: string; result?: { blocks: DocumentBlock[]; title?: string; pageCount?: number } }>("zhiyan:mineru:status", paper.originalId);
        if (!taskIsCurrent(paper)) return;
        if (task.state === "done" && task.result) {
          const result = task.result;
          const positioned = hasCompletePageBounds(result.blocks);
          setPapers((current) => current.map((item) => item.id === paper.id ? {
            ...item, blockData: result.blocks, blocks: result.blocks.length, parseVersion: 2,
            parseStatus: positioned ? "ready" : "pending",
            parseError: positioned ? undefined : "MinerU 坐标不完整，请重新解析",
            title: result.title || item.title,
            pageCount: item.pageCount || result.pageCount, mineruBatchId: undefined,
          } : item));
          updatePipeline(paper.id, { stage: positioned ? "ready" : "failed", source: "mineru", error: positioned ? undefined : "MinerU 坐标不完整，请重新解析" });
          if (selectedPaperIdRef.current === paper.id) { setSelectedBlock(null); setSelectionText(""); }
          return;
        }
        if (task.state === "failed" || task.state === "error") throw new Error(task.error || "MinerU 解析失败");
        if (task.state === "waiting-file") throw new Error("MinerU 等待重新上传文件，可重试解析");
        if (task.state === "idle") throw new Error("解析任务不存在，请重新解析");
        if (task.state === "done") throw new Error("MinerU 结果尚未保存，请重试解析");
        const message = (task as { message?: string }).message || "MinerU 正在整理正文、图表和公式…";
        updatePipeline(paper.id, {
          stage: task.state === "downloading" ? "mineru-downloading" : "mineru-processing",
          source: "mineru",
          mineruState: task.state,
          mineruProgress: typeof task.progress === "number" ? task.progress : undefined,
          mineruMessage: message,
        });
        setProcessing((current) => ({ ...current, [paper.id]: message }));
        await waitForNextPoll(paper.id);
        if (!taskIsCurrent(paper)) return;
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "MinerU 解析失败";
      if (!taskIsCurrent(paper)) return;
      if (!serviceSettingsRef.current.mineru.configured) {
        queuedImports.current.add(paper.id);
        updatePipeline(paper.id, { stage: "partial", source: "mineru", error: undefined, mineruMessage: "等待配置 MinerU 后继续解析" });
        return;
      }
      setPapers((current) => current.map((item) => item.id === paper.id ? {
        ...item,
        parseStatus: "pending",
        parseError: message,
      } : item));
      updatePipeline(paper.id, { stage: "failed", source: "mineru", error: message });
    } finally {
      activeParsing.current.delete(paper.id);
      if (alive.current) setProcessing((current) => ({ ...current, [paper.id]: "" }));
    }
  }

  async function handleEnhance(requestedPaper?: PaperRecord) {
    const targetPaper = requestedPaper ?? selectedPaper;
    if (!targetPaper?.originalId) { setActionError("请先重新导入原始 PDF"); return; }
    const bridge = getDesktopBridge();
    if (!bridge) { setActionError("MinerU 增强解析需要桌面版"); return; }
    const paper = targetPaper;
    if (!serviceSettingsRef.current.mineru.configured) {
      queuedImports.current.add(paper.id);
      updatePipeline(paper.id, { source: "mineru", stage: "partial", error: undefined,
        mineruMessage: "等待配置 MinerU 后继续解析" });
      return;
    }
    queuedImports.current.delete(paper.id);
    if (activeUploads.current.has(paper.id) || activeParsing.current.has(paper.id)) return;
    activeUploads.current.add(paper.id);
    taskGenerations.current.set(paper.id, (taskGenerations.current.get(paper.id) ?? 0) + 1);
    try {
      if (paper.mineruBatchId) {
        try {
          const snapshot = await bridge.invoke<{
            task: { state?: string; batchId?: string } | null;
            result: { blocks: DocumentBlock[] } | null;
            layoutRecoveryNeeded?: boolean;
          }>("zhiyan:documents:state", paper.originalId);
          if (snapshot.layoutRecoveryNeeded || (snapshot.task?.batchId &&
            (["pending", "running", "converting", "downloading"].includes(snapshot.task.state || "") ||
              snapshot.task.state === "done" && hasCompletePageBounds(snapshot.result?.blocks)))) {
            if (!taskIsCurrent(paper)) return;
            setActionError(null);
            updatePipeline(paper.id, {
              stage: snapshot.task?.state === "downloading" ? "mineru-downloading" : "mineru-processing",
              source: "mineru", error: undefined, mineruState: snapshot.task?.state,
              mineruMessage: "正在继续已有 MinerU 任务…",
            });
            void pollMineru(paper);
            return;
          }
        } catch {
          throw new Error("无法读取已有解析任务，请稍后重试");
        }
      }
      setActionError(null);
      updatePipeline(paper.id, { stage: "mineru-uploading", source: "mineru", error: undefined, mineruProgress: undefined, mineruState: undefined });
      setProcessing((current) => ({ ...current, [paper.id]: "正在上传 PDF 到 MinerU…" }));
      const task = await bridge.invoke<{ batchId: string }>("zhiyan:mineru:start", paper.originalId);
      if (!taskIsCurrent(paper)) return;
      setPapers((current) => current.map((item) => item.id === paper.id ? { ...item, parseStatus: "pending", parseError: undefined, mineruBatchId: task.batchId } : item));
      updatePipeline(paper.id, { stage: "mineru-processing", source: "mineru", mineruState: "pending", mineruMessage: "PDF 已上传，等待 MinerU 开始解析…" });
      void pollMineru(paper);
    } catch (cause) {
      if (!taskIsCurrent(paper)) return;
      if (!serviceSettingsRef.current.mineru.configured) {
        queuedImports.current.add(paper.id);
        updatePipeline(paper.id, { stage: "partial", source: "mineru", error: undefined, mineruMessage: "等待配置 MinerU 后继续解析" });
        return;
      }
      const message = cause instanceof Error ? cause.message : "MinerU 上传失败";
      setPapers((current) => current.map((item) => item.id === paper.id ? { ...item, parseStatus: "pending", parseError: message } : item));
      updatePipeline(paper.id, { stage: "failed", source: "mineru", error: message });
      setProcessing((current) => ({ ...current, [paper.id]: "" }));
    } finally {
      activeUploads.current.delete(paper.id);
    }
  }

  useEffect(() => {
    if (!settingsReady || !serviceSettings.mineru.configured) return;
    for (const paperId of queuedImports.current) {
      const paper = papersRef.current.find((item) => item.id === paperId);
      if (paper) void handleEnhance(paper);
    }
  }, [papers, settingsReady, serviceSettings.mineru.configured]);

  function handleSelectPaper(paperId: string) {
    invalidateAnalysisRequests();
    setSelectedPaperId(paperId);
    setSelectedBlock(null);
    setSelectionText("");
    setAnswer(null);
  }

  function handleStartMineru(paperId: string) {
    const paper = papersRef.current.find((item) => item.id === paperId);
    if (!paper) return;
    setSelectedPaperId(paperId);
    if (!serviceSettings.mineru.configured) {
      setSettingsOpen(true);
      return;
    }
    void handleEnhance(paper);
  }

  function handleOpenReader() {
    if (!selectedPaper || !canOpenPaper(selectedPaper, pipelineStates[selectedPaper.id])) {
      setActionError("请等待 MinerU 完成正文解析和坐标定位后再阅读。");
      return;
    }
    setView("reader");
  }

  function handleToggleFavorite(paperId: string) {
    setPapers((current) =>
      current.map((paper) =>
        paper.id === paperId ? { ...paper, favorite: !paper.favorite } : paper,
      ),
    );
  }

  async function handleAddLiterature(item: ResearchAgentPaperSummary, signal: AbortSignal): Promise<ResearchAgentImportReceipt> {
    const ensureActive = () => {
      if (signal.aborted) throw new DOMException("加入文献已取消", "AbortError");
    };
    ensureActive();
    const literature: LiteraturePaper = {
      title: item.title, authors: item.authors, year: item.year, doi: item.doi,
      landingUrl: item.landingUrl, abstract: item.abstract, source: item.source,
      arxivId: item.arxivId,
    };
    if (!item.arxivId) {
      const next = addLiteraturePaper(papersRef.current, literature);
      if (!next.duplicate) {
        if (!savePapers(next.papers)) throw new Error("文献库保存失败，请检查本机存储空间");
        papersRef.current = next.papers;
        setPapers(next.papers);
      }
      return { persisted: true, id: next.id, duplicate: next.duplicate, kind: "metadata" };
    }

    const bridge = getDesktopBridge();
    if (!bridge) throw new Error("下载 arXiv PDF 需要在篇篇桌面版中操作");
    const downloaded = await bridge.invoke<{ id: string; name: string; duplicate: boolean; importId: string }>(
      "zhiyan:literature:download-arxiv", item.arxivId,
    );
    let committed = false;
    try {
      ensureActive();
      const existingDocument = papersRef.current.find((paper) => paper.originalId === downloaded.id);
      let prepared: PaperRecord;
      if (existingDocument) {
        prepared = existingDocument;
      } else {
        const bytes = await bridge.invoke<Uint8Array>("zhiyan:documents:read", downloaded.id);
        ensureActive();
        const pdfData = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(pdfData).set(bytes);
        const file = new File([pdfData], downloaded.name, { type: "application/pdf" });
        prepared = (await preparePdfFile(file, { id: downloaded.id, duplicate: downloaded.duplicate })).paper;
      }
      ensureActive();
      const imported = {
        ...prepared,
        title: item.title,
        authors: item.authors,
        year: item.year,
        arxivId: item.arxivId,
        doi: item.doi,
        landingUrl: item.landingUrl,
        abstract: item.abstract,
      };
      const next = upgradeLiteraturePaperWithPdf(papersRef.current, literature, imported);
      ensureActive();
      if (!savePapers(next.papers)) throw new Error("文献库保存失败，请检查本机存储空间");
      papersRef.current = next.papers;
      setPapers(next.papers);
      committed = true;
      const persistedPaper = next.papers.find((paper) => paper.id === next.id)!;
      if (!canOpenPaper(persistedPaper, pipelineStates[persistedPaper.id])) void handleEnhance(persistedPaper);
      return { persisted: true, id: next.id, originalId: persistedPaper.originalId, duplicate: next.duplicate, kind: "pdf" };
    } finally {
      await bridge.invoke("zhiyan:literature:finish-import", {
        importId: downloaded.importId,
        retained: committed || papersRef.current.some((paper) => paper.originalId === downloaded.id),
      }).catch(() => undefined);
    }
  }

  function handleUpdateMetadata(paperId: string, patch: PaperMetadataPatch) {
    setPapers((current) => updatePaperMetadata(current, paperId, patch));
    setActionError(null);
  }

  function handleCreateGroup(name: string): LibraryGroup {
    const result = createLibraryGroup(groups, name);
    if (result.groups.length !== groups.length && !saveGroups(result.groups)) {
      throw new Error("分组保存失败，请检查本机存储空间。");
    }
    setGroups(result.groups);
    return result.group;
  }

  async function handleDeleteGroup(groupId: string): Promise<void> {
    const result = deleteLibraryGroup(groups, papersRef.current, groupId);
    if (!saveLibraryGroupsAndPapers(result.groups, result.papers)) {
      throw new Error("分组删除失败，请检查本机存储空间后重试。");
    }
    papersRef.current = result.papers;
    setPapers(result.papers);
    setGroups(result.groups);
    setFilter((current) => current === `group:${groupId}` ? `group:${DEFAULT_GROUP_ID}` : current);
  }

  async function handleDeletePaper(paperId: string): Promise<void> {
    const paper = papersRef.current.find((item) => item.id === paperId);
    if (!paper) return;
    invalidateAnalysisRequests();
    if (paper.originalId) await deleteOriginalPdf(paper.originalId);
    setPapers((current) => removePaper(current, paperId));
    setAnalysisCache((current) => {
      const next = new Map(current);
      for (const [key, entry] of next) if (entry.paperId === paperId) next.delete(key);
      return next;
    });
    setTranslations({});
    setExplanations({});
    setAnswer(null);
    if (selectedPaperIdRef.current === paperId) {
      setSelectedPaperId(null);
      setSelectedBlock(null);
      setSelectionText("");
      setView("library");
    }
  }

  async function handleTranslate() {
    if (!selectedPaper || !translationTarget) return;
    const target = translationTarget;
    const requestIdentity = serviceIdentity;
    const sourceSignature = getDocumentBlockSignature(target);
    const requestId = analysisRequestIdRef.current;
    const cacheIdentity = buildParagraphCacheIdentity(selectedPaper.id, target, "translate", serviceIdentity, documentSignature);
    const key = cacheIdentity.key;
    const cached = getCachedAnalysis(analysisCache, key);
    if (cached) {
      setStreamingOutput(null);
      setTranslations((current) => ({
        ...current,
        [`${selectedPaper.id}:${sourceSignature}`]: cached.value,
      }));
      return;
    }
    setIsBusy(true);
    setPendingAction("translate");
    setStreamingOutput({ operation: "translate", paperId: selectedPaper.id, text: "" });
    try {
      const value = await requestAnalysis({
        operation: "translate",
        paper: selectedPaper,
        block: target,
      }, (delta) => {
        setStreamingOutput((current) => current?.operation === "translate" && current.paperId === selectedPaper.id
          ? { ...current, text: current.text + delta } : current);
      });
      const currentPaper = papersRef.current.find((paper) => paper.id === selectedPaper.id);
      if (serviceIdentityRef.current !== requestIdentity || analysisRequestIdRef.current !== requestId ||
          getDocumentSourceSignature(currentPaper?.blockData ?? []) !== getDocumentSourceSignature(selectedPaper.blockData ?? [])) return;
      setStreamingOutput(null);
      const entry: AnalysisCacheEntry = {
        ...cacheIdentity,
        value,
        createdAt: new Date().toISOString(),
      };
      setAnalysisCache((current) => {
        const next = new Map(current);
        setCachedAnalysis(next, entry);
        return next;
      });
      setTranslations((current) => ({
        ...current,
        [`${selectedPaper.id}:${sourceSignature}`]: value,
      }));
    } finally {
      if (analysisRequestIdRef.current === requestId) {
        setIsBusy(false);
        setPendingAction(null);
        setStreamingOutput(null);
      }
    }
  }

  async function handleAsk(question: string) {
    if (!selectedPaper) return;
    const requestIdentity = serviceIdentity;
    const sourceSignature = `${getDocumentSourceSignature(selectedPaper.blockData ?? [])}:${question.trim()}`;
    const documentSignature = getDocumentSourceSignature(selectedPaper.blockData ?? []);
    const key = buildAnalysisCacheKey(selectedPaper.id, "paper", "qa", `${serviceIdentity}:${sourceSignature}`);
    const cached = getCachedAnalysis(analysisCache, key);
    if (cached) {
      setAnswer(cached.value);
      return;
    }
    setIsBusy(true);
    setPendingAction("qa");
    const requestId = analysisRequestIdRef.current;
    const requestPaperId = selectedPaper.id;
    setStreamingOutput({ operation: "qa", paperId: requestPaperId, text: "" });
    try {
      const value = await requestAnalysis({ operation: "qa", paper: selectedPaper, question }, (delta) => {
        setStreamingOutput((current) => current?.operation === "qa" && current.paperId === requestPaperId
          ? { ...current, text: current.text + delta } : current);
      });
      const currentPaper = papersRef.current.find((paper) => paper.id === selectedPaper.id);
      if (serviceIdentityRef.current !== requestIdentity || analysisRequestIdRef.current !== requestId ||
          getDocumentSourceSignature(currentPaper?.blockData ?? []) !== documentSignature) return;
      setStreamingOutput(null);
      const entry: AnalysisCacheEntry = {
        key,
        paperId: selectedPaper.id,
        scopeId: "paper",
        operation: "qa",
        sourceSignature: `${serviceIdentity}:${sourceSignature}`,
        value,
        createdAt: new Date().toISOString(),
      };
      setAnalysisCache((current) => {
        const next = new Map(current);
        setCachedAnalysis(next, entry);
        return next;
      });
      if (
        analysisRequestIdRef.current === requestId &&
        selectedPaperIdRef.current === requestPaperId
      ) {
        setAnswer(value);
      }
    } finally {
      if (analysisRequestIdRef.current === requestId) {
        setIsBusy(false);
        setPendingAction(null);
        setStreamingOutput(null);
      }
    }
  }

  async function handleExplain(force = false) {
    if (!selectedPaper || !translationTarget) return;
    const requestIdentity = serviceIdentity;
    const signature = getDocumentBlockSignature(translationTarget);
    const requestId = analysisRequestIdRef.current;
    const documentSignature = getDocumentSourceSignature(selectedPaper.blockData ?? []);
    const paperId = selectedPaper.id;
    const cacheIdentity = buildParagraphCacheIdentity(paperId, translationTarget, "explain", requestIdentity, documentSignature);
    const cached = getCachedAnalysis(analysisCache, cacheIdentity.key);
    if (cached && !force) {
      setExplanations((current) => ({ ...current, [`${paperId}:${signature}`]: cached.value }));
      return;
    }
    setIsBusy(true);
    setPendingAction("explain");
    setStreamingOutput({ operation: "explain", paperId, text: "" });
    try {
      const value = await requestAnalysis({ operation: "explain", paper: selectedPaper, block: translationTarget }, (delta) => {
        setStreamingOutput((current) => current?.operation === "explain" && current.paperId === paperId
          ? { ...current, text: current.text + delta } : current);
      });
      const currentPaper = papersRef.current.find((paper) => paper.id === paperId);
      if (serviceIdentityRef.current === requestIdentity && analysisRequestIdRef.current === requestId &&
          getDocumentSourceSignature(currentPaper?.blockData ?? []) === documentSignature) {
        setStreamingOutput(null);
        setExplanations((current) => ({ ...current, [`${paperId}:${signature}`]: value }));
        setAnalysisCache((current) => {
          const next = new Map(current);
          setCachedAnalysis(next, { ...cacheIdentity, value, createdAt: new Date().toISOString() });
          return next;
        });
      }
    } finally {
      if (analysisRequestIdRef.current === requestId) {
        setIsBusy(false);
        setPendingAction(null);
        setStreamingOutput(null);
      }
    }
  }

  async function handleAnalyzeParagraph(block: DocumentBlock) {
    if (!selectedPaper || block.kind !== "paragraph" || importingRef.current) return;
    const paper = selectedPaper;
    const signature = getDocumentBlockSignature(block);
    const identity = serviceIdentity;
    const activeKey = `${paper.id}:${identity}:${signature}`;
    if (activeParagraphAnalysisRef.current === activeKey) return;
    invalidateAnalysisRequests();
    selectedBlockRef.current = block;
    setSelectedBlock(block);
    setSelectionText("");
    setActionError(null);
    if (!availability.available) { setSettingsOpen(true); return; }
    const requestId = analysisRequestIdRef.current;
    const documentSignature = getDocumentSourceSignature(paper.blockData ?? []);
    const outputs: Record<ParagraphOperation, string> = { translate: "", explain: "", insight: "", vocabulary: "" };
    const pending: ParagraphOperation[] = [];
    for (const operation of PARAGRAPH_OPERATIONS) {
      const cacheIdentity = buildParagraphCacheIdentity(paper.id, block, operation, identity, documentSignature);
      const cached = getCachedAnalysis(analysisCache, cacheIdentity.key)?.value ??
        (operation === "translate" ? translations[`${paper.id}:${signature}`]
          : operation === "explain" ? explanations[`${paper.id}:${signature}`] : undefined);
      try {
        if (!cached) throw new Error();
        if (operation === "insight") parseParagraphInsight(cached);
        if (operation === "vocabulary") parseReadingGuide(cached);
        outputs[operation] = cached;
      } catch {
        pending.push(operation);
      }
    }
    activeParagraphAnalysisRef.current = activeKey;
    setParagraphAnalysis({ requestId, paperId: paper.id, signature, pending, outputs });
    setIsBusy(pending.length > 0);

    function stillCurrent() {
      const currentPaper = papersRef.current.find((item) => item.id === paper.id);
      return analysisRequestIdRef.current === requestId && serviceIdentityRef.current === identity &&
        selectedPaperIdRef.current === paper.id &&
        getDocumentSourceSignature(currentPaper?.blockData ?? []) === documentSignature;
    }

    // Each operation settles independently so a failure cannot cancel sibling results.
    await Promise.all(pending.map(async (operation) => {
      try {
        const value = await requestAnalysis({ operation, paper, block }, (delta) => {
          if (!stillCurrent()) return;
          setParagraphAnalysis((current) => current?.requestId === requestId
            ? { ...current, outputs: { ...current.outputs, [operation]: current.outputs[operation] + delta } } : current);
        }, { concurrent: true });
        if (!stillCurrent()) return;
        if (operation === "insight") parseParagraphInsight(value);
        if (operation === "vocabulary") parseReadingGuide(value);
        const cacheIdentity = buildParagraphCacheIdentity(paper.id, block, operation, identity, documentSignature);
        setAnalysisCache((current) => {
          const next = new Map(current);
          setCachedAnalysis(next, { ...cacheIdentity, value, createdAt: new Date().toISOString() });
          return next;
        });
        if (operation === "translate") {
          setTranslations((current) => ({ ...current, [`${paper.id}:${signature}`]: value }));
        } else if (operation === "explain") {
          setExplanations((current) => ({ ...current, [`${paper.id}:${signature}`]: value }));
        }
        setParagraphAnalysis((current) => current?.requestId === requestId
          ? { ...current, outputs: { ...current.outputs, [operation]: value } } : current);
      } catch (error) {
        const failure = error as { name?: unknown; message?: unknown } | null;
        if (!stillCurrent() || failure?.name === "AbortError") return;
        const message = typeof failure?.message === "string" ? failure.message : "请求失败，请检查服务配置和网络";
        setActionError((current) => [current, `${PARAGRAPH_LABELS[operation]}：${message}`].filter(Boolean).join("\n"));
        setParagraphAnalysis((current) => current?.requestId === requestId
          ? { ...current, outputs: { ...current.outputs, [operation]: "" } } : current);
      } finally {
        if (analysisRequestIdRef.current === requestId) {
          setParagraphAnalysis((current) => current?.requestId === requestId
            ? { ...current, pending: current.pending.filter((item) => item !== operation) } : current);
        }
      }
    }));
    if (analysisRequestIdRef.current === requestId) {
      setIsBusy(false);
      activeParagraphAnalysisRef.current = null;
    }
  }

  async function handleLearning(operation: "vocabulary" | "insight") {
    const block = operation === "vocabulary" ? vocabularyBlock : translationTarget;
    if (!selectedPaper || !block) return;
    const cacheIdentity = buildParagraphCacheIdentity(selectedPaper.id, block, operation, serviceIdentity, documentSignature);
    const key = cacheIdentity.key;
    const cached = analysisCache.get(key);
    if (cached) {
      try {
        if (operation === "vocabulary") parseReadingGuide(cached.value); else parseParagraphInsight(cached.value);
        return;
      } catch { /* Invalid structured entries must be regenerated. */ }
    }
    const identity = serviceIdentity;
    const requestPaper = selectedPaper;
    const requestId = analysisRequestIdRef.current;
    const requestDocumentSignature = documentSignature;
    setIsBusy(true); setPendingAction(operation);
    setStreamingOutput({ operation, paperId: requestPaper.id, text: "" });
    try {
      const value = await requestAnalysis({ operation, paper: requestPaper, block }, (delta) => {
        setStreamingOutput((current) => current?.operation === operation && current.paperId === requestPaper.id
          ? { ...current, text: current.text + delta } : current);
      });
      if (operation === "vocabulary") parseReadingGuide(value); else parseParagraphInsight(value);
      const currentPaper = papersRef.current.find((paper) => paper.id === requestPaper.id);
      if (serviceIdentityRef.current !== identity || analysisRequestIdRef.current !== requestId ||
          getDocumentSourceSignature(currentPaper?.blockData ?? []) !== requestDocumentSignature) return;
      setStreamingOutput(null);
      setAnalysisCache((current) => {
        const next = new Map(current);
        setCachedAnalysis(next, { ...cacheIdentity, value, createdAt: new Date().toISOString() });
        return next;
      });
    } finally {
      if (analysisRequestIdRef.current === requestId) {
        setIsBusy(false);
        setPendingAction(null);
        setStreamingOutput(null);
      }
    }
  }

  async function handleReadChart(target = selectedBlock) {
    if (!selectedPaper || !target || !isVisualBlock(target)) return;
    const block = target;
    const paper = selectedPaper;
    const identity = serviceIdentity;
    const sourceSignature = getDocumentSourceSignature(paper.blockData ?? []);
    const visual = getDocumentVisualSignature(block);
    const key = buildAnalysisCacheKey(paper.id, block.id, "chart", `${identity}:${paper.originalId}:${sourceSignature}:${visual}`);
    if (activeChartAnalysisRef.current === key) return;
    invalidateAnalysisRequests();
    selectedBlockRef.current = block;
    setSelectedBlock(block);
    setSelectionText("");
    setActionError(null);
    if (!availability.available) { setSettingsOpen(true); return; }
    const cached = analysisCache.get(key);
    if (cached) {
      try { parseChartReading(cached.value); return; } catch { /* Regenerate invalid entries. */ }
    }
    const requestId = analysisRequestIdRef.current;
    activeChartAnalysisRef.current = key;
    function stillCurrent() {
      const currentPaper = papersRef.current.find((item) => item.id === paper.id);
      const currentBlock = currentPaper?.blockData?.find((item) => item.id === block.id);
      return analysisRequestIdRef.current === requestId && serviceIdentityRef.current === identity &&
        selectedPaperIdRef.current === paper.id && currentBlock && getDocumentVisualSignature(currentBlock) === visual &&
        getDocumentSourceSignature(currentPaper?.blockData ?? []) === sourceSignature;
    }
    setIsBusy(true);
    setPendingAction("chart");
    setStreamingOutput({ operation: "chart", paperId: paper.id, text: "" });
    try {
      const imageDataUrl = await loadChartImage(paper.originalId, block);
      if (!stillCurrent()) return;
      const value = await requestAnalysis({ operation: "chart", paper, block, imageDataUrl }, (delta) => {
        if (!stillCurrent()) return;
        setStreamingOutput((current) => current?.operation === "chart" && current.paperId === paper.id
          ? { ...current, text: current.text + delta } : current);
      });
      parseChartReading(value);
      if (!stillCurrent()) return;
      setAnalysisCache((current) => {
        const next = new Map(current);
        setCachedAnalysis(next, { key, paperId: paper.id, scopeId: block.id, operation: "chart",
          sourceSignature: `${identity}:${paper.originalId}:${sourceSignature}:${visual}`, value, createdAt: new Date().toISOString() });
        return next;
      });
    } catch (error) {
      const failure = error as { name?: unknown; message?: unknown } | null;
      if (stillCurrent() && failure?.name !== "AbortError") {
        setActionError(typeof failure?.message === "string" ? failure.message : "图表解读失败，请重试");
      }
    } finally {
      if (analysisRequestIdRef.current === requestId) {
        activeChartAnalysisRef.current = null;
        setIsBusy(false);
        setPendingAction(null);
        setStreamingOutput(null);
      }
    }
  }

  const storageWarning = storageError ? (
    <div className="storage-warning" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <span>无法保存文献库。请检查磁盘空间或存储权限，当前更改可能在关闭后丢失。</span>
      <button aria-label="关闭提示" onClick={() => setStorageError(false)} title="关闭提示" type="button">
        <X size={16} />
      </button>
    </div>
  ) : null;
  const updateCenter = <UpdateCenter showTrigger={false} busy={isBusy || importing || activeParsing.current.size > 0 || activeUploads.current.size > 0} />;
  const setupRequired = isDesktop && (settingsReadFailed
    || settingsLoaded && getMissingServiceCredentials(serviceSettings).length > 0);
  const settingsDialog = settingsOpen || setupRequired ? (
    <ServiceSettingsDialog
      required={setupRequired}
      initialSettings={settingsLoaded ? serviceSettings : undefined}
      readFailed={settingsReadFailed}
      onClose={() => setSettingsOpen(false)}
      onSaved={(settings) => {
        setSettingsLoaded(true);
        setSettingsReadFailed(false);
        if (setupRequired && getMissingServiceCredentials(settings).length === 0) setSettingsOpen(false);
        serviceIdentityRef.current = `${settings.revision}:${settings.aiProvider}:${settings[settings.aiProvider].model}`;
        invalidateAnalysisRequests();
        serviceSettingsRef.current = settings;
        setServiceSettings(settings);
        setTranslations({});
        setExplanations({});
        setAnswer(null);
        setActionError(null);
      }}
    />
  ) : null;
  const wordbookDialog = wordbookOpen ? <WordbookDialog entries={wordbook.entries} error={wordbook.error || wordbookWriteError}
    onClose={() => setWordbookOpen(false)}
    onRemove={(id) => updateWordbook(wordbookRef.current.entries.filter((entry) => entry.id !== id))}
    onToggleMastered={(id) => updateWordbook(wordbookRef.current.entries.map((entry) => entry.id === id ? { ...entry, mastered: !entry.mastered } : entry))}
    canJump={(source) => Boolean(findWordbookSource(source))} onJump={handleWordbookJump}
    onRetry={() => { const next = loadWordbook(); wordbookRef.current = next; setWordbook(next); setWordbookWriteError(null); }} /> : null;

  if (view === "research") {
    const parsedCount = papers.filter((item) => canOpenPaper(item, pipelineStates[item.id])).length;
    return <>{storageWarning}{settingsDialog}{wordbookDialog}{updateCenter}<main className="research-workspace">
      <header className="research-workspace-header"><button type="button" className="back-button" onClick={() => setView("library")}><ArrowLeft size={17} />返回文献库</button><div><Pianpian /><strong>和篇篇聊聊</strong></div><button type="button" className="icon-button" aria-label="服务配置" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button></header>
      <div className="research-workspace-body"><aside className="research-workspace-context"><Pianpian variant="reading" /><span className="eyebrow">你的论文阅读伙伴</span><h1>每篇论文，<br />都有个伴。</h1><p>把问题告诉篇篇，一起翻翻文献库、对照原文，再把收获整理成笔记。不受首页选中论文影响。</p><div className="research-context-stat"><strong>{papers.length}</strong><span>本地文献</span><strong>{parsedCount}</strong><span>已就绪论文</span></div><div className="research-workspace-tip"><strong>证据范围</strong><p>已解析论文可读取正文与定位引用。<br />未解析条目仅提供元数据，不作为全文证据。<br />全库与单篇对话分别保存。</p></div></aside><div className="research-workspace-chat"><ResearchAssistant scope="library" paper={WORKSPACE_CONTEXT} library={papers} onAddPaper={handleAddLiterature} available={availability.available} configurationRevision={serviceSettings.revision} onOpenSettings={() => setSettingsOpen(true)} onJump={() => {}} onJumpPaper={(paperId, blockId) => { const target = papers.find((item) => item.id === paperId); if (!target || !canOpenPaper(target, pipelineStates[paperId])) return; setSelectedPaperId(paperId); setSourceNavigation({ paperId, blockId, requestId: ++sourceNavigationSequence.current }); setView("reader"); }} /></div></div>
    </main></>;
  }

  if (view === "reader" && selectedPaper && canOpenPaper(selectedPaper, pipelineStates[selectedPaper.id])) {
    const currentParagraphAnalysis = paragraphAnalysis?.paperId === selectedPaper.id &&
      paragraphAnalysis.signature === targetSignature ? paragraphAnalysis : null;
    return (
      <>
        {storageWarning}
        {settingsDialog}
        {wordbookDialog}
        {updateCenter}
        <ReaderView
          researchPanel={getDesktopBridge()?.on ? <ResearchAssistant paper={selectedPaper} library={papers} onAddPaper={handleAddLiterature}
            onJump={(blockId) => setSourceNavigation({ paperId: selectedPaper.id, blockId, requestId: ++sourceNavigationSequence.current })}
            available={availability.available} configurationRevision={serviceSettings.revision} onOpenSettings={() => setSettingsOpen(true)} /> : undefined}
          paper={selectedPaper}
          sourceNavigation={sourceNavigation}
          onSourceNavigationConsumed={(requestId) => setSourceNavigation((current) =>
            current?.requestId === requestId ? undefined : current)}
          onOpenWordbook={() => setWordbookOpen(true)}
          wordbookCount={wordbook.entries.length}
          vocabularyBlock={vocabularyBlock}
          onSaveTerm={handleSaveTerm}
          isTermSaved={(term) => Boolean(wordbook.entries.find((entry) => entry.id === academicTermKey(term.term))?.sources
            .some((source) => source.paperId === selectedPaper.id && source.contentSignature === vocabularySignature))}
          selectedBlock={translationTarget ?? selectedBlock}
          selectionText={selectionText}
          translation={currentParagraphAnalysis?.outputs.translate ?? translations[`${selectedPaper.id}:${targetSignature}`] ?? null}
          answer={answer}
          isBusy={isBusy}
          onBack={() => { invalidateAnalysisRequests(); setView("library"); }}
          onSelectBlock={(block) => {
            if (block && !selectionText && selectedBlockRef.current &&
                getDocumentBlockSignature(selectedBlockRef.current) === getDocumentBlockSignature(block)) return;
            invalidateAnalysisRequests();
            selectedBlockRef.current = block;
            setSelectedBlock(block); setSelectionText(""); setActionError(null);
          }}
          onSelectText={(block, text) => { invalidateAnalysisRequests(); setSelectedBlock(block); setSelectionText(text); setActionError(null); }}
          onAnalyzeParagraph={(block) => void handleAnalyzeParagraph(block)}
          onAnalyzeChart={(block) => void withAnalysisError(() => handleReadChart(block))}
          onTranslate={() => void withAnalysisError(handleTranslate)}
          onReadChart={() => void withAnalysisError(() => handleReadChart())}
          chartReading={chartReading}
          onExplain={(force) => void withAnalysisError(() => handleExplain(force))}
          explanation={currentParagraphAnalysis?.outputs.explain ?? explanations[`${selectedPaper.id}:${targetSignature}`] ?? null}
          onAsk={(question) => void withAnalysisError(() => handleAsk(question))}
          onOpenSettings={() => setSettingsOpen(true)}
          actionError={actionError}
          processingStatus={processing[selectedPaper.id] ?? ""}
          onReimport={(file) => void handleImport(file)}
          onPosition={(readingPosition) => setPapers((current) => current.map((paper) => paper.id === selectedPaper.id ? { ...paper, readingPosition } : paper))}
          aiAvailable={availability.available}
          serviceLabel={availability.label}
          serviceModel={availability.model}
          pendingAction={pendingAction}
          pendingParagraphActions={currentParagraphAnalysis?.pending}
          paragraphAnalysisRequestId={currentParagraphAnalysis?.requestId}
          paragraphInsightText={currentParagraphAnalysis?.pending.includes("insight") ? currentParagraphAnalysis.outputs.insight : undefined}
          streamingOutput={streamingOutput?.paperId === selectedPaper.id
            ? { operation: streamingOutput.operation, text: streamingOutput.text }
            : null}
          insight={paragraphInsight}
          onInsight={() => void withAnalysisError(() => handleLearning("insight"))}
          guide={readingGuide}
          onGuide={() => void withAnalysisError(() => handleLearning("vocabulary"))}
          vocabulary={vocabulary}
        />
      </>
    );
  }

  return (
    <>
      {storageWarning}
      {settingsDialog}
      {wordbookDialog}
      {updateCenter}
      <LibraryView
        onOpenResearch={() => setView("research")}
        papers={visiblePapers}
        onOpenWordbook={() => setWordbookOpen(true)}
        wordbookCount={wordbook.entries.length}
        selectedPaper={selectedPaper}
        selectedId={selectedPaperId}
        query={query}
        filter={filter}
        groups={groups}
        errorMessage={errorMessage || actionError}
        onFilterChange={setFilter}
        onQueryChange={setQuery}
        onSelect={handleSelectPaper}
        onImport={handleImport}
        onOpenReader={handleOpenReader}
        onStartMineru={handleStartMineru}
        onToggleFavorite={handleToggleFavorite}
        onUpdateMetadata={handleUpdateMetadata}
        onCreateGroup={handleCreateGroup}
        onDeleteGroup={handleDeleteGroup}
        onDelete={handleDeletePaper}
        onOpenSettings={() => setSettingsOpen(true)}
        pipelineStates={pipelineStates}
        mineruConfigured={serviceSettings.mineru.configured}
        importing={importing}
      />
    </>
  );
}
