import type { PaperRecord } from "../domain/library";
import {
  selectRadarCandidates,
  type RadarCandidate,
  type RadarSeed,
} from "../domain/paperRadar";
import { getDesktopBridge } from "../platform/electron";
import { loadPapers } from "./library";

export interface RadarResult {
  candidates: RadarCandidate[];
  source: string;
  fetchedAt: string;
  cached: boolean;
}

export const DEFAULT_RADAR_LIMIT = 50;

export function radarSeedFromPaper(paper: Pick<PaperRecord, "title" | "doi">): RadarSeed {
  return {
    title: (paper.title ?? "").trim(),
    ...(paper.doi ? { doi: paper.doi } : {}),
  };
}

/**
 * Recall only: the main process talks to the public bibliographic API, and the
 * domain layer drops the seed itself plus anything already in the library.
 */
export async function loadRelatedPapers(options: {
  paper: Pick<PaperRecord, "title" | "doi">;
  library?: Array<Pick<PaperRecord, "title" | "doi">>;
  limit?: number;
}): Promise<RadarResult> {
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error("相似论文检索仅在桌面程序中可用，网页预览不提供该能力。");
  const seed = radarSeedFromPaper(options.paper);
  if (!seed.title && !seed.doi) throw new Error("当前论文缺少标题和 DOI，无法检索相似工作。");
  const limit = options.limit ?? DEFAULT_RADAR_LIMIT;
  const library = options.library ?? loadPapers();

  const payload = await bridge.invoke<{
    candidates?: unknown;
    source?: unknown;
    fetchedAt?: unknown;
    cached?: unknown;
  }>("zhiyan:radar:related", { title: seed.title, doi: seed.doi, limit });

  return {
    candidates: selectRadarCandidates({
      candidates: payload?.candidates,
      seed,
      known: library.map((paper) => ({ title: paper.title, doi: paper.doi })),
      limit,
    }),
    source: typeof payload?.source === "string" ? payload.source : "Semantic Scholar",
    fetchedAt: typeof payload?.fetchedAt === "string" ? payload.fetchedAt : new Date().toISOString(),
    cached: payload?.cached === true,
  };
}
