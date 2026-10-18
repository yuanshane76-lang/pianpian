const { arxivPdfUrl, isCanonicalArxivPdfUrl, normalizeArxivId } = require("./arxiv.cjs");

const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function responseHeader(response, name) {
  return typeof response?.headers?.get === "function" ? response.headers.get(name) : undefined;
}

function timeoutSignal(signal, milliseconds) {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readResponseBytes(response) {
  const length = Number.parseInt(responseHeader(response, "content-length") || "", 10);
  if (Number.isFinite(length) && length > MAX_PDF_BYTES) throw new Error("PDF 下载超过 100 MB 限制");
  const contentType = responseHeader(response, "content-type");
  if (contentType && !/^application\/pdf(?:\s*;|$)/i.test(contentType.trim())) {
    throw new Error("下载结果不是 PDF");
  }

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value);
        total += chunk.byteLength;
        if (total > MAX_PDF_BYTES) throw new Error("PDF 下载超过 100 MB 限制");
        chunks.push(chunk);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
  }

  if (typeof response.arrayBuffer !== "function") throw new Error("下载结果无法读取");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_PDF_BYTES) throw new Error("PDF 下载超过 100 MB 限制");
  return bytes;
}

async function downloadArxivPdf({ arxivId, documents, fetchImpl = globalThis.fetch, signal }) {
  const id = normalizeArxivId(arxivId);
  if (!id) throw new Error("arXiv 论文标识无效");
  if (!documents || typeof documents.save !== "function") throw new Error("文档存储不可用");
  if (typeof fetchImpl !== "function") throw new Error("网络请求不可用");

  const requestSignal = timeoutSignal(signal, 120_000);
  let url = arxivPdfUrl(id);
  let response;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    response = await fetchImpl(url, {
      headers: { Accept: "application/pdf" },
      redirect: "manual",
      signal: requestSignal,
    });
    if (response?.status >= 300 && response.status < 400) {
      const location = responseHeader(response, "location");
      if (!location || !isCanonicalArxivPdfUrl(new URL(location, url).href, id)) {
        throw new Error("PDF 下载重定向不在 arXiv 官方地址内");
      }
      if (redirects === MAX_REDIRECTS) throw new Error("PDF 下载重定向次数过多");
      url = new URL(location, url).href;
      continue;
    }
    if (!response?.ok) throw new Error(`PDF 下载失败（HTTP ${response?.status ?? "未知"}）`);
    break;
  }

  const bytes = await readResponseBytes(response);
  if (bytes.length < 8 || !/^%PDF-\d\.\d/.test(bytes.subarray(0, 8).toString("ascii"))) {
    throw new Error("下载结果不是有效 PDF");
  }
  const saved = await documents.save({ name: `${id.replaceAll("/", "-")}.pdf`, data: bytes });
  return saved;
}

module.exports = { MAX_PDF_BYTES, downloadArxivPdf };
