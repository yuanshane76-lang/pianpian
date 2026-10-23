import type { DocumentBlock } from "../domain/documentBlocks";
import type { ParagraphReadingMode } from "../domain/analysis";
import type { PaperRecord } from "../domain/library";

/** 论文骨架的传输视图：渲染层从领域骨架生成，主进程只负责拼提示词。 */
export interface WikiSkeletonSection {
  id: string;
  title: string;
  level: number;
  /** 一级章节的首个内容块，供主进程拼接各章开头。 */
  firstBlockIds?: string[];
}

export interface WikiSectionContext {
  id: string;
  title: string;
  /** 从顶层到本章节的标题路径，如 "3 方法 / 3.2 数据预处理"。 */
  path: string;
  /** 同级章节标题，供模型区分边界。 */
  siblingTitles: string[];
}

export interface AiRequest {
  operation: "translate" | "qa" | "explain" | "insight" | "guide" | "chart" | "equation" | "vocabulary" | "wiki-thread" | "wiki-section";
  paper: PaperRecord;
  block?: DocumentBlock;
  question?: string;
  imageDataUrl?: string;
  readingMode?: ParagraphReadingMode;
  /** wiki-thread：本地标题骨架（真值），模型只在它上面提炼论证主线。 */
  wikiSkeleton?: WikiSkeletonSection[];
  /** wiki-section：目标章节的描述；paper.blockData 只包含该章节的阅读块。 */
  wikiSection?: WikiSectionContext;
}
