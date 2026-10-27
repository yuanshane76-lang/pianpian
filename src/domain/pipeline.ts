import type { PaperRecord } from "./library";
import type { DocumentBlock } from "./documentBlocks";
import { hasPageBounds } from "./pdfLayout";

export type PipelineStage =
  | "saving"
  | "local-extracting"
  | "mineru-consent"
  | "mineru-uploading"
  | "mineru-processing"
  | "mineru-downloading"
  | "ready"
  | "partial"
  | "failed";

export interface PaperPipelineState {
  paperId: string;
  source: "local" | "mineru";
  stage: PipelineStage;
  mineruProgress?: number;
  mineruState?: string;
  mineruMessage?: string;
  error?: string;
}

export interface ReaderProgressContext {
  originalAvailable: boolean;
  layoutReady: boolean;
  mineruConfigured: boolean;
  mineruPending: boolean;
  localParseFailed: boolean;
}

export interface ReaderProgressStep {
  status: "done" | "active" | "idle" | "waiting" | "warning";
  detail: string;
  description?: string;
  percent?: number;
  action?: "configure" | "parse" | "retry-local";
}

export function hasCompletePageBounds(blocks?: DocumentBlock[]): boolean {
  return Boolean(blocks?.length && blocks.every(hasPageBounds));
}

export function getPaperPipelineState(
  paper: PaperRecord,
  state?: PaperPipelineState,
): PaperPipelineState {
  if (state) return state;
  if (paper.parseError) {
    return {
      paperId: paper.id,
      source: "mineru",
      stage: "failed",
      error: paper.parseError,
    };
  }
  return {
    paperId: paper.id,
    source: "mineru",
    stage: "partial",
    mineruMessage: "等待 MinerU 完成解析与坐标定位…",
  };
}

export function canOpenPaper(paper: PaperRecord, state?: PaperPipelineState): boolean {
  // Only a published main-process result can establish the ready pipeline.
  // Cached renderer records (including legacy records) cannot prove completion.
  // 幻灯片模式（pptx/ppt 或识别为演示文稿的 PDF）由坐标画布渲染，不要求坐标完整。
  const deck = paper.readingMode === "deck";
  return Boolean(paper.originalId && paper.parseStatus === "ready"
    && state?.paperId === paper.id && state.source === "mineru" && state.stage === "ready"
    && (deck ? Boolean(paper.blockData?.length) : hasCompletePageBounds(paper.blockData)));
}

export function getLibraryPreparation(paper: PaperRecord, state: PaperPipelineState | undefined, configured: boolean) {
  const pipeline = getPaperPipelineState(paper, state);
  const active = ["saving", "mineru-uploading", "mineru-processing", "mineru-downloading"].includes(pipeline.stage);
  const failed = pipeline.stage === "failed";
  const percent = pipeline.stage === "mineru-processing" && pipeline.mineruState === "running"
    && Number.isFinite(pipeline.mineruProgress)
    ? Math.round(Math.max(0, Math.min(1, pipeline.mineruProgress!)) * 100) : undefined;
  const detail = !paper.originalId ? "原始 PDF 缺失，请重新导入"
    : !configured && !active ? "请配置 MinerU，配置后自动解析"
    : pipeline.stage === "mineru-processing" && pipeline.mineruState === "pending" ? pipeline.mineruMessage || "已上传，等待云端开始解析"
    : pipeline.stage === "mineru-processing" && pipeline.mineruState === "converting" ? "正在整理段落、图表与公式"
    : pipelineStageLabel(pipeline);
  return { active, failed, percent, detail,
    action: !paper.originalId || active ? undefined : !configured ? "配置 MinerU" : failed ? "重新解析" : "开始解析" };
}

export function getReaderProgress(state: PaperPipelineState, context: ReaderProgressContext): {
  original: ReaderProgressStep; layout: ReaderProgressStep;
} {
  const original: ReaderProgressStep = context.originalAvailable
    ? { status: "done", detail: "可阅读" }
    : { status: "warning", detail: "请重新导入原始 PDF" };
  if (context.originalAvailable && context.localParseFailed) {
    original.detail = "可阅读 · 正文整理失败";
    original.action = "retry-local";
  } else if (context.originalAvailable && state.stage === "local-extracting") {
    original.detail = "可阅读 · 正在整理正文";
  }
  let layout: ReaderProgressStep;
  if (state.stage === "mineru-processing" && state.mineruState === "pending") {
    layout = { status: "waiting", detail: "云端排队中", description: state.mineruMessage };
  } else if (state.stage === "mineru-processing" && state.mineruState === "waiting-file") {
    layout = { status: "warning", detail: "等待重新上传", action: "parse" };
  } else if (state.stage === "mineru-processing" && state.mineruState === "converting") {
    layout = { status: "active", detail: "正在整理段落、图表与公式", description: state.mineruMessage };
  } else if (["mineru-uploading", "mineru-processing", "mineru-downloading"].includes(state.stage)) {
    const percent = state.stage === "mineru-processing" && Number.isFinite(state.mineruProgress)
      ? Math.round(Math.max(0, Math.min(1, state.mineruProgress!)) * 100) : undefined;
    layout = {
      status: "active", percent,
      detail: state.stage === "mineru-uploading" ? "正在上传 PDF"
        : state.stage === "mineru-downloading" ? "正在下载并准备定位"
        : percent === undefined ? "正在识别段落、图表与公式" : `已解析 ${percent}% 页面`,
      description: state.mineruMessage,
    };
  } else if (state.stage === "failed" && state.source === "mineru") {
    layout = { status: "warning", detail: "解析失败", description: state.error,
      action: context.mineruConfigured ? "parse" : "configure" };
  } else if (context.layoutReady) {
    layout = { status: "done", detail: "已就绪", description: "段落、图表与公式可定位" };
  } else if (!context.mineruConfigured) {
    layout = { status: "idle", detail: "配置后可定位段落", action: "configure" };
  } else if (context.mineruPending) {
    layout = { status: "waiting", detail: "解析任务可继续", action: "parse" };
  } else if (state.stage === "mineru-consent") {
    layout = { status: "waiting", detail: "等待确认上传", action: "parse" };
  } else if (state.source === "mineru" && state.stage === "partial") {
    layout = { status: "warning", detail: "等待 MinerU 完成解析", action: "parse" };
  } else {
    layout = { status: "idle", detail: "解析后可点击原文", action: "parse" };
  }
  return { original, layout };
}

export function pipelineStageLabel(state: PaperPipelineState): string {
  if (state.error) return state.error;
  if (state.stage === "saving") return "正在保存原始 PDF…";
  if (state.stage === "local-extracting") return "原文已保存，正在整理临时正文…";
  if (state.stage === "mineru-consent") return "等待确认上传到 MinerU";
  if (state.stage === "mineru-uploading") return "正在上传 PDF 到 MinerU…";
  if (state.stage === "mineru-processing") return state.mineruMessage || "MinerU 正在解析正文、图表和公式…";
  if (state.stage === "mineru-downloading") return "正在下载 MinerU 结构化结果…";
  if (state.stage === "partial") return state.mineruMessage || "等待 MinerU 完成解析与坐标定位…";
  if (state.stage === "failed") return state.error || "MinerU 解析失败，请重试";
  return "PDF 已就绪，MinerU 交互层已叠加";
}
