import { describe, expect, it } from "vitest";
import { canOpenPaper, getReaderProgress, pipelineStageLabel, type PaperPipelineState } from "../../src/domain/pipeline";
import type { PaperRecord } from "../../src/domain/library";

const paper: PaperRecord = {
  id: "paper", title: "Paper", authors: [], year: null, sourcePath: "local://paper",
  originalId: "original", importedAt: "2026-10-11", groupId: "group-inbox", favorite: false, blocks: 1,
  parseStatus: "ready", blockData: [{ id: "b", kind: "paragraph", text: "Body",
    pageNumber: 1, order: 0, bbox: [.1, .1, .9, .2] }],
};

const pipeline: PaperPipelineState = { paperId: "paper", source: "mineru", stage: "ready" };
const context = {
  originalAvailable: true, layoutReady: true, mineruConfigured: true,
  mineruPending: false, localParseFailed: false,
};

describe("mandatory reading readiness", () => {
  it("opens a deck paper without coordinates once parsing is ready", () => {
    const deck = { ...paper, sourceFormat: "deck" as const, blockData: [{ id: "s", kind: "paragraph" as const, text: "Slide", pageNumber: 1, order: 0 }] };
    expect(canOpenPaper(deck, pipeline)).toBe(true);
    expect(canOpenPaper({ ...deck, blockData: [] }, pipeline)).toBe(false);
    expect(canOpenPaper({ ...deck, parseStatus: "pending" }, pipeline)).toBe(false);
  });

  it("only opens a completed MinerU result with an original and complete valid coordinates", () => {
    expect(canOpenPaper(paper, pipeline)).toBe(true);
    expect(canOpenPaper(paper)).toBe(false);
    expect(canOpenPaper({ ...paper, parseStatus: undefined })).toBe(false);
    expect(canOpenPaper(paper, { ...pipeline, source: "local" })).toBe(false);
    expect(canOpenPaper({ ...paper, originalId: undefined }, pipeline)).toBe(false);
    expect(canOpenPaper({ ...paper, parseStatus: "pending" }, pipeline)).toBe(false);
  });

  it("keeps older coordinates locked during processing, download, recovery and failure", () => {
    for (const stage of ["mineru-processing", "mineru-downloading", "partial", "failed"] as const) {
      expect(canOpenPaper(paper, { ...pipeline, stage })).toBe(false);
    }
  });

  it("rejects missing, out-of-page, inverted, and partly positioned results", () => {
    for (const bbox of [undefined, [-1, .1, .9, .2], [.1, .1, 2, .2], [.9, .1, .1, .2], [.1, .1, .9, NaN]]) {
      expect(canOpenPaper({ ...paper, blockData: [{ ...paper.blockData![0], bbox: bbox as never }] }, pipeline)).toBe(false);
    }
    expect(canOpenPaper({ ...paper, blockData: [...paper.blockData!, { ...paper.blockData![0], id: "missing", bbox: undefined }] }, pipeline)).toBe(false);
  });
});

describe("independent reading progress", () => {
  it("requires an original file before reporting readable", () => {
    expect(getReaderProgress(pipeline, { ...context, originalAvailable: false }).original)
      .toMatchObject({ status: "warning", detail: "请重新导入原始 PDF" });
  });

  it("keeps local text retries and existing coordinates independent", () => {
    const progress = getReaderProgress(pipeline, { ...context, localParseFailed: true });
    expect(progress.original).toMatchObject({ status: "done", action: "retry-local" });
    expect(progress.layout.status).toBe("done");
  });

  it("does not infer positioned paragraphs from a ready stage without coordinates", () => {
    expect(getReaderProgress(pipeline, { ...context, layoutReady: false }).layout.status).not.toBe("done");
  });

  it("uses real page progress and does not invent percentages for uploads or downloads", () => {
    expect(getReaderProgress({ ...pipeline, stage: "mineru-processing", mineruProgress: 0.4 }, context).layout)
      .toMatchObject({ status: "active", percent: 40 });
    for (const stage of ["mineru-uploading", "mineru-processing", "mineru-downloading"] as const) {
      const layout = getReaderProgress({ ...pipeline, stage }, context).layout;
      expect(layout.status).toBe("active");
      expect(layout.percent).toBeUndefined();
    }
  });

  it("distinguishes queueing, conversion and downloading from completed positioning", () => {
    expect(getReaderProgress({ ...pipeline, stage: "mineru-processing", mineruState: "pending", mineruProgress: 0 }, context).layout)
      .toMatchObject({ status: "waiting", detail: "云端排队中" });
    const converting = getReaderProgress({ ...pipeline, stage: "mineru-processing", mineruState: "converting", mineruProgress: 1 }, context).layout;
    expect(converting).toMatchObject({ status: "active", detail: "正在整理段落、图表与公式" });
    expect(converting.percent).toBeUndefined();
    expect(getReaderProgress({ ...pipeline, stage: "mineru-downloading", mineruProgress: 1 }, context).layout)
      .toMatchObject({ status: "active", detail: "正在下载并准备定位" });
  });

  it("keeps a failed reparse actionable while the original and older coordinates remain usable", () => {
    const progress = getReaderProgress({ ...pipeline, stage: "failed", error: "下载中断" }, context);
    expect(progress.original.status).toBe("done");
    expect(progress.layout).toMatchObject({ status: "warning", action: "parse", description: "下载中断" });
  });

  it("makes missing coordinates and upload consent actionable", () => {
    expect(getReaderProgress(pipeline, { ...context, layoutReady: false, mineruConfigured: false }).layout.action).toBe("configure");
    expect(getReaderProgress({ ...pipeline, stage: "partial" }, { ...context, layoutReady: false }).layout)
      .toMatchObject({ status: "warning", action: "parse", detail: "等待 MinerU 完成解析" });
    expect(getReaderProgress({ ...pipeline, source: "local", stage: "mineru-consent" }, { ...context, layoutReady: false }).layout)
      .toMatchObject({ status: "waiting", detail: "等待确认上传", action: "parse" });
  });
});

describe("paper processing pipeline", () => {
  it("returns a truthful status label for active MinerU processing", () => {
    expect(pipelineStageLabel({
      paperId: "paper", source: "local", stage: "mineru-processing",
      mineruMessage: "已处理 4 / 15 页",
    })).toBe("已处理 4 / 15 页");
  });

  it("keeps document preparation and parse failures separate from on-demand AI", () => {
    expect(pipelineStageLabel({ paperId: "paper", source: "local", stage: "local-extracting" })).toContain("整理临时正文");
    expect(pipelineStageLabel({ paperId: "paper", source: "mineru", stage: "failed" })).toContain("MinerU 解析失败");
    expect(pipelineStageLabel({ paperId: "paper", source: "mineru", stage: "failed", error: "MinerU 解析失败" })).toBe("MinerU 解析失败");
    expect(pipelineStageLabel({ paperId: "paper", source: "mineru", stage: "ready" })).toContain("PDF 已就绪");
  });
});
