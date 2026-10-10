import { describe, expect, it } from "vitest";
import { getReaderProgress, pipelineStageLabel, type PaperPipelineState } from "../../src/domain/pipeline";

const pipeline: PaperPipelineState = { paperId: "paper", source: "mineru", stage: "ready" };
const context = {
  originalAvailable: true, layoutReady: true, mineruConfigured: true,
  mineruPending: false, localParseFailed: false,
};

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
      .toMatchObject({ status: "warning", action: "parse", detail: "未获得可用坐标" });
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
    expect(pipelineStageLabel({ paperId: "paper", source: "mineru", stage: "failed" })).toContain("原文仍可阅读");
    expect(pipelineStageLabel({ paperId: "paper", source: "mineru", stage: "failed", error: "MinerU 解析失败" })).toBe("MinerU 解析失败");
    expect(pipelineStageLabel({ paperId: "paper", source: "mineru", stage: "ready" })).toContain("PDF 已就绪");
  });
});
