import { describe, expect, it } from "vitest";
import { parseParagraphInsight, parseReadingGuide } from "../../src/domain/learning";

describe("structured reading assistance", () => {
  it("validates short summary and contextual role", () => {
    expect(parseParagraphInsight('```json\n{"summary":"提出一种方法。","role":"承接问题，介绍本文方案。"}\n```')).toEqual({
      summary: "提出一种方法。", role: "承接问题，介绍本文方案。",
    });
    expect(() => parseParagraphInsight('{"summary":"missing role"}')).toThrow("结构");
  });
  it("keeps only well formed glossary terms from an AI reading guide", () => {
    expect(parseReadingGuide('{"overview":"论文介绍注意力模型。","terms":[{"term":"attention","translation":"注意力","definition":"关注相关输入"},{"term":"","translation":"empty"}]}').terms).toHaveLength(1);
  });
});
