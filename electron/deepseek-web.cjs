const DEFAULT_BASE_URL = "https://api.deepseek.com";
const MAX_QUERY_LENGTH = 128;
const MAX_ORIGINAL_QUESTION_LENGTH = 128;
const MAX_FETCH_URL_LENGTH = 8192;
const MAX_SEARCH_RESULTS = 50;
const MAX_TOOL_RESULT_CHARS = 80_000;
const MAX_SEARCH_CONTENT_CHARS = 12_000;
const MAX_FETCH_CONTENT_CHARS = 60_000;
const MAX_RESPONSE_BYTES = 512_000;
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_RETRIES = 2;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function text(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function resolveBaseUrl(value) {
  const source = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_BASE_URL;
  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error("DeepSeek 服务地址无效");
  }
  if (url.protocol !== "https:" || url.hostname !== "api.deepseek.com"
    || url.username || url.password || url.search || url.hash) {
    throw new Error("DeepSeek 原生搜索仅允许使用官方 HTTPS 服务地址");
  }
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  return url.href.replace(/\/$/, "");
}

function normalizeWebUrl(value, max = MAX_FETCH_URL_LENGTH) {
  const source = text(value, max);
  if (!source) throw new Error("网页地址无效");
  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error("网页地址无效");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error("网页地址必须是 HTTP 或 HTTPS，且不能包含账号信息");
  }
  return url.href;
}

function clip(value, max) {
  const content = typeof value === "string" ? value : "";
  return { value: content.slice(0, max), truncated: content.length > max };
}

function normalizeSearchResult(value) {
  if (!value || typeof value !== "object") return null;
  const title = text(value.title, 500);
  let url;
  try { url = normalizeWebUrl(value.url, MAX_FETCH_URL_LENGTH); } catch { return null; }
  if (!title || !url) return null;
  const snippet = text(value.snippet, 2_000);
  const summary = text(value.summary, 8_000);
  const content = clip(value.content, MAX_SEARCH_CONTENT_CHARS);
  return {
    title,
    url,
    ...(snippet ? { snippet } : {}),
    ...(summary ? { summary } : {}),
    ...(content.value ? { content: content.value } : {}),
    ...(text(value.site_name, 200) ? { siteName: text(value.site_name, 200) } : {}),
    ...(text(value.site_icon, 2_000) ? { siteIcon: text(value.site_icon, 2_000) } : {}),
    ...(text(value.date, 100) ? { date: text(value.date, 100) } : {}),
    ...(Number.isFinite(value.rerank_score) ? { rerankScore: value.rerank_score } : {}),
    ...(Number.isFinite(value.authority) ? { authority: value.authority } : {}),
    _truncated: content.truncated,
  };
}

function removeInternalFields(result) {
  const { _truncated: truncated, ...publicResult } = result;
  return { result: publicResult, truncated };
}

function resolveTimeout(value) {
  return Number.isFinite(value) && value > 0 ? Math.min(value, 120_000) : DEFAULT_TIMEOUT_MS;
}

function abortError() {
  return new DOMException("请求已取消", "AbortError");
}

function sleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);
    const cancel = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(abortError());
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

async function readBoundedText(response) {
  if (!response.body?.getReader) {
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("DeepSeek 原生搜索响应过大");
    }
    return raw;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value?.byteLength || 0;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("DeepSeek 原生搜索响应过大");
      }
      chunks.push(decoder.decode(next.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

async function requestTool({ service, path, body, fetchImpl = globalThis.fetch, signal }) {
  if (typeof fetchImpl !== "function") throw new Error("DeepSeek 原生搜索不可用");
  const apiKey = typeof service?.apiKey === "string" ? service.apiKey.trim() : "";
  if (!apiKey) throw new Error("DeepSeek 原生搜索缺少 API Key");
  const timeoutMs = resolveTimeout(service?.searchTimeoutMs);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await fetchImpl(`${resolveBaseUrl(service.baseUrl)}/v1/tools/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await readBoundedText(response);
      let payload;
      try { payload = raw ? JSON.parse(raw) : {}; } catch {
        throw new Error("DeepSeek 原生搜索返回格式无效");
      }
      if (!response.ok) {
        const message = text(payload?.error?.message, 500);
        if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
          await sleep(Math.min(1_000, 100 * (2 ** attempt)), signal);
          continue;
        }
        throw new Error(`DeepSeek 原生${path === "search" ? "搜索" : "网页读取"}失败（HTTP ${response.status}）${message ? `：${message}` : ""}`);
      }
      if (!payload || typeof payload !== "object") throw new Error("DeepSeek 原生搜索返回格式无效");
      return payload;
    } catch (error) {
      if (timedOut) throw new Error("DeepSeek 原生搜索请求超时，请重试");
      if (signal?.aborted) throw abortError();
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  throw new Error("DeepSeek 原生搜索失败，请重试");
}

async function searchDeepSeekWeb({ service, query, count = 10, originalQuestion, needContent = false, fetchImpl, signal }) {
  const normalizedQuery = text(query, MAX_QUERY_LENGTH);
  if (!normalizedQuery) throw new Error("联网搜索关键词无效");
  if (!Number.isInteger(count) || count < 1 || count > MAX_SEARCH_RESULTS) {
    throw new Error(`联网搜索结果数量必须在 1 到 ${MAX_SEARCH_RESULTS} 之间`);
  }
  const body = {
    query: normalizedQuery,
    count,
    ...(text(originalQuestion, MAX_ORIGINAL_QUESTION_LENGTH) ? { ori_question: text(originalQuestion, MAX_ORIGINAL_QUESTION_LENGTH) } : {}),
    ...(needContent === true ? { need_content: true } : {}),
  };
  const payload = await requestTool({ service, path: "search", body, fetchImpl, signal });
  if (!Array.isArray(payload.results)) throw new Error("DeepSeek 原生搜索响应格式无效：缺少 results");
  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  const results = [];
  let totalChars = 0;
  let truncated = false;
  for (const item of rawResults.slice(0, MAX_SEARCH_RESULTS)) {
    const normalized = normalizeSearchResult(item);
    if (!normalized) continue;
    const { result, truncated: resultTruncated } = removeInternalFields(normalized);
    const size = JSON.stringify(result).length;
    if (totalChars + size > MAX_TOOL_RESULT_CHARS) {
      truncated = true;
      break;
    }
    totalChars += size;
    results.push(result);
    truncated ||= resultTruncated;
  }
  return {
    source: "DeepSeek Search",
    query: normalizedQuery,
    results,
    totalResults: rawResults.length,
    ...(truncated || results.length < rawResults.length ? { truncated: true } : {}),
  };
}

async function fetchDeepSeekWeb({ service, url, fetchImpl, signal }) {
  const normalizedUrl = normalizeWebUrl(url);
  const payload = await requestTool({ service, path: "fetch", body: { url: normalizedUrl }, fetchImpl, signal });
  const title = text(payload.title, 500);
  const content = clip(payload.content, MAX_FETCH_CONTENT_CHARS);
  if (!content.value) throw new Error("DeepSeek 未返回可用网页内容");
  return {
    source: "DeepSeek Fetch",
    url: normalizedUrl,
    title,
    content: content.value,
    ...(content.truncated ? { truncated: true } : {}),
  };
}

module.exports = {
  fetchDeepSeekWeb,
  normalizeWebUrl,
  searchDeepSeekWeb,
};
