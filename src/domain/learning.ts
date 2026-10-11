import { parse, Allow } from "partial-json";

export interface ParagraphInsight { summary: string; role: string }
export interface ReadingGuide { overview: string; terms: Array<{ term: string; translation: string; definition: string }> }
export interface ChartReading { summary: string; encoding: string; findings: string[]; role: string; caveats: string[] }

function parseObject(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new Error("模型返回的结构不完整，请重试"); }
}
function requiredText(value: unknown, maximum = 3000) {
  if (typeof value !== "string" || !value.trim()) throw new Error("模型返回的结构不完整，请重试");
  return value.trim().slice(0, maximum);
}
export function parseParagraphInsight(text: string): ParagraphInsight {
  const value = parseObject(text);
  return { summary: requiredText(value.summary, 1200), role: requiredText(value.role, 1800) };
}
export function previewParagraphInsight(text: string): ParagraphInsight | null {
  try {
    const value = parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""), Allow.STR | Allow.OBJ);
    const summary = typeof value?.summary === "string" ? value.summary.slice(0, 1200) : "";
    const role = typeof value?.role === "string" ? value.role.slice(0, 1800) : "";
    return summary || role ? { summary, role } : null;
  } catch { return null; }
}
export function parseChartReading(text: string): ChartReading {
  const value = parseObject(text);
  function textList(list: unknown): string[] {
    if (!Array.isArray(list) || !list.length) throw new Error("模型返回的结构不完整，请重试");
    return list.slice(0, 6).map((item) => requiredText(item, 1000));
  }
  return { summary: requiredText(value.summary, 1200), encoding: requiredText(value.encoding, 1800),
    findings: textList(value.findings), role: requiredText(value.role, 1800), caveats: textList(value.caveats) };
}
export function previewChartReading(text: string): ChartReading | null {
  try {
    const value = parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""), Allow.STR | Allow.OBJ | Allow.ARR);
    const field = (key: string, maximum: number) => typeof value?.[key] === "string" ? value[key].slice(0, maximum) : "";
    const list = (key: string) => Array.isArray(value?.[key])
      ? value[key].filter((item: unknown) => typeof item === "string" && item.trim()).slice(0, 6)
        .map((item: string) => item.slice(0, 1000)) : [];
    const reading: ChartReading = {
      summary: field("summary", 1200), encoding: field("encoding", 1800),
      findings: list("findings"), role: field("role", 1800), caveats: list("caveats"),
    };
    return reading.summary || reading.encoding || reading.findings.length || reading.role || reading.caveats.length ? reading : null;
  } catch { return null; }
}
export function parseReadingGuide(text: string): ReadingGuide {
  const value = parseObject(text);
  if (!Array.isArray(value.terms)) throw new Error("模型返回的结构不完整，请重试");
  const terms = value.terms.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const term = item as Record<string, unknown>;
    if (typeof term.term !== "string" || !term.term.trim() || typeof term.translation !== "string" || !term.translation.trim()) return [];
    return [{ term: term.term.trim().slice(0, 100), translation: term.translation.trim().slice(0, 160),
      definition: typeof term.definition === "string" ? term.definition.trim().slice(0, 500) : "" }];
  }).slice(0, 12);
  return { overview: requiredText(value.overview, 5000), terms };
}
