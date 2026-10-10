import { describe, expect, it } from "vitest";
import { addWordbookTerm, academicTermKey, parseWordbook, resolveWordbookSourceBlock } from "../../src/domain/wordbook";
import type { AcademicTerm } from "../../src/domain/vocabulary";
import { getDocumentContentSignature, type DocumentBlock } from "../../src/domain/documentBlocks";

const term: AcademicTerm = {
  term: "cross-validation", translation: "交叉验证", definition: "轮流划分训练与验证数据。",
  blockId: "b1", pageNumber: 2, count: 1, example: "We use cross-validation.", source: "local",
};
const source = { paperId: "paper1", paperTitle: "First Paper", blockId: "b1", pageNumber: 2,
  contentSignature: "content1", example: term.example };

describe("personal wordbook", () => {
  it("resolves exact block identity before signatures and refuses ambiguous fallbacks", () => {
    const first: DocumentBlock = { id: "first", kind: "paragraph", pageNumber: 1, order: 0, text: "We use attention." };
    const second = { ...first, id: "second", pageNumber: 3, order: 1 };
    const saved = { ...source, blockId: "second", pageNumber: 3, contentSignature: getDocumentContentSignature(second) };
    expect(resolveWordbookSourceBlock([first, second], saved)?.id).toBe("second");
    expect(resolveWordbookSourceBlock([first, { ...second, id: "reparsed" }], saved)?.id).toBe("reparsed");
    expect(resolveWordbookSourceBlock([{ ...first, text: "Changed." }, { ...second, id: "new", pageNumber: 4 }], saved)?.id).toBe("new");
    expect(resolveWordbookSourceBlock([first, { ...second, id: "changed", pageNumber: 1 }], saved)).toBeNull();
    expect(resolveWordbookSourceBlock([{ ...second, text: "Changed." }], saved)).toBeNull();
  });
  it("deduplicates spelling variants without losing sources or mastery", () => {
    const first = addWordbookTerm([], term, source);
    first[0].mastered = true;
    const second = addWordbookTerm(first, { ...term, term: "CROSS VALIDATION" }, source);
    expect(second).toHaveLength(1);
    expect(second[0].sources).toHaveLength(1);
    expect(second[0].mastered).toBe(true);
    const repeatedParagraph = addWordbookTerm(second, term, { ...source, blockId: "b2" });
    expect(repeatedParagraph[0].sources).toHaveLength(2);
    const third = addWordbookTerm(second, term, { ...source, paperId: "paper2", paperTitle: "Second Paper" });
    expect(third[0].sources).toHaveLength(2);
    expect(first[0].sources).toHaveLength(1);
    expect(academicTermKey(" cross–validation ")).toBe(academicTermKey(term.term));
  });

  it("validates persisted data without accepting broken entries", () => {
    const entries = addWordbookTerm([], term, source);
    expect(parseWordbook(JSON.stringify(entries))).toEqual(entries);
    expect(() => parseWordbook("not json")).toThrow();
    expect(() => parseWordbook(JSON.stringify([{ ...entries[0], id: "different" }]))).toThrow();
    expect(() => parseWordbook(JSON.stringify([{ ...entries[0], sources: [{ ...source, pageNumber: -1 }] }]))).toThrow();
  });
});
