# Desktop document store and MinerU contract

Verified by direct HTTP reads on **2026-10-04**, without credentials:

- Official hosted API: <https://mineru.net/apiManage/docs>
- Official output reference linked by the API: <https://opendatalab.github.io/MinerU/reference/output_files/>

The hosted v4 API documents `*_content_list.json`, `full.md`, and image assets in `full_zip_url`. The current output reference also describes self-hosted formats; those entrypoints do not redefine the hosted API contract.

## Exact exports and types

`electron/document-store.cjs` exports **only** `createDocumentStore`. All store I/O methods are asynchronous; `assetPath` is synchronous.

```ts
type Bytes = ArrayBuffer | Uint8Array | Buffer;
type Block = {
  id: string;
  kind: "heading" | "paragraph" | "image" | "table" | "equation";
  text: string;
  pageNumber: number; // 1-based
  order: number;      // 0-based, ordered within this result
  headingLevel?: number; // 1-6 when MinerU or Markdown identifies heading depth
  assetPath?: string;
  caption?: string;
  bbox?: [number, number, number, number]; // left, top, right, bottom; normalized 0-1
  pageWidth?: number;
  pageHeight?: number;
};
type ParseResult = {
  blocks: Block[]; title?: string; pageCount?: number;
  layoutVersion: 1;
  layoutStatus: "available" | "partial" | "unavailable";
};
type BatchState = "waiting-file" | "pending" | "running" | "converting" | "downloading" | "failed" | "done";
type BatchStatus = { state: BatchState; progress: number; error?: string; zipUrl?: string };
type StoredTask = { batchId: string; state: BatchState; progress: number; error?: string; resultBatchId?: string; zipUrl?: string };

function createDocumentStore(options: { rootDirectory: string }): {
  save(input: { name: string; data: Bytes }): Promise<{
    id: string; name: string; duplicate: boolean; page?: number;
  }>;
  read(id: string): Promise<Uint8Array>;
  assetPath(id: string, relative: string): string;
  saveAsset(id: string, relative: string, data: Bytes): Promise<void>;
  readAsset(id: string, relative: string): Promise<Uint8Array>;
  loadParse(id: string): Promise<unknown | null>;
  saveParse(id: string, result: unknown): Promise<void>;
  loadTask(id: string): Promise<unknown | null>;
  saveTask(id: string, task: unknown): Promise<void>;
};
```

`page` is currently omitted; PDF page counting belongs to the parent's PDF reader. JSON records round-trip caller-owned JSON; missing records return `null`, while malformed or oversized records throw. Credential field names are rejected recursively.

`electron/mineru.cjs` exports **only** these five functions:

```ts
type NetworkOptions = { fetchImpl?: typeof fetch; timeoutMs?: number };
function requestUpload(options: NetworkOptions & { apiKey: string; name: string }):
  Promise<{ batchId: string; uploadUrl: string }>;
function uploadPdf(options: NetworkOptions & { uploadUrl: string; data: Bytes }): Promise<void>;
function getBatch(options: NetworkOptions & { apiKey: string; batchId: string }): Promise<BatchStatus>;
function downloadResultZip(options: NetworkOptions & { zipUrl: string }): Promise<Uint8Array>;
function extractResultZip(bytes: Bytes): {
  result: ParseResult; assets: Array<{ path: string; data: Uint8Array }>;
};
```

## Hosted requests and polling

1. `requestUpload` sends `POST https://mineru.net/api/v4/file-urls/batch`, Bearer authorization, JSON `{files:[{name}], model_version:"vlm"}`. Success requires HTTP success and `code: 0`; reads `data.batch_id` and the sole `data.file_urls[0]`.
2. `uploadPdf` sends **raw bytes** via PUT to that signed URL, without Bearer authorization or an explicit Content-Type. The official docs say upload URLs last 24 hours and completed upload automatically submits parsing; no second submit call is required.
3. `getBatch` sends authenticated `GET https://mineru.net/api/v4/extract-results/batch/{batch_id}` and reads `data.extract_result`. This wrapper owns one-document batches; multiple rows are rejected as ambiguous. An empty row list returns `waiting-file`.
4. `progress` is a finite **0–1 fraction**: `done = 1`; `running = clamp(extracted_pages / total_pages)` from `extract_progress`; other states or missing/invalid counts give `0`. `running` at `1` still requires a later `done` state. Only `done` includes `zipUrl` from `full_zip_url`; only `failed` includes the generic `error: "MinerU parsing failed."`. Unsupported states or malformed success payloads throw.
5. `downloadResultZip` downloads without an API key. Request/body timeouts default to **30 seconds** for POST/poll and **120 seconds** for upload/download. Optional `timeoutMs` must be an integer between 1 and 300000. Each deadline aborts fetch and rejects even if an injected fetch/body never settles.

URLs require HTTPS and default port, without credentials or fragments. Upload allows `mineru.net` and `mineru.oss-cn-shanghai.aliyuncs.com`; download additionally allows `cdn-mineru.openxlab.org.cn`, matching the official examples. Redirects are rejected. A future service host change needs an explicit allowlist update. Service bodies, raw exception text, tokens and URLs never appear in errors; returned signed URLs stay in the main process.

## Persistence and result integration

The store saves exact-byte SHA-256 originals to `<root>/<id>/original.pdf`; metadata to `parse.json` and `task.json`; extracted assets to `<root>/<id>/assets/<asset.path>`. Publication uses flushed temporary files and atomic hard-link/rename operations. Concurrent identical imports yield one `duplicate: false`; originals are never replaced. Display filenames are sanitized to a safe PDF basename; duplicate imports return the current caller's sanitized name.

IDs must be exactly 64 lowercase hex characters. Asset paths use relative `/` separators. Traversal, encoded paths, absolute/Windows paths, reserved names, alternate streams and existing symlinks/junctions under the configured root are rejected. The root must be a private directory controlled by the main process; callers must not concurrently replace its directories.

Original/upload limit: **100 MiB**, with `%PDF-n.n` header validation. Asset limit: **64 MiB** per file. Parse/task JSON limits: **16 MiB / 1 MiB**. ZIP bounds: **100 MiB** compressed, **256 MiB** expanded, **4096** members, **64 MiB** per member, **16 MiB** per JSON/Markdown member, **1000:1** expansion ratio, **50000** blocks. The built-in ZIP reader supports stored and deflate members, UTF-8/ASCII filenames, directories and data descriptors, validates local/central records, CRC and sizes, and rejects encryption, ZIP64, multi-disk archives, special files, path collisions and overlapping members.

Extraction prioritizes one `content_list.json` or `*_content_list.json`. A corrupt primary list throws; absent lists use `full.md`, then `markdown.md`, then another `.md`. `text_level > 0` maps to headings and is retained as `headingLevel`; Markdown heading depth is retained in the same field. Images, tables and equations retain captions/body text. `page_idx + 1` maps source pages; content-list `pageCount` is the highest observed source page, not a verified PDF total. Markdown lacks page mapping: its blocks use page 1 and omit `pageCount`. Unknown textual list items become paragraphs. IDs are deterministic. Missing/remote images have no `assetPath`; no image reference triggers network access. HTML table text is data and must be rendered safely by the parent.

Each `block.assetPath` matches an extracted `asset.path` **exactly**, including archive subdirectories. Persist all assets before publishing the parse result:

```js
const status = await getBatch({ apiKey, batchId: task.batchId });
await store.saveTask(id, {
  batchId: task.batchId, state: status.state, progress: status.progress,
  ...(status.error ? { error: status.error } : {}),
});
if (status.state === "done") {
  const archive = await downloadResultZip({ zipUrl: status.zipUrl });
  const { result, assets } = extractResultZip(archive);
  for (const asset of assets) await store.saveAsset(id, asset.path, asset.data);
  await store.saveParse(id, result);
  // Return result to the renderer; use store.readAsset(id, block.assetPath) for preview.
}
```

A durable `done` task with absent parse data must retry download/extraction after restart. The low-level `getBatch` never downloads/extracts implicitly; the owning `document-tasks.cjs` status operation handles durable download and publication. Transport exceptions retain the task for retry. Credentials are supplied per request by the parent's encrypted profile and are never read by the low-level adapter.

## PDF layout contract

The existing hosted result ZIPs for the two local test papers were authenticated and downloaded on 2026-10-08. Their v1 `content_list` coordinates are integers on a **0-1000, top-left-origin page grid**, not PDF point coordinates. The adapter divides those coordinates by 1000 exactly once. It accepts only finite, nonnegative, nonempty four-value rectangles. Other formats require their own explicit adapter, not heuristic coordinate guessing.

The renderer receives only normalized `bbox` values. Page dimensions come from PDF.js's rendered viewport, not an outer column, device-pixel canvas backing size, or an estimated text flow. Canvas, text selection layer and hit overlay share a stage sized exactly to that viewport. No bounding box means no artificial clickable rectangle.

`layoutVersion` records the adapter version; `layoutStatus` separately records coordinate availability. A no-coordinate result is a readable degraded result, not an indefinitely running layout task. An explicit start can submit a new parse after the usual upload consent; normal status reads never repeatedly upload it.

Previously published results without `layoutVersion` recover from the **existing completed batch ZIP**. Matching old block IDs are retained by page, kind and normalized text, so adding geometry does not invalidate translation caches. Download failures retain the prior published parse. Legacy completed tasks without `resultBatchId` must first verify the remote batch; their unbound local parse is not trusted as current.

Desktop layout regression: with the dev server running and the app closed, run `node scripts/pdf-layout-e2e.cjs`. It uses the local Attention paper and writes reports/screenshots under ignored `out/layout-checks/`. Add `--live-ai` to validate a real selected-sentence translation; this may incur a small model charge and requires configured credentials. The script requires Playwright available in the configured local runtime.

Packaging must include both new CJS files in the parent's Electron allowlist; runtime imports use Node built-ins only.
