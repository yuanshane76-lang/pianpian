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
export function parseChartReading(text: string): ChartReading {
  const value = parseObject(text);
  function textList(list: unknown): string[] {
    if (!Array.isArray(list) || !list.length) throw new Error("模型返回的结构不完整，请重试");
    return list.slice(0, 6).map((item) => requiredText(item, 1000));
  }
  return { summary: requiredText(value.summary, 1200), encoding: requiredText(value.encoding, 1800),
    findings: textList(value.findings), role: requiredText(value.role, 1800), caveats: textList(value.caveats) };
}
export function parseReadingGuide(text: string): ReadingGuide {
  const value = parseObject(text);
  const terms = Array.isArray(value.terms) ? value.terms.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const term = item as Record<string, unknown>;
    if (typeof term.term !== "string" || !term.term.trim() || typeof term.translation !== "string" || !term.translation.trim()) return [];
    return [{ term: term.term.trim().slice(0, 100), translation: term.translation.trim().slice(0, 160),
      definition: typeof term.definition === "string" ? term.definition.trim().slice(0, 500) : "" }];
  }).slice(0, 12) : [];
  return { overview: requiredText(value.overview, 5000), terms };
}
