import { describe, expect, it } from "vitest";
import { createBlocksFromPlainText } from "../../src/services/document";

describe("文档文本转换", () => {
  it("按非空行生成稳定的阅读块", () => {
    const blocks = createBlocksFromPlainText("\n摘要\n\n第一段内容。\n\n第二段内容。\n");

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({
      id: "p001-b001",
      kind: "heading",
      text: "摘要",
    });
    expect(blocks[2]?.order).toBe(2);
  });
});
