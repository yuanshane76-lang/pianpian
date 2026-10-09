import type { DocumentBlock } from "./documentBlocks";

export type PipelineStage =
  | "saving"
  | "local-extracting"
  | "mineru-consent"
  | "mineru-uploading"
  | "mineru-processing"
  | "mineru-downloading"
  | "translating-preview"
  | "ready"
  | "partial"
  | "failed";

export interface PaperPipelineState {
  paperId: string;
  source: "local" | "mineru";
  stage: PipelineStage;
  mineruProgress?: number;
  mineruMessage?: string;
  translatedCount: number;
  queuedCount: number;
  failedCount: number;
  currentLabel?: string;
  paused: boolean;
  error?: string;
}

export function isTranslatableBlock(block: DocumentBlock): boolean {
  return block.kind === "paragraph" && block.text.trim().length >= 40;
}

function isHeading(block: DocumentBlock, pattern: RegExp): boolean {
  return block.kind === "heading" && pattern.test(block.text.trim());
}

export function selectInitialTranslationBlocks(blocks: DocumentBlock[], limit = 5): DocumentBlock[] {
  if (limit <= 0) return [];
  const candidates = blocks.filter(isTranslatableBlock);
  const abstractIndex = blocks.findIndex((block) => isHeading(block, /^(abstract|摘要)$/i));
  const introIndex = blocks.findIndex((block) => isHeading(block, /^(?:\d+[.)]?\s*)?(introduction|background|引言|背景)$/i));
  const preferred: DocumentBlock[] = [];

  for (const start of [abstractIndex, introIndex]) {
    if (start < 0) continue;
    for (const block of blocks.slice(start + 1)) {
      if (block.kind === "heading" && preferred.length) break;
      if (isTranslatableBlock(block)) preferred.push(block);
      if (preferred.length >= limit) break;
    }
    if (preferred.length >= limit) break;
  }

  for (const block of candidates) {
    if (preferred.some((item) => item.id === block.id)) continue;
    preferred.push(block);
    if (preferred.length >= limit) break;
  }
  return preferred.slice(0, limit);
}

export function pipelineStageLabel(state: PaperPipelineState): string {
  if (state.error) return state.error;
  if (state.stage === "saving") return "正在保存原始 PDF…";
  if (state.stage === "local-extracting") return "原文已保存，正在整理临时正文…";
  if (state.stage === "mineru-consent") return "等待确认上传到 MinerU";
  if (state.stage === "mineru-uploading") return "正在上传 PDF 到 MinerU…";
  if (state.stage === "mineru-processing") return state.mineruMessage || "MinerU 正在解析正文、图表和公式…";
  if (state.stage === "mineru-downloading") return "正在下载 MinerU 结构化结果…";
  if (state.stage === "translating-preview") {
    return state.currentLabel
      ? `正在翻译：${state.currentLabel}`
      : `中文预览已完成 ${state.translatedCount} 段`;
  }
  if (state.stage === "partial") return state.mineruMessage || "PDF 已就绪，MinerU 交互层仍在生成…";
  if (state.stage === "failed") return "处理失败，原文仍可阅读";
  return "PDF 已就绪，MinerU 交互层已叠加";
}
