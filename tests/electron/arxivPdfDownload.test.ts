// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const roots: string[] = [];
const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

async function createDocuments() {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "zhiyan-arxiv-"));
  roots.push(rootDirectory);
  const { createDocumentStore } = require("../../electron/document-store.cjs");
  return { rootDirectory, documents: createDocumentStore({ rootDirectory }) };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("arXiv PDF downloader", () => {
  it("stores a validated PDF from the canonical arXiv URL", async () => {
    const { rootDirectory, documents } = await createDocuments();
    const fetchImpl = vi.fn(async () => new Response(pdf, {
      headers: { "content-type": "application/pdf", "content-length": String(pdf.length) },
    }));
    const { downloadArxivPdf } = require("../../electron/arxiv-pdf-download.cjs");

    const result = await downloadArxivPdf({ arxivId: "1706.03762v7", documents, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith("https://arxiv.org/pdf/1706.03762v7", expect.objectContaining({ redirect: "manual" }));
    expect(Buffer.from(await documents.read(result.id))).toEqual(pdf);
    expect(await readFile(path.join(rootDirectory, result.id, "original.pdf"))).toEqual(pdf);
    expect(result).toMatchObject({ name: "1706.03762v7.pdf", duplicate: false });
    expect(Object.keys(result).sort()).toEqual(["duplicate", "id", "name"]);
  });

  it("rejects invalid arXiv IDs before making a request", async () => {
    const { documents } = await createDocuments();
    const fetchImpl = vi.fn();
    const { downloadArxivPdf } = require("../../electron/arxiv-pdf-download.cjs");

    await expect(downloadArxivPdf({ arxivId: "https://attacker.example/paper.pdf", documents, fetchImpl }))
      .rejects.toThrow("arXiv");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects redirects outside the canonical arXiv PDF path", async () => {
    const { documents } = await createDocuments();
    const { downloadArxivPdf } = require("../../electron/arxiv-pdf-download.cjs");

    for (const location of [
      "https://attacker.example/paper.pdf",
      "https://arxiv.org:8443/pdf/1706.03762",
      "https://user@arxiv.org/pdf/1706.03762",
    ]) {
      const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
      await expect(downloadArxivPdf({ arxivId: "1706.03762", documents, fetchImpl })).rejects.toThrow("重定向");
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

  it("follows only HTTPS redirects to the same canonical arXiv PDF and checks the PDF signature", async () => {
    const { documents } = await createDocuments();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://arxiv.org/pdf/1706.03762" } }))
      .mockResolvedValueOnce(new Response(pdf, { headers: { "content-type": "application/pdf" } }));
    const { downloadArxivPdf } = require("../../electron/arxiv-pdf-download.cjs");

    await expect(downloadArxivPdf({ arxivId: "1706.03762", documents, fetchImpl })).resolves.toMatchObject({ duplicate: false });
    expect(fetchImpl.mock.calls.map((call: any[]) => call[0])).toEqual([
      "https://arxiv.org/pdf/1706.03762",
      "https://arxiv.org/pdf/1706.03762",
    ]);
    await expect(downloadArxivPdf({
      arxivId: "1706.03763", documents,
      fetchImpl: async () => new Response("not a PDF", { headers: { "content-type": "application/pdf" } }),
    })).rejects.toThrow("有效 PDF");
  });

  it("does not persist an HTML or oversized response as a PDF", async () => {
    const { rootDirectory, documents } = await createDocuments();
    const { downloadArxivPdf } = require("../../electron/arxiv-pdf-download.cjs");
    await expect(downloadArxivPdf({
      arxivId: "1706.03762", documents,
      fetchImpl: async () => new Response("<html>blocked</html>", { headers: { "content-type": "text/html" } }),
    })).rejects.toThrow("PDF");
    await expect(downloadArxivPdf({
      arxivId: "1706.03762", documents,
      fetchImpl: async () => new Response(null, { headers: { "content-type": "application/pdf", "content-length": "104857601" } }),
    })).rejects.toThrow("100 MB");
    expect(await import("node:fs/promises").then(({ readdir }) => readdir(rootDirectory))).toEqual([]);
  });

  it("bounds streamed bytes even without a content length", async () => {
    const { downloadArxivPdf, MAX_PDF_BYTES } = require("../../electron/arxiv-pdf-download.cjs");
    const chunk = new Uint8Array(1024 * 1024);
    const cancelled = vi.fn();
    let total = 0;
    const body = new ReadableStream({
      pull(controller) { total += chunk.length; controller.enqueue(chunk); },
      cancel: cancelled,
    });
    const documents = { save: vi.fn() };
    await expect(downloadArxivPdf({
      arxivId: "1706.03762v7", documents,
      fetchImpl: async () => new Response(body, { headers: { "content-type": "application/pdf" } }),
    })).rejects.toThrow("100 MB");
    expect(total).toBeGreaterThan(MAX_PDF_BYTES);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(documents.save).not.toHaveBeenCalled();
  });

  it.each(["timeout", "cancel"])("does not persist partial data after %s", async (reason) => {
    const { downloadArxivPdf } = require("../../electron/arxiv-pdf-download.cjs");
    const controller = new AbortController();
    const timeout = reason === "timeout" ? vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal) : null;
    const documents = { save: vi.fn() };
    const fetchImpl = vi.fn(async (_url, options) => new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(pdf.subarray(0, 8));
        options.signal.addEventListener("abort", () => stream.error(options.signal.reason), { once: true });
      },
    }), { headers: { "content-type": "application/pdf" } }));
    try {
      const request = downloadArxivPdf({
        arxivId: "1706.03762v7", documents, fetchImpl,
        ...(reason === "cancel" ? { signal: controller.signal } : {}),
      });
      const rejection = expect(request).rejects.toThrow("下载已终止");
      controller.abort(new Error("下载已终止"));
      await rejection;
      if (timeout) expect(timeout).toHaveBeenCalledWith(120_000);
      expect(documents.save).not.toHaveBeenCalled();
    } finally {
      timeout?.mockRestore();
    }
  });
});
