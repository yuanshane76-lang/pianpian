import { describe, expect, it } from "vitest";
import {
  parseChartReading,
  parseEquationReading,
  parseParagraphInsight,
  parseReadingGuide,
  previewChartReading,
  previewEquationReading,
  previewParagraphInsight,
} from "../../src/domain/learning";

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
  it("previews and validates structured equation explanations", () => {
    expect(previewEquationReading('{"summary":"计算预测概率","variables":["x 是输入特征","θ 是模型参数"],"role":"用于定义训练目标","caveats":["依赖归一化输入"]'))
      .toEqual({
        summary: "计算预测概率",
        variables: ["x 是输入特征", "θ 是模型参数"],
        role: "用于定义训练目标",
        caveats: ["依赖归一化输入"],
      });
    expect(previewEquationReading('{"summary":"公式表示条件概率","variables":["x 是输入"],"role":"承接方法定义","caveats":["第二条'))
      .toEqual({
        summary: "公式表示条件概率",
        variables: ["x 是输入"],
        role: "承接方法定义",
        caveats: ["第二条"],
      });
    expect(parseEquationReading('```json\n{"summary":"计算预测概率","variables":["x 是输入特征"],"role":"定义模型输出","caveats":["参数需要训练"]}\n```'))
      .toEqual({
        summary: "计算预测概率",
        variables: ["x 是输入特征"],
        role: "定义模型输出",
        caveats: ["参数需要训练"],
      });
    expect(parseEquationReading('{"summary":"恒等关系","variables":["x 是输入"],"role":"说明变量关系","caveats":[]}').caveats).toEqual([]);
    expect(() => parseEquationReading('{"summary":"只解释含义"}')).toThrow("结构");
  });
  it("keeps only well formed glossary terms from an AI reading guide", () => {
    expect(parseReadingGuide('{"overview":"论文介绍注意力模型。","terms":[{"term":"attention","translation":"注意力","definition":"关注相关输入"},{"term":"","translation":"empty"}]}').terms).toHaveLength(1);
  });
  it("distinguishes an explicitly empty vocabulary from a missing or invalid terms field", () => {
    expect(parseReadingGuide('{"overview":"本段无适合的词汇。","terms":[]}').terms).toEqual([]);
    for (const value of [{ overview: "学习重点" }, { overview: "学习重点", terms: null },
      { overview: "学习重点", terms: "attention" }]) {
      expect(() => parseReadingGuide(JSON.stringify(value))).toThrow("结构");
    }
  });
});
