const ARXIV_ID_PATTERN = /^(?:\d{4}\.\d{4,5}|[a-z][a-z-]*(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i;

function normalizeArxivId(value) {
  if (typeof value !== "string") return "";
  const id = value.trim().replace(/^arxiv:/i, "");
  return ARXIV_ID_PATTERN.test(id) ? id : "";
}

function arxivAbsUrl(arxivId) {
  const id = normalizeArxivId(arxivId);
  if (!id) throw new Error("arXiv 论文标识无效");
  return `https://arxiv.org/abs/${id}`;
}

function arxivPdfUrl(arxivId) {
  const id = normalizeArxivId(arxivId);
  if (!id) throw new Error("arXiv 论文标识无效");
  return `https://arxiv.org/pdf/${id}`;
}

function isCanonicalArxivPdfUrl(value, arxivId) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const id = normalizeArxivId(arxivId);
  if (!id || url.protocol !== "https:" || url.hostname.toLocaleLowerCase() !== "arxiv.org"
    || url.port || url.username || url.password || url.search || url.hash) return false;
  const expected = `/pdf/${id}`;
  try {
    const path = decodeURIComponent(url.pathname);
    return path === expected || path === `${expected}.pdf`;
  } catch {
    return false;
  }
}

module.exports = { ARXIV_ID_PATTERN, normalizeArxivId, arxivAbsUrl, arxivPdfUrl, isCanonicalArxivPdfUrl };
