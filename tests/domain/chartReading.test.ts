import { describe, expect, it } from "vitest";
import { parseChartReading } from "../../src/domain/learning";
import { getDocumentVisualSignature } from "../../src/domain/documentBlocks";

const result = { summary: "摘要", encoding: "列是模型，分数越高越好", findings: ["模型 A 优于 B"], role: "实验支持", caveats: ["范围有限"] };
describe("chart reading output and identity", () => {
  it("parses bounded structured chart findings and refuses partial results", () => {
    expect(parseChartReading(`\`\`\`json\n${JSON.stringify(result)}\n\`\`\``)).toEqual(result);
    expect(() => parseChartReading('{"summary":"partial"}')).toThrow("结构不完整");
    expect(() => parseChartReading(JSON.stringify({ ...result, findings: [] }))).toThrow("结构不完整");
  });
  it("invalidates cached analysis when captions, images or crop coordinates change", () => {
    const block = { id: "b1", kind: "table" as const, order: 0, pageNumber: 1, text: "A 1", caption: "Table 1", assetPath: "images/1.png", bbox: [0, 0, .5, .5] as [number, number, number, number] };
    for (const change of [{ caption: "New table" }, { assetPath: "images/2.png" }, { bbox: [0, 0, .7, .7] as [number, number, number, number] }]) {
      expect(getDocumentVisualSignature({ ...block, ...change })).not.toBe(getDocumentVisualSignature(block));
    }
  });
});
