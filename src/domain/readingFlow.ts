import type { DocumentBlock } from "./documentBlocks";
import type { PublicServiceSettings } from "./serviceSettings";

export function getTranslationTarget(block: DocumentBlock | null, selection: string): DocumentBlock | null {
  if (!block || isVisualBlock(block)) return null;
  const text = selection.trim();
  // The PDF reader already resolves the selection to its block geometrically.
  // PDF.js and MinerU may differ in whitespace, ligatures and citation spacing.
  return text ? { ...block, text } : block;
}

export function isVisualBlock(block: DocumentBlock | null): boolean {
  return block?.kind === "table" || block?.kind === "image";
}

export function getAnalysisAvailability(settings: PublicServiceSettings) {
  const provider = settings.aiProvider;
  return {
    available: provider !== "local" && settings[provider].configured,
    label: provider === "local" ? "未启用 AI" : provider === "deepseek" ? "DeepSeek" : "阿里云百炼",
    model: provider === "local" ? "" : settings[provider].model,
  };
}
