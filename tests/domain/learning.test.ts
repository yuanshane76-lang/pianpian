import { describe, expect, it } from "vitest";
import { parseChartReading, parseParagraphInsight, parseReadingGuide, previewChartReading, previewParagraphInsight } from "../../src/domain/learning";

describe("structured reading assistance", () => {
  it("previews partial JSON strings, escaped quotes and unicode without exposing protocol markers", () => {
    expect(previewParagraphInsight('```json\n{"summary":"模型使用')).toEqual({ summary: "模型使用", role: "" });
    expect(previewParagraphInsight('{"summary":"包含\\"引号\\"","role":"承上')).toEqual({ summary: '包含"引号"', role: "承上" });
    expect(previewParagraphInsight('{"summary":"\\u6ce8\\u610f","role":')).toEqual({ summary: "注意", role: "" });
    expect(previewParagraphInsight('{"summary":"末尾\\')).toEqual({ summary: "末尾", role: "" });
    expect(previewParagraphInsight("")).toBeNull();
    expect(previewParagraphInsight('{"summary":33}')).toBeNull();
    expect(() => parseParagraphInsight('{"summary":"不完整')).toThrow();
  });
  it("validates short summary and contextual role", () => {
    expect(parseParagraphInsight('```json\n{"summary":"提出一种方法。","role":"承接问题，介绍本文方案。"}\n```')).toEqual({
      summary: "提出一种方法。", role: "承接问题，介绍本文方案。",
    });
    expect(() => parseParagraphInsight('{"summary":"missing role"}')).toThrow("结构");
  });
  it("previews chart fields and partial lists while keeping final validation strict", () => {
    expect(previewChartReading('{"summary":"比较\\"模型\\"","encoding":"准确率越高越好","findings":["成绩 44.5","第二条'))
      .toEqual({ summary: '比较"模型"', encoding: "准确率越高越好", findings: ["成绩 44.5", "第二条"], role: "", caveats: [] });
    expect(previewChartReading('{"summary":12,"findings":[1,null]}')).toBeNull();
    expect(previewChartReading("")).toBeNull();
    expect(() => parseChartReading('{"summary":"比较模型"}')).toThrow("结构");
  });
  it("keeps only well formed glossary terms from an AI reading guide", () => {
    expect(parseReadingGuide('{"overview":"论文介绍注意力模型。","terms":[{"term":"attention","translation":"注意力","definition":"关注相关输入"},{"term":"","translation":"empty"}]}').terms).toHaveLength(1);
  });
});
