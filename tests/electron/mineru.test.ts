// @vitest-environment node
import { createRequire } from "node:module";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
type Fetch = typeof fetch;
type NetworkOptions = { fetchImpl?: Fetch; timeoutMs?: number };
type Block = { id: string; kind: "heading" | "paragraph" | "image" | "table" | "equation"; text: string; pageNumber: number; order: number; headingLevel?: number; assetPath?: string; caption?: string; bbox?: [number, number, number, number]; pageWidth?: number; pageHeight?: number };
type Extracted = { result: { blocks: Block[]; title?: string; pageCount?: number }; assets: { path: string; data: Uint8Array }[] };
type Mineru = {
  requestUpload(options: NetworkOptions & { apiKey: string; name: string }): Promise<{ batchId: string; uploadUrl: string }>;
  uploadPdf(options: NetworkOptions & { uploadUrl: string; data: Uint8Array | ArrayBuffer }): Promise<void>;
  getBatch(options: NetworkOptions & { apiKey: string; batchId: string }): Promise<{ state: string; progress: number; error?: string; zipUrl?: string }>;
  downloadResultZip(options: NetworkOptions & { zipUrl: string }): Promise<Uint8Array>;
  extractResultZip(buffer: Uint8Array | ArrayBuffer): Extracted;
};
const mineru = () => require("../../electron/mineru.cjs") as Mineru;
const apiKey = "synthetic-test-token";
const uploadUrl = "https://mineru.oss-cn-shanghai.aliyuncs.com/api-upload/test?signature=synthetic";
const zipUrl = "https://cdn-mineru.openxlab.org.cn/pdf/test.zip";
const pdf = Buffer.from("%PDF-1.7\n%%EOF\n");
const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const asFetch = (fn: (...args: any[]) => any) => fn as Fetch;

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type Entry = { name: string; data: string | Buffer; method?: number; flags?: number; externalAttributes?: number; claimedSize?: number };
function zip(entries: Entry[], comment = "") {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.from(entry.data);
    const method = entry.method ?? 8;
    const compressed = method === 8 ? deflateRawSync(raw) : raw;
    const flags = entry.flags ?? 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    if (!(flags & 8)) {
      local.writeUInt32LE(crc32(raw), 14);
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(entry.claimedSize ?? raw.length, 22);
    }
    local.writeUInt16LE(name.length, 26);
    const descriptor = flags & 8 ? Buffer.alloc(16) : Buffer.alloc(0);
    if (descriptor.length) {
      descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(crc32(raw), 4);
      descriptor.writeUInt32LE(compressed.length, 8);
      descriptor.writeUInt32LE(raw.length, 12);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.claimedSize ?? raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(entry.externalAttributes ?? 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed, descriptor);
    directory.push(central, name);
    offset += local.length + name.length + compressed.length + descriptor.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(Buffer.byteLength(comment), 20);
  return Buffer.concat([...locals, central, end, Buffer.from(comment)]);
}

afterEach(() => vi.useRealTimers());

describe("official MinerU hosted v4 API", () => {
  it("exports only the parent integration functions", () => {
    expect(Object.keys(mineru()).sort()).toEqual(["downloadResultZip", "extractResultZip", "getBatch", "requestUpload", "uploadPdf"]);
  });

  it("requests one local PDF signed URL with the official POST envelope", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 0, data: { batch_id: "batch-1", file_urls: [uploadUrl] } }));
    const result = await mineru().requestUpload({ apiKey, name: "../Paper.pdf", fetchImpl: asFetch(fetchImpl) });
    expect(result).toEqual({ batchId: "batch-1", uploadUrl });
    const [url, options] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://mineru.net/api/v4/file-urls/batch");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" });
    expect(JSON.parse(options.body as string)).toEqual({ files: [{ name: "Paper.pdf" }], model_version: "vlm" });
    expect(options.redirect).toBe("error");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });

  it("PUTs exact PDF bytes without authentication or a Content-Type header", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    await mineru().uploadPdf({ uploadUrl, data: pdf, fetchImpl: asFetch(fetchImpl) });
    const [url, options] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(uploadUrl);
    expect(options.method).toBe("PUT");
    expect(options.headers).toBeUndefined();
    expect(Buffer.from(options.body as Uint8Array)).toEqual(pdf);
  });

  it.each(["waiting-file", "pending", "converting", "running", "done", "failed"])("preserves the %s state and only exposes relevant fields", async (state) => {
    const fetchImpl = asFetch(async () => jsonResponse({
      code: 0,
      data: { batch_id: "batch-1", extract_result: [{
        state, full_zip_url: zipUrl, err_msg: "解析失败",
        extract_progress: { extracted_pages: 2, total_pages: 8 },
      }] },
    }));
    const result = await mineru().getBatch({ apiKey, batchId: "batch-1", fetchImpl });
    expect(result).toEqual({
      state, progress: state === "done" ? 1 : state === "running" ? 0.25 : 0,
      ...(state === "done" ? { zipUrl } : {}),
      ...(state === "failed" ? { error: "MinerU parsing failed." } : {}),
    });
  });

  it("does not call completion while the uploaded file has no task row yet", async () => {
    expect(await mineru().getBatch({ apiKey, batchId: "batch-1", fetchImpl: asFetch(async () => jsonResponse({ code: 0, data: { extract_result: [] } })) }))
      .toEqual({ state: "waiting-file", progress: 0 });
  });

  it.each([
    { extract_progress: { extracted_pages: 100, total_pages: 2 }, expected: 1 },
    { extract_progress: { extracted_pages: -4, total_pages: 2 }, expected: 0 },
    { extract_progress: { extracted_pages: 4, total_pages: 0 }, expected: 0 },
    { extract_progress: undefined, expected: 0 },
  ])("bounds running progress to a finite fraction", async ({ extract_progress, expected }) => {
    const result = await mineru().getBatch({ apiKey, batchId: "batch-1", fetchImpl: asFetch(async () => jsonResponse({ code: 0, data: { extract_result: [{ state: "running", extract_progress }] } })) });
    expect(result.progress).toBe(expected);
  });

  it("rejects unknown states, multiple-document ambiguity, missing ZIP URLs, and invalid response JSON", async () => {
    for (const rows of [[{ state: "new-state" }], [{ state: "done" }], [{ state: "done", full_zip_url: zipUrl }, { state: "running" }]]) {
      await expect(mineru().getBatch({ apiKey, batchId: "batch-1", fetchImpl: asFetch(async () => jsonResponse({ code: 0, data: { extract_result: rows } })) })).rejects.toThrow(/response/i);
    }
    await expect(mineru().requestUpload({ apiKey, name: "paper.pdf", fetchImpl: asFetch(async () => new Response("<html>secret</html>")) })).rejects.toThrow(/response/i);
  });

  it("never echoes keys, signed URLs, or service-provided text in errors", async () => {
    const sensitive = `${apiKey} ${uploadUrl} Bearer other-token`;
    const responses = [
      () => jsonResponse({ code: "A0202", msg: sensitive }),
      () => jsonResponse({ code: -60003, msg: sensitive }),
      () => new Response(sensitive, { status: 500 }),
    ];
    for (const response of responses) {
      const error = await mineru().requestUpload({ apiKey, name: "paper.pdf", fetchImpl: asFetch(async () => response()) }).catch((error: Error) => error);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain(apiKey);
      expect(String(error)).not.toContain("signature");
      expect(String(error)).not.toContain("other-token");
    }
    const failed = await mineru().getBatch({ apiKey, batchId: "batch-1", fetchImpl: asFetch(async () => jsonResponse({ code: 0, data: { extract_result: [{ state: "failed", err_msg: sensitive }] } })) });
    expect(failed.error).toBe("MinerU parsing failed.");
    await expect(mineru().uploadPdf({ uploadUrl, data: pdf, fetchImpl: asFetch(async () => { throw new Error(sensitive); }) })).rejects.toThrow("MinerU network request failed.");
  });

  it("rejects invalid credentials, batch IDs, and untrusted signed hosts before fetching", async () => {
    const fetchImpl = vi.fn();
    await expect(mineru().requestUpload({ apiKey: "", name: "paper.pdf", fetchImpl: asFetch(fetchImpl) })).rejects.toThrow(/key/i);
    await expect(mineru().getBatch({ apiKey, batchId: "../other?token=x", fetchImpl: asFetch(fetchImpl) })).rejects.toThrow(/batch/i);
    for (const url of ["file:///C:/private.pdf", "http://127.0.0.1/test", "https://mineru.net.evil.test/test", "https://user:password@mineru.net/test", "https://mineru.net:444/test", "https://example.com/test"]) {
      await expect(mineru().uploadPdf({ uploadUrl: url, data: pdf, fetchImpl: asFetch(fetchImpl) })).rejects.toThrow(/URL/i);
      await expect(mineru().downloadResultZip({ zipUrl: url, fetchImpl: asFetch(fetchImpl) })).rejects.toThrow(/URL/i);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aborts and times out even when injected fetch never settles", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const promise = mineru().getBatch({
      apiKey, batchId: "batch-1", timeoutMs: 50,
      fetchImpl: asFetch((_url, options) => { signal = options.signal; return new Promise(() => {}); }),
    });
    const outcome = promise.catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(50);
    expect(String(await outcome)).toMatch(/timed out/i);
    expect(signal?.aborted).toBe(true);
  });

  it("covers body consumption with the same timeout", async () => {
    vi.useFakeTimers();
    const promise = mineru().requestUpload({
      apiKey, name: "paper.pdf", timeoutMs: 25,
      fetchImpl: asFetch(async () => ({ ok: true, status: 200, headers: new Headers(), json: () => new Promise(() => {}) })),
    });
    const outcome = promise.catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(String(await outcome)).toMatch(/timed out/i);
  });

  it("downloads a bounded result ZIP without sending the API key", async () => {
    const bytes = zip([{ name: "full.md", data: "# Paper\n\nBody" }]);
    const fetchImpl = vi.fn(async () => new Response(bytes));
    expect(Buffer.from(await mineru().downloadResultZip({ zipUrl, fetchImpl: asFetch(fetchImpl) }))).toEqual(bytes);
    const [, options] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(options.headers).toBeUndefined();
    expect(options.redirect).toBe("error");
    await expect(mineru().downloadResultZip({
      zipUrl, fetchImpl: asFetch(async () => new Response("tiny", { headers: { "Content-Length": String(100 * 1024 * 1024 + 1) } })),
    })).rejects.toThrow(/limit/i);
  });
});

describe("bounded MinerU ZIP extraction", () => {
  it("normalizes nested heading levels without changing stable block identities", () => {
    const rows = [
      { type: "heading", text: "Method", page_idx: 0 },
      { type: "heading", text: "Dataset", page_idx: 0 },
      { type: "heading", text: "Training", page_idx: 0 },
      { type: "heading", text: "Deep heading", page_idx: 0 },
    ];
    const before = mineru().extractResultZip(zip([{ name: "content_list.json", data: JSON.stringify(rows) }])).result;
    const after = mineru().extractResultZip(zip([{ name: "content_list.json", data: JSON.stringify(rows.map((row, index) => ({
      ...row, text_level: [1, "2", 3, 9][index],
    }))) }])).result;
    expect(after.blocks.map((block) => block.headingLevel)).toEqual([1, 2, 3, 6]);
    expect(after.blocks.map((block) => block.id)).toEqual(before.blocks.map((block) => block.id));
  });

  it("prefers content-list blocks, converts page indices, and resolves images relative to metadata", () => {
    const content = [
      { type: "text", text: "Paper title", text_level: 1, page_idx: 0 },
      { type: "text", text: "Actual paragraph", page_idx: 0 },
      { type: "image", img_path: "images/figure.png", image_caption: ["Figure 1", "Details"], page_idx: 1 },
      { type: "table", table_body: "<table><tr><td>A</td></tr></table>", table_caption: ["Table 1"], img_path: "images/table.jpg", page_idx: 1 },
      { type: "equation", text: "E=mc^2", text_format: "latex", page_idx: 2 },
    ];
    const archive = zip([
      { name: "paper/auto/paper_content_list.json", data: JSON.stringify(content) },
      { name: "paper/auto/full.md", data: "# Incorrect fallback" },
      { name: "paper/auto/images/figure.png", data: Buffer.from([1, 2, 3]), method: 0 },
      { name: "paper/auto/images/table.jpg", data: Buffer.from([4, 5]), flags: 0x808 },
      { name: "paper/auto/origin.pdf", data: pdf },
    ], "archive comment");
    const { result, assets } = mineru().extractResultZip(archive);
    expect(result.title).toBe("Paper title");
    expect(result.pageCount).toBe(3);
    expect(result.blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "image", "table", "equation"]);
    expect(result.blocks.map((block) => block.pageNumber)).toEqual([1, 1, 2, 2, 3]);
    expect(result.blocks.map((block) => block.order)).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(result.blocks.map((block) => block.id)).size).toBe(5);
    expect(result.blocks[0].headingLevel).toBe(1);
    expect(result.blocks[1].text).toBe("Actual paragraph");
    expect(result.blocks[2]).toMatchObject({ assetPath: "paper/auto/images/figure.png", caption: "Figure 1\nDetails" });
    expect(result.blocks[3]).toMatchObject({ text: "<table><tr><td>A</td></tr></table>", assetPath: "paper/auto/images/table.jpg", caption: "Table 1" });
    expect(result.blocks[4].text).toBe("E=mc^2");
    expect(assets.map((asset) => asset.path)).toEqual(["paper/auto/images/figure.png", "paper/auto/images/table.jpg"]);
    expect(Buffer.from(assets[0].data)).toEqual(Buffer.from([1, 2, 3]));
    expect(mineru().extractResultZip(archive).result).toEqual(result);
  });

  it("handles plain content_list.json, unknown text blocks, and missing image references without inventing assets", () => {
    const archive = zip([{ name: "content_list.json", data: JSON.stringify([
      { type: "text", text: "First paragraph", page_idx: 4 },
      { type: "list", list_items: ["one", "two"], page_idx: 4 },
      { type: "image", img_path: "images/missing.png", image_caption: ["Figure"], page_idx: 4 },
    ]) }]);
    const { result, assets } = mineru().extractResultZip(archive);
    expect(result.blocks.map((block) => block.text)).toEqual(["First paragraph", "one\ntwo", "Figure"]);
    expect(result.blocks[2].assetPath).toBeUndefined();
    expect(result.title).toBeUndefined();
    expect(result.pageCount).toBe(5);
    expect(assets).toEqual([]);
  });

  it("preserves MinerU page coordinates for PDF-aligned interaction overlays", () => {
    const archive = zip([{ name: "content_list.json", data: JSON.stringify([
      { type: "text", page_idx: 1, text: "A coordinate-aware paragraph.", bbox: [100, 200, 900, 500], page_width: 1000, page_height: 1400 },
    ]) }]);
    const result = mineru().extractResultZip(archive).result;
    expect(result.blocks[0]).toMatchObject({
      pageNumber: 2,
      bbox: [0.1, 0.2, 0.9, 0.5],
      pageWidth: 1000,
      pageHeight: 1400,
    });
  });

  it("keeps existing block ids when coordinates are added and versions the geometry contract", () => {
    const content = { type: "text", page_idx: 4, text: "An existing paragraph." };
    const previous = mineru().extractResultZip(zip([{ name: "content_list.json", data: JSON.stringify([content]) }])).result;
    const enriched = mineru().extractResultZip(zip([{ name: "content_list.json", data: JSON.stringify([
      { ...content, bbox: [169, 126, 825, 156] },
    ]) }])).result;
    expect(enriched.blocks[0].id).toBe(previous.blocks[0].id);
    expect(enriched).toHaveProperty("layoutVersion", 3);
    expect(previous).toHaveProperty("layoutStatus", "unavailable");
    expect(enriched).toHaveProperty("layoutStatus", "available");
  });

  it("accepts explicit ZIP directory entries compressed with deflate", () => {
    const { assets, result } = mineru().extractResultZip(zip([
      { name: "images/", data: "", externalAttributes: (0x41ed * 65536) >>> 0 },
      { name: "full.md", data: "# Paper\n\n![Figure](images/a.png)" },
      { name: "images/a.png", data: Buffer.from([1]) },
    ]));
    expect(result.blocks[1].assetPath).toBe("images/a.png");
    expect(assets.map((asset) => asset.path)).toEqual(["images/a.png"]);
  });

  it("retains both page regions of one merged paragraph without changing its text or id", () => {
    const content = [{ type: "text", text: "Beginning of a paragraph. Continued on another page.", page_idx: 0, bbox: [100, 800, 900, 900] }];
    const first = { bbox: [60, 640, 540, 720], spans: [{ type: "text", content: "Beginning of a paragraph." }] };
    const continued = { bbox: [60, 160, 540, 320], spans: [{ type: "text", content: "Continued on another page.", cross_page: true }] };
    const layout = { pdf_info: [
      { page_idx: 0, page_size: [600, 800], para_blocks: [{ type: "text", bbox: first.bbox, lines: [first, continued] }] },
      { page_idx: 1, page_size: [600, 800], para_blocks: [], preproc_blocks: [
        { type: "text", bbox: continued.bbox, lines: [{ ...continued, spans: [{ type: "text", content: "Continued on another page." }] }] },
      ] },
    ] };
    const baseline = mineru().extractResultZip(zip([{ name: "paper_content_list.json", data: JSON.stringify(content) }])).result.blocks[0];
    const result = mineru().extractResultZip(zip([
      { name: "paper_content_list.json", data: JSON.stringify(content) },
      { name: "layout.json", data: JSON.stringify(layout) },
    ])).result;
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({ id: baseline.id, text: baseline.text, pageNumber: 1,
      pageBounds: [
        { pageNumber: 1, bbox: [0.1, 0.8, 0.9, 0.9] },
        { pageNumber: 2, bbox: [0.1, 0.2, 0.9, 0.4] },
      ],
    });
    expect(result).toHaveProperty("layoutVersion", 3);
  });

  it("recovers an unflagged same-page column continuation from exact layout lines", () => {
    const content = [{ type: "text", text: "Left column. Right column.", page_idx: 0, bbox: [100, 800, 450, 900] }];
    const first = { bbox: [60, 640, 270, 720], spans: [{ type: "text", content: "Left column." }] };
    const continued = { bbox: [330, 80, 540, 320], spans: [{ type: "text", content: "Right column." }] };
    const layout = { pdf_info: [{ page_idx: 0, page_size: [600, 800],
      para_blocks: [{ type: "text", bbox: first.bbox, lines: [first, continued] }],
      preproc_blocks: [{ type: "text", bbox: first.bbox, lines: [first] },
        { type: "text", bbox: continued.bbox, lines: [continued] }],
    }] };
    const baseline = mineru().extractResultZip(zip([{ name: "content_list.json", data: JSON.stringify(content) }])).result.blocks[0];
    const result = mineru().extractResultZip(zip([
      { name: "content_list.json", data: JSON.stringify(content) },
      { name: "layout.json", data: JSON.stringify(layout) },
    ])).result;
    expect(result.blocks[0]).toMatchObject({ id: baseline.id, text: baseline.text, pageBounds: [
      { pageNumber: 1, bbox: [.1, .8, .45, .9] },
      { pageNumber: 1, bbox: [.55, .1, .9, .4] },
    ] });
    expect(result).toHaveProperty("layoutVersion", 3);
  });

  it("rejects unresolved cross-page coordinates rather than publishing a falsely complete result", () => {
    const content = [{ type: "text", text: "Beginning. Continuation.", page_idx: 0, bbox: [100, 800, 900, 900] }];
    const layout = { pdf_info: [{ page_idx: 0, page_size: [600, 800], para_blocks: [
      { type: "text", bbox: [60, 640, 540, 720], lines: [
        { bbox: [60, 640, 540, 720], spans: [{ type: "text", content: "Beginning." }] },
        { bbox: [60, 160, 540, 320], spans: [{ type: "text", content: "Continuation.", cross_page: true }] },
      ] },
    ] }] };
    expect(() => mineru().extractResultZip(zip([
      { name: "content_list.json", data: JSON.stringify(content) },
      { name: "layout.json", data: JSON.stringify(layout) },
    ]))).toThrow(/cross.page|layout/i);
  });

  it("keeps invalid repeated sources ambiguous instead of relocating a continuation to another page", () => {
    const continued = { bbox: [60, 160, 540, 320], spans: [{ type: "text", content: "Repeated continuation." }] };
    const content = [{ type: "text", text: "Beginning. Repeated continuation.", page_idx: 0, bbox: [100, 800, 900, 900] }];
    const layout = { pdf_info: [
      { page_idx: 0, page_size: [600, 800], para_blocks: [{ type: "text", bbox: [60, 640, 540, 720], lines: [
        { bbox: [60, 640, 540, 720], spans: [{ type: "text", content: "Beginning." }] },
        { ...continued, spans: [{ ...continued.spans[0], cross_page: true }] },
      ] }] },
      { page_idx: 1, page_size: [0, 800], preproc_blocks: [{ type: "text", lines: [continued] }] },
      { page_idx: 2, page_size: [1200, 400], preproc_blocks: [{ type: "text", lines: [continued] }] },
    ] };
    expect(() => mineru().extractResultZip(zip([
      { name: "content_list.json", data: JSON.stringify(content) },
      { name: "layout.json", data: JSON.stringify(layout) },
    ]))).toThrow(/cross.page|layout/i);
  });

  it("falls back to Markdown headings, paragraphs, tables, equations, and local images without inventing a page count", () => {
    const markdown = "# Paper\n\n## Method\n\nA paragraph\ncontinued.\n\n![Figure](images/a.png)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n$$\nx+y\n$$";
    const { result, assets } = mineru().extractResultZip(zip([
      { name: "result/full.md", data: markdown },
      { name: "result/images/a.png", data: Buffer.from([4]) },
    ]));
    expect(result.title).toBe("Paper");
    expect(result.pageCount).toBeUndefined();
    expect(result.blocks.map((block) => block.kind)).toEqual(["heading", "heading", "paragraph", "image", "table", "equation"]);
    expect(result.blocks.slice(0, 2).map((block) => block.headingLevel)).toEqual([1, 2]);
    expect(result.blocks[2].text).toBe("A paragraph\ncontinued.");
    expect(result.blocks[3]).toMatchObject({ assetPath: "result/images/a.png", caption: "Figure", pageNumber: 1 });
    expect(result.blocks[5].text).toBe("x+y");
    expect(assets[0].path).toBe("result/images/a.png");
  });

  it("does not silently fall back when an existing primary content list is corrupt", () => {
    for (const data of ["{invalid", '{"blocks":[]}', "[null]"]) {
      expect(() => mineru().extractResultZip(zip([{ name: "content_list.json", data }, { name: "full.md", data: "# fallback" }]))).toThrow(/content|JSON/i);
    }
    expect(() => mineru().extractResultZip(zip([{ name: "ignored.txt", data: "nothing" }]))).toThrow(/content|Markdown/i);
  });

  it.each(["../escape.png", "/absolute.png", "C:/escape.png", "images\\..\\escape.png", "%2e%2e/escape.png", "images/file:ads.png", "CON.png", "images/a.png."])("rejects unsafe ZIP member %s", (name) => {
    expect(() => mineru().extractResultZip(zip([{ name: "full.md", data: "# Paper" }, { name, data: "image" }]))).toThrow(/path/i);
  });

  it("rejects unsafe content image references and never fetches remote images", () => {
    expect(() => mineru().extractResultZip(zip([{ name: "content_list.json", data: JSON.stringify([{ type: "image", img_path: "../../escape.png" }]) }]))).toThrow(/path/i);
    const { result } = mineru().extractResultZip(zip([{ name: "full.md", data: "![remote](https://example.com/a.png)" }]));
    expect(result.blocks[0].assetPath).toBeUndefined();
  });

  it("rejects Windows case collisions, symlinks, encryption, unsupported methods, and advertised expansion limits", () => {
    const cases = [
      [{ name: "full.md", data: "# one" }, { name: "FULL.md", data: "# two" }],
      [{ name: "full.md", data: "# Paper", externalAttributes: (0xa1ff * 65536) >>> 0 }],
      [{ name: "full.md", data: "# Paper", flags: 0x801 }],
      [{ name: "full.md", data: "# Paper", method: 12 }],
      [{ name: "full.md", data: "# Paper", claimedSize: 64 * 1024 * 1024 + 1 }],
    ];
    for (const entries of cases) expect(() => mineru().extractResultZip(zip(entries))).toThrow(/ZIP|limit|duplicate|link|method|encrypt/i);
  });

  it("checks actual deflate output size, CRC, local names, and truncation", () => {
    const badSize = zip([{ name: "full.md", data: "# Paper", claimedSize: 1 }]);
    expect(() => mineru().extractResultZip(badSize)).toThrow(/ZIP|size|limit/i);
    const badCrc = zip([{ name: "full.md", data: "# Paper", method: 0 }]);
    badCrc[30 + Buffer.byteLength("full.md")] ^= 1;
    expect(() => mineru().extractResultZip(badCrc)).toThrow(/CRC|ZIP/i);
    const badName = zip([{ name: "full.md", data: "# Paper" }]);
    badName[30] = "x".charCodeAt(0);
    expect(() => mineru().extractResultZip(badName)).toThrow(/ZIP|name/i);
    const valid = zip([{ name: "full.md", data: "# Paper" }]);
    expect(() => mineru().extractResultZip(valid.subarray(0, valid.length - 8))).toThrow(/ZIP/i);
    expect(() => mineru().extractResultZip(Buffer.from("not a ZIP"))).toThrow(/ZIP/i);
  });
});
