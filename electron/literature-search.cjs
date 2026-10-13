const CROSSREF_URL = "https://api.crossref.org/works";

function cleanText(value, max = 4000) {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeAuthors(authors) {
  if (!Array.isArray(authors)) return [];
  return authors.slice(0, 20).map((author) => {
    const given = cleanText(author?.given, 120);
    const family = cleanText(author?.family, 120);
    return [given, family].filter(Boolean).join(" ");
  }).filter(Boolean);
}

function extractYear(item) {
  const parts = item?.published?.["date-parts"]?.[0];
  return Array.isArray(parts) && Number.isInteger(parts[0]) ? parts[0] : null;
}

function normalizeWork(item) {
  const title = Array.isArray(item?.title) ? cleanText(item.title[0], 500) : cleanText(item?.title, 500);
  const doi = cleanText(item?.DOI, 500);
  const landingUrl = cleanText(item?.URL, 2000) || (doi ? `https://doi.org/${doi}` : "");
  return {
    title: title || "未命名论文",
    authors: normalizeAuthors(item?.author),
    year: extractYear(item),
    doi: doi || undefined,
    landingUrl: landingUrl || undefined,
    abstract: cleanText(item?.abstract, 4000) || undefined,
    source: "Crossref",
  };
}

function isUsablePaper(paper) {
  if (!paper.title || /^(?:figure|table|supplement(?:ary)?|appendix)\b/i.test(paper.title)) return false;
  return Boolean(paper.doi || paper.authors.length || paper.year);
}

async function searchLiterature(input, fetchImpl = globalThis.fetch, signal) {
  const query = typeof input?.query === "string" ? input.query.trim() : "";
  if (!query || query.length > 300) throw new Error("文献检索关键词无效");
  const limit = Number.isInteger(input?.limit) ? Math.min(Math.max(input.limit, 1), 10) : 5;
  const params = new URLSearchParams({ query, rows: String(limit), select: "DOI,title,author,published,URL,abstract" });
  const response = await fetchImpl(`${CROSSREF_URL}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
  });
  if (!response?.ok) throw new Error(`文献检索失败（HTTP ${response?.status ?? "未知"}）`);
  const payload = await response.json();
  const items = Array.isArray(payload?.message?.items) ? payload.message.items : [];
  const unique = new Map();
  for (const item of items.slice(0, limit)) {
    const paper = normalizeWork(item);
    if (!isUsablePaper(paper)) continue;
    const identity = paper.doi?.toLocaleLowerCase() || paper.title.toLocaleLowerCase();
    if (!unique.has(identity)) unique.set(identity, paper);
  }
  return {
    query,
    source: "Crossref",
    papers: [...unique.values()],
  };
}

module.exports = { searchLiterature, normalizeWork, isUsablePaper };
