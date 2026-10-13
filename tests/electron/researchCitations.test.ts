import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { resolveMessageCitations } = require("../../electron/research-citations.cjs");
describe("source-grounded research citations", () => {
  const evidence = new Map([["p001-b001", { paperId: "p", blockId: "p001-b001", pageNumber: 1, label: "第 1 页" }]]);
  it("resolves only actually read blocks and deduplicates repeated citations", () => {
    expect(resolveMessageCitations("依据[引用:p001-b001]，再次[引用:p001-b001]，无依据[引用:fake]。", evidence))
      .toEqual([{ paperId: "p", blockId: "p001-b001", pageNumber: 1, label: "第 1 页" }]);
  });
  it("does not turn page-only, partial, or untrusted markers into guessed citations", () => {
    expect(resolveMessageCitations("[第 1 页] [引用:p001-b0] [引用:../../secret]", evidence)).toEqual([]);
  });
});
