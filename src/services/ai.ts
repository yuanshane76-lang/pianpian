import type { DocumentBlock } from "../domain/documentBlocks";
import type { PaperRecord } from "../domain/library";

export interface AiRequest {
  operation: "translate" | "qa" | "explain" | "insight" | "guide" | "chart" | "vocabulary";
  paper: PaperRecord;
  block?: DocumentBlock;
  question?: string;
  imageDataUrl?: string;
}

function localTranslation(block: DocumentBlock): string {
  return `本地译文草稿：${block.text}`;
}

function localAnswer(paper: PaperRecord, question: string): string {
  const context = paper.blockData?.slice(0, 4).map((block) => block.text).join(" ") ?? "";
  return `这是本地演示回答。针对“${question}”，当前可用上下文来自《${paper.title}》：${context.slice(0, 360)}${context.length > 360 ? "..." : ""}`;
}

export async function runAiRequest(request: AiRequest): Promise<string> {
  if (request.operation === "translate" && request.block) return localTranslation(request.block);
  if (request.operation === "qa") {
    return localAnswer(request.paper, request.question?.trim() || "这篇论文解决了什么问题？");
  }
  return "当前请求缺少必要的论文上下文。";
}
