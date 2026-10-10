import type { DocumentBlock } from "../domain/documentBlocks";
import type { PaperRecord } from "../domain/library";

export interface AiRequest {
  operation: "overview" | "translate" | "qa" | "explain" | "insight" | "guide" | "chart" | "vocabulary";
  paper: PaperRecord;
  block?: DocumentBlock;
  question?: string;
  imageDataUrl?: string;
}

function localOverview(paper: PaperRecord): string {
  const firstBlocks = paper.blockData?.slice(0, 8).map((block) => block.text).join(" ") ?? "";
  const excerpt = firstBlocks.length > 280 ? `${firstBlocks.slice(0, 280)}...` : firstBlocks;
  return `这是一篇 ${paper.year ?? "未标注年份"} 年的研究论文，当前已提取 ${paper.blocks} 个阅读块。本文开头内容显示：${excerpt || "尚未提取正文"}\n\n建议先确认研究问题、方法和实验结论，再进入逐块翻译。`;
}

function localTranslation(block: DocumentBlock): string {
  return `本地译文草稿：${block.text}`;
}

function localAnswer(paper: PaperRecord, question: string): string {
  const context = paper.blockData?.slice(0, 4).map((block) => block.text).join(" ") ?? "";
  return `这是本地演示回答。针对“${question}”，当前可用上下文来自《${paper.title}》：${context.slice(0, 360)}${context.length > 360 ? "..." : ""}`;
}

export async function runAiRequest(request: AiRequest): Promise<string> {
  if (request.operation === "overview") return localOverview(request.paper);
  if (request.operation === "translate" && request.block) return localTranslation(request.block);
  if (request.operation === "qa") {
    return localAnswer(request.paper, request.question?.trim() || "这篇论文解决了什么问题？");
  }
  return "当前请求缺少必要的论文上下文。";
}
