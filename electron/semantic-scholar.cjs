/**
 * Semantic Scholar reader for the paper radar.
 *
 * This adapter performs recall only: it resolves a seed paper and returns
 * public metadata candidates. It never calls a model and never downloads full text.
 * The free pool is aggressively rate limited, so all traffic is serialized,
 * retried on 429 and cached per seed.
 */

const API_HOST = "api.semanticscholar.org";
const API_ORIGIN = `https://${API_HOST}`;
const GRAPH_FIELDS = "title,year,venue,abstract,authors,externalIds,citationCount,publicationDate";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_RECOMMENDATIONS = 100;
const DEFAULT_RECOMMENDATIONS = 50;
const REQUEST_TIMEOUT_MS = 25000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 1100;
const RETRY_LIMIT = 2;
const RETRY_DELAY_MS = 2500;
const MAX_SEED_TITLE = 500;

const REACHABILITY = "Semantic Scholar 免费接口当前不可用，请稍后重试。";

function fail(message) {
  const error = new Error(message);
  error.userMessage = message;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDoi(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim()
    .toLocaleLowerCase();
}

function normalizeTitle(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function titleSimilarity(left, right) {
  const a = new Set(normalizeTitle(left).split(" ").filter(Boolean));
  const b = new Set(normalizeTitle(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function buildUrl(pathname, params) {
  const url = new URL(pathname, API_ORIGIN);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  if (url.origin !== API_ORIGIN || url.hostname !== API_HOST) {
    throw fail("文献检索地址不允许访问。");
  }
  return url.toString();
}

function createClient({ fetchImpl = globalThis.fetch, now = () => Date.now(), sleepImpl = sleep, readApiKey } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is required");
  const cache = new Map();
  let queue = Promise.resolve();
  let lastRequestAt = 0;

  // No key keeps the anonymous shared pool, which is the documented default.
  function requestHeaders() {
    const key = typeof readApiKey === "function" ? readApiKey() : "";
    const trimmed = typeof key === "string" ? key.trim() : "";
    return trimmed
      ? { Accept: "application/json", "x-api-key": trimmed }
      : { Accept: "application/json" };
  }

  function serialize(task) {
    const next = queue.then(async () => {
      const elapsed = now() - lastRequestAt;
      const wait = MIN_REQUEST_INTERVAL_MS - elapsed;
      if (wait > 0) await sleepImpl(wait);
      lastRequestAt = now();
      return task();
    });
    queue = next.then(() => undefined, () => undefined);
    return next;
  }

  async function readJson(response) {
    let payload;
    try {
      payload = await response.text();
    } catch {
      throw fail(REACHABILITY);
    }
    if (payload.length > MAX_RESPONSE_BYTES) throw fail("检索结果过大，已停止读取。");
    try {
      return JSON.parse(payload);
    } catch {
      throw fail(REACHABILITY);
    }
  }

  async function requestOnce(url, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const headers = requestHeaders();
    try {
      const response = await fetchImpl(url, {
        headers,
        signal: controller.signal,
      });
      if (response.status === 429) {
        const error = fail(headers["x-api-key"]
          ? "Semantic Scholar 请求过于频繁，请稍后重试。"
          : "Semantic Scholar 免费接口限流，请稍后重试。");
        error.retryable = true;
        throw error;
      }
      if (response.status === 401 || response.status === 403) {
        throw fail("Semantic Scholar 密钥无效或已过期，请在服务配置中检查。");
      }
      if (response.status === 404) throw fail("没有找到这篇论文的外部记录。");
      if (!response.ok) throw fail(`文献检索失败（HTTP ${response.status}）。`);
      return await readJson(response);
    } catch (cause) {
      if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
      if (cause?.userMessage) throw cause;
      if (controller.signal.aborted) throw fail("文献检索超时，请稍后重试。");
      throw fail(REACHABILITY);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async function request(url, signal) {
    let attempt = 0;
    for (;;) {
      try {
        return await serialize(() => requestOnce(url, signal));
      } catch (cause) {
        if (cause?.name === "AbortError") throw cause;
        if (!cause?.retryable || attempt >= RETRY_LIMIT) throw cause;
        attempt += 1;
        await sleepImpl(RETRY_DELAY_MS * attempt);
      }
    }
  }

  function toCandidate(entry) {
    return {
      title: entry?.title,
      authors: Array.isArray(entry?.authors) ? entry.authors.map((author) => author?.name) : [],
      year: entry?.year,
      venue: entry?.venue,
      doi: entry?.externalIds?.DOI,
      url: entry?.url,
      abstract: entry?.abstract,
      citationCount: entry?.citationCount,
      source: "Semantic Scholar",
    };
  }

  async function resolveSeedByTitle(title, signal) {
    const query = String(title ?? "").trim().slice(0, MAX_SEED_TITLE);
    if (!query) throw fail("这篇论文缺少标题，无法检索相似工作。");
    const payload = await request(
      buildUrl("/graph/v1/paper/search", { query, limit: 5, fields: GRAPH_FIELDS }),
      signal,
    );
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    if (!rows.length) throw fail("没有找到这篇论文的外部记录，请检查标题或补充 DOI。");
    const scored = rows
      .map((entry) => ({ entry, score: titleSimilarity(entry?.title, query) }))
      .sort((left, right) => right.score - left.score);
    if (scored[0].score < 0.75) {
      throw fail("无法确认这篇论文的外部记录，请在文献信息中补充 DOI 后重试。");
    }
    return scored[0].entry;
  }

  async function recommend(paperId, limit, signal) {
    const payload = await request(
      buildUrl(`/recommendations/v1/papers/forpaper/${encodeURIComponent(paperId)}`, {
        limit,
        fields: GRAPH_FIELDS,
      }),
      signal,
    );
    const rows = Array.isArray(payload?.recommendedPapers) ? payload.recommendedPapers : [];
    return rows.map(toCandidate);
  }

  async function findRelatedPapers({ seed, limit, signal } = {}) {
    const requested = Number.isInteger(limit)
      ? Math.min(Math.max(limit, 1), MAX_RECOMMENDATIONS)
      : DEFAULT_RECOMMENDATIONS;
    const doi = normalizeDoi(seed?.doi);
    const title = String(seed?.title ?? "").trim();
    if (!doi && !title) throw fail("这篇论文缺少标题和 DOI，无法检索相似工作。");

    const cacheKey = `${doi || normalizeTitle(title)}::${requested}`;
    const cached = cache.get(cacheKey);
    if (cached && now() - cached.at < CACHE_TTL_MS) {
      return { ...cached.value, cached: true };
    }

    let resolved = null;
    let candidates = [];
    if (doi) {
      try {
        candidates = await recommend(`DOI:${doi}`, requested, signal);
      } catch (cause) {
        if (cause?.name === "AbortError" || !/外部记录/.test(String(cause?.userMessage ?? ""))) throw cause;
      }
    }
    if (!candidates.length) {
      resolved = await resolveSeedByTitle(title, signal);
      if (!resolved?.paperId) throw fail("没有找到这篇论文的外部记录。");
      candidates = await recommend(resolved.paperId, requested, signal);
    }

    const value = {
      seed: {
        paperId: resolved?.paperId ?? undefined,
        doi: normalizeDoi(resolved?.externalIds?.DOI) || doi || undefined,
        title: String(resolved?.title ?? title) || undefined,
      },
      candidates,
      source: "Semantic Scholar",
      fetchedAt: new Date(now()).toISOString(),
      cached: false,
    };
    cache.set(cacheKey, { at: now(), value });
    return value;
  }

  return { findRelatedPapers, clearCache: () => cache.clear(), normalizeTitle, titleSimilarity };
}

module.exports = { createClient, MAX_RECOMMENDATIONS, MAX_RESPONSE_BYTES, normalizeDoi, normalizeTitle };
