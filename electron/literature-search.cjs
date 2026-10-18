const { DOMParser } = require("@xmldom/xmldom");
const { arxivAbsUrl, arxivPdfUrl, normalizeArxivId } = require("./arxiv.cjs");

const CROSSREF_URL = "https://api.crossref.org/works";
const ARXIV_API_URL = "https://export.arxiv.org/api/query";

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

function normalizeTitle(value) {
  return cleanText(value, 500).replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function elementText(parent, name) {
  const node = parent?.getElementsByTagName(name)?.[0];
  return cleanText(node?.textContent, 4000);
}

function parseArxivFeed(xml) {
  if (typeof xml !== "string" || /<!doctype|<!entity/i.test(xml)) throw new Error("arXiv 返回内容无效");
  const document = new DOMParser({
    onError: (level, message) => {
      if (level === "error" || level === "fatalError") throw new Error(`arXiv XML 无效：${message}`);
    },
  }).parseFromString(xml, "application/xml");
  const entries = Array.from(document.getElementsByTagName("entry"));
  return entries.map((entry) => {
    const rawId = elementText(entry, "id");
    const arxivId = normalizeArxivId(rawId.replace(/^https?:\/\/arxiv\.org\/abs\//i, "").replace(/\.pdf$/i, ""));
    if (!arxivId) return null;
    const title = elementText(entry, "title");
    const summary = elementText(entry, "summary");
    const authors = Array.from(entry.getElementsByTagName("author"))
      .slice(0, 20).map((author) => elementText(author, "name")).filter(Boolean);
    const published = elementText(entry, "published");
    const year = Number.parseInt(published.slice(0, 4), 10);
    return {
      title: title || "未命名论文",
      authors,
      year: Number.isInteger(year) ? year : null,
      landingUrl: arxivAbsUrl(arxivId),
      pdfUrl: arxivPdfUrl(arxivId),
      abstract: summary || undefined,
      arxivId,
      source: "arXiv",
    };
  }).filter(Boolean);
}

async function fetchCrossref(query, limit, fetchImpl, signal) {
  const params = new URLSearchParams({ query, rows: String(limit), select: "DOI,title,author,published,URL,abstract" });
  const response = await fetchImpl(`${CROSSREF_URL}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
  });
  if (!response?.ok) throw new Error(`文献检索失败（HTTP ${response?.status ?? "未知"}）`);
  const payload = await response.json();
  const items = Array.isArray(payload?.message?.items) ? payload.message.items : [];
  return items.slice(0, limit).map(normalizeWork).filter(isUsablePaper);
}

async function fetchArxiv(query, limit, fetchImpl, signal) {
  const exactQuery = query.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  const params = new URLSearchParams({ search_query: `all:"${exactQuery}"`, start: "0", max_results: String(limit) });
  const response = await fetchImpl(`${ARXIV_API_URL}?${params.toString()}`, {
    headers: { Accept: "application/atom+xml, application/xml" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
  });
  if (!response?.ok) throw new Error(`arXiv 检索失败（HTTP ${response?.status ?? "未知"}）`);
  const length = Number.parseInt(response.headers?.get?.("content-length") || "", 10);
  if (Number.isFinite(length) && length > 5 * 1024 * 1024) throw new Error("arXiv 检索结果过大");
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > 5 * 1024 * 1024) throw new Error("arXiv 检索结果过大");
        chunks.push(Buffer.from(next.value));
      }
    } finally {
      reader.releaseLock();
    }
    return parseArxivFeed(Buffer.concat(chunks, total).toString("utf8"));
  }
  const xml = typeof response.text === "function" ? await response.text() : "";
  if (Buffer.byteLength(xml, "utf8") > 5 * 1024 * 1024) throw new Error("arXiv 检索结果过大");
  return parseArxivFeed(xml);
}

function isUsablePaper(paper) {
  if (!paper.title || /^(?:figure|table|supplement(?:ary)?|appendix)\b/i.test(paper.title)) return false;
  return Boolean(paper.arxivId || paper.doi || paper.authors.length || paper.year);
}

async function searchLiterature(input, fetchImpl = globalThis.fetch, signal) {
  const query = typeof input?.query === "string" ? input.query.trim() : "";
  if (!query || query.length > 300) throw new Error("文献检索关键词无效");
  const limit = Number.isInteger(input?.limit) ? Math.min(Math.max(input.limit, 1), 10) : 5;
  const [crossref, arxiv] = await Promise.allSettled([
    fetchCrossref(query, limit, fetchImpl, signal),
    fetchArxiv(query, limit, fetchImpl, signal),
  ]);
  if (crossref.status === "rejected" && arxiv.status === "rejected") {
    throw new Error(`文献检索失败：${crossref.reason?.message || arxiv.reason?.message || "公开来源均不可用"}`);
  }
  const unique = new Map();
  const knownTitles = new Set();
  const papers = [
    ...(arxiv.status === "fulfilled" ? arxiv.value : []),
    ...(crossref.status === "fulfilled" ? crossref.value : []),
  ];
  const queryTitle = normalizeTitle(query);
  papers.sort((left, right) => Number(normalizeTitle(right.title) === queryTitle) - Number(normalizeTitle(left.title) === queryTitle));
  for (const paper of papers) {
    const title = normalizeTitle(paper.title);
    if (knownTitles.has(title)) continue;
    const identity = paper.arxivId?.toLocaleLowerCase()
      || paper.doi?.toLocaleLowerCase()
      || title;
    if (!unique.has(identity)) unique.set(identity, paper);
    knownTitles.add(title);
  }
  const sources = [
    ...(arxiv.status === "fulfilled" ? ["arXiv"] : []),
    ...(crossref.status === "fulfilled" ? ["Crossref"] : []),
  ];
  const unavailableSources = [
    ...(arxiv.status === "rejected" ? ["arXiv"] : []),
    ...(crossref.status === "rejected" ? ["Crossref"] : []),
  ];
  return {
    query,
    source: sources.join(" + "),
    sources,
    unavailableSources,
    papers: [...unique.values()].slice(0, limit),
  };
}

module.exports = { searchLiterature, normalizeWork, isUsablePaper, parseArxivFeed };
