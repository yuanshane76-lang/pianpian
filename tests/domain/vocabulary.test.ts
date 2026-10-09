import { describe, expect, it } from "vitest";
import type { DocumentBlock } from "../../src/domain/documentBlocks";
import { extractAcademicVocabulary, type AcademicTerm } from "../../src/domain/vocabulary";

function block(text: string, input: Partial<DocumentBlock> = {}): DocumentBlock {
  return { id: "b1", kind: "paragraph", text, pageNumber: 1, order: 0, ...input };
}

describe("academic vocabulary grounded in document text", () => {
  it("extracts useful Chinese glossary entries with exact block and English sentence evidence", () => {
    const text = "We describe the setup. The hypothesis is tested through an ablation study [12]. We report the results.";
    const terms: AcademicTerm[] = extractAcademicVocabulary([block(text, { id: "p4-b2", pageNumber: 4 })]);
    const hypothesis = terms.find((item) => item.term === "hypothesis");
    expect(hypothesis).toMatchObject({
      translation: "假设", blockId: "p4-b2", pageNumber: 4, count: 1, source: "local",
    });
    expect(hypothesis?.definition).toMatch(/检验|验证/);
    expect(hypothesis?.example).toBe("The hypothesis is tested through an ablation study [12].");
    expect(text).toContain(hypothesis!.example);
    expect(terms.find((item) => item.term === "ablation study")?.example).toContain("[12]");
  });

  it("uses whole words without stemming modelled, modelling, imprecise, or unrelated prefixes", () => {
    const terms = extractAcademicVocabulary([block("Model model MODEL modelled modelling remodel model2 _model démodel accuracy inaccuracies precision imprecise.")]);
    expect(terms.find((item) => item.term === "model")?.count).toBe(3);
    expect(terms.find((item) => item.term === "accuracy")?.count).toBe(1);
    expect(terms.find((item) => item.term === "precision")?.count).toBe(1);
    expect(extractAcademicVocabulary([block("modelled modelling remodel imprecise inaccuracies.")])).toEqual([]);
  });

  it("merges only explicit inflection variants and counts different casing once per occurrence", () => {
    const terms = extractAcademicVocabulary([block("Hypothesis HYPOTHESES hypothesis. Analysis analyses. Model models.")]);
    expect(terms.filter((item) => /^hypothes/i.test(item.term))).toHaveLength(1);
    expect(terms.find((item) => item.term === "hypothesis")?.count).toBe(3);
    expect(terms.find((item) => item.term === "analysis")?.count).toBe(2);
    expect(terms.find((item) => item.term === "model")?.count).toBe(2);
  });

  it("matches hyphen and whitespace phrase variants while retaining original citation text", () => {
    const text = "A state-of-the-art system [3] uses cross‑validation. Another state of the art system uses cross-validation. State–of–the–art performance follows.";
    const terms = extractAcademicVocabulary([block(text)]);
    expect(terms.find((item) => item.term === "state-of-the-art")?.count).toBe(3);
    expect(terms.find((item) => item.term === "cross-validation")?.count).toBe(2);
    expect(terms.find((item) => item.term === "state-of-the-art")?.example).toBe("A state-of-the-art system [3] uses cross‑validation.");
  });

  it("extracts only heading and paragraph evidence and selects the first block in document order", () => {
    const input = [
      block("A hypothesis follows.", { id: "late", order: 9, pageNumber: 3 }),
      block("Hypothesis", { id: "title", order: 1, kind: "heading", pageNumber: 2 }),
      block("Hypothesis estimation.", { kind: "image", order: 0, caption: "Inference" }),
      block("Hypothesis estimation.", { kind: "table" }),
      block("Hypothesis estimation.", { kind: "equation" }),
    ];
    const snapshot = structuredClone(input);
    const terms = extractAcademicVocabulary(input);
    expect(terms.find((item) => item.term === "hypothesis")).toMatchObject({ blockId: "title", pageNumber: 2, example: "Hypothesis", count: 2 });
    expect(terms.some((item) => item.term === "estimation" || item.term === "inference")).toBe(false);
    expect(input).toEqual(snapshot);
  });

  it("filters hallucinated AI terms and generic stopwords while ranking evidenced AI terms before local ones", () => {
    const text = "The model model model uses scaled dot-product attention. Optimization improves the model.";
    const terms = extractAcademicVocabulary([block(text)], [
      { term: "quantum entanglement", translation: "量子纠缠", definition: "量子态之间的关联。" },
      { term: "scaled dot-product attention", translation: "缩放点积注意力", definition: "将查询与键的点积按维度缩放后生成注意力权重。" },
      { term: "the", translation: "这个", definition: "冠词" },
    ]);
    expect(terms[0]).toMatchObject({ term: "scaled dot-product attention", count: 1, source: "ai", blockId: "b1" });
    expect(terms[0].example).toBe("The model model model uses scaled dot-product attention.");
    expect(terms.some((item) => item.term === "quantum entanglement" || item.term === "the")).toBe(false);
    expect(terms.find((item) => item.term === "model")?.count).toBe(4);
  });

  it("merges AI and curated entries across case, inflection, and hyphen variants", () => {
    const terms = extractAcademicVocabulary([block("Cross-validation and cross validation compare models with one model.")], [
      { term: "CROSS VALIDATION", translation: "交叉验证", definition: "轮流用不同数据子集验证模型的泛化表现。" },
      { term: "cross-validation", translation: "不应覆盖首条", definition: "重复定义" },
      { term: "Models", translation: "模型" },
    ]);
    const cross = terms.filter((item) => item.term === "cross-validation");
    expect(cross).toHaveLength(1);
    expect(cross[0]).toMatchObject({ count: 2, source: "ai", translation: "交叉验证" });
    expect(cross[0].definition).toContain("泛化");
    expect(terms.filter((item) => item.term === "model")).toHaveLength(1);
    expect(terms.find((item) => item.term === "model")).toMatchObject({ source: "ai", count: 2 });
    expect(terms.find((item) => item.term === "model")?.definition).toMatch(/表示|描述/);
  });

  it("escapes literal punctuation in AI terms rather than treating them as regex syntax", () => {
    const terms = extractAcademicVocabulary([block("C++ is used here. A p-value is reported. C+ and pXvalue are different.")], [
      { term: "C++", translation: "C++语言", definition: "支持泛型与面向对象编程的语言。" },
      { term: "p-value", translation: "p值", definition: "零假设成立时观察到当前或更极端结果的概率。" },
      { term: "p.value", translation: "虚构术语" },
    ]);
    expect(terms.find((item) => item.term.toLowerCase() === "c++")?.count).toBe(1);
    expect(terms.find((item) => item.term === "p-value")?.count).toBe(1);
    expect(terms.some((item) => item.term === "p.value")).toBe(false);
  });

  it("retains phrase matches across layout line breaks and does not match concatenated words", () => {
    const terms = extractAcademicVocabulary([block("An ablation\nstudy [7] uses a confidence-\ninterval. Neither ablationstudy nor confidenceinterval is a phrase.")]);
    expect(terms.find((item) => item.term === "ablation study")?.count).toBe(1);
    expect(terms.find((item) => item.term === "confidence interval")?.count).toBe(1);
    expect(terms.find((item) => item.term === "ablation study")?.example).toContain("ablation\nstudy [7]");
  });

  it("sorts by AI source then occurrence count, deduplicates repeated AI suggestions, and caps output at 80", () => {
    const aiTerms = Array.from({ length: 100 }, (_, index) => ({
      term: `technicalterm${index}`, translation: `技术术语${index}`, definition: `第${index}个测试术语。`,
    }));
    const text = `${aiTerms.map((item) => item.term).join(". ")}. technicalterm99 technicalterm99. Hypothesis hypothesis hypothesis hypothesis.`;
    const terms = extractAcademicVocabulary([block(text)], [...aiTerms, { ...aiTerms[99], term: "TECHNICALTERM99" }]);
    expect(terms).toHaveLength(80);
    expect(terms.every((item) => item.source === "ai")).toBe(true);
    expect(terms[0]).toMatchObject({ term: "technicalterm99", count: 3 });
    expect(new Set(terms.map((item) => item.term.toLowerCase())).size).toBe(80);
    expect(terms.every((item) => text.includes(item.example))).toBe(true);
  });

  it("provides a substantial curated academic glossary with specific Chinese definitions", () => {
    const samples = [
      "hypothesis", "theory", "framework", "methodology", "assumption", "criterion", "constraint", "objective",
      "analysis", "inference", "estimation", "optimization", "approximation", "distribution", "variance",
      "correlation", "causality", "probability", "likelihood", "bias", "parameter", "variable",
      "sample", "dataset", "benchmark", "baseline", "evaluation", "validation", "experiment", "empirical",
      "robustness", "generalization", "reproducibility", "reliability", "validity", "significance",
      "confidence interval", "statistical significance", "effect size", "standard deviation",
      "regression", "classification", "clustering", "overfitting", "underfitting", "regularization",
      "gradient", "convergence", "accuracy", "precision", "recall", "efficiency", "complexity",
      "ablation study", "cross-validation", "state-of-the-art", "trade-off", "qualitative", "quantitative", "model",
    ];
    for (const term of samples) {
      const entry = extractAcademicVocabulary([block(`We discuss ${term} [4].`)]).find((item) => item.term === term);
      expect(entry, term).toBeDefined();
      expect(entry?.translation, term).toMatch(/[\u3400-\u9fff]/);
      expect(entry?.definition.length, term).toBeGreaterThan(8);
      expect(entry?.definition, term).not.toMatch(/学术术语|重要概念|具体含义取决|用于论文|相关概念/);
    }
  });

  it("returns no glossary for absent English evidence, stopwords, or unsupported AI entries", () => {
    expect(extractAcademicVocabulary([])).toEqual([]);
    expect(extractAcademicVocabulary([block("本文介绍模型、假设与优化。")])).toEqual([]);
    expect(extractAcademicVocabulary([block("The and of is are was we our this that a an in to with from paper study work.")], [
      { term: "and", translation: "和" }, { term: "study", translation: "研究" },
      { term: "we", translation: "我们" }, { term: "模型", translation: "模型" },
    ])).toEqual([]);
    expect(extractAcademicVocabulary([block("The spectral operator is used.")], [{ term: "spectral operator", translation: "" }])).toEqual([]);
  });
});
