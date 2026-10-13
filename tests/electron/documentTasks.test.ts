// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
type Store = {
  save(input: { name: string; data: Uint8Array }): Promise<{ id: string }>;
  read(id: string): Promise<Uint8Array>;
  saveAsset(id: string, relative: string, data: Uint8Array): Promise<void>;
  readAsset(id: string, relative: string): Promise<Uint8Array>;
  loadParse(id: string): Promise<any>;
  saveParse(id: string, result: any): Promise<void>;
  loadTask(id: string): Promise<any>;
  saveTask(id: string, task: any): Promise<void>;
};
type Mineru = {
  requestUpload(options: any): Promise<{ batchId: string; uploadUrl: string }>;
  uploadPdf(options: any): Promise<void>;
  getBatch(options: any): Promise<any>;
  downloadResultZip(options: any): Promise<Uint8Array>;
  extractResultZip(buffer: Uint8Array): { result: any; assets: Array<{ path: string; data: Uint8Array }> };
};
type Tasks = {
  start(id: string): Promise<{ batchId: string }>;
  status(id: string): Promise<any>;
  snapshot(id: string): Promise<any>;
};

const pdf = Uint8Array.from(Buffer.from("%PDF-1.7\n%%EOF\n"));
const apiKey = "synthetic-key";
const validResult = { layoutVersion: 3, blocks: [{ id: "b1", kind: "paragraph", text: "Body", pageNumber: 1, order: 0, bbox: [0.1, 0.2, 0.8, 0.4] }] };
const loadedModules = {
  store: require("../../electron/document-store.cjs") as { createDocumentStore(options: { rootDirectory: string }): Store },
  tasks: require("../../electron/document-tasks.cjs") as { createDocumentTasks(options: any): Tasks },
};
const roots: string[] = [];

async function fixture(mineruOverrides: Partial<Mineru> = {}) {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "paperquay-tasks-"));
  roots.push(rootDirectory);
  const documents = loadedModules.store.createDocumentStore({ rootDirectory });
  const { id } = await documents.save({ name: "paper.pdf", data: pdf });
  const calls = {
    requestUpload: vi.fn(async () => ({ batchId: "batch-1", uploadUrl: "https://mineru.oss-cn-shanghai.aliyuncs.com/upload" })),
    uploadPdf: vi.fn(async () => {}),
    getBatch: vi.fn(async () => ({ state: "running", progress: 0.5 })),
    downloadResultZip: vi.fn(async () => Uint8Array.from([1])),
    extractResultZip: vi.fn(() => ({
      result: validResult,
      assets: [{ path: "images/figure.png", data: Uint8Array.from([2, 3]) }],
    })),
    ...mineruOverrides,
  };
  const tasks = loadedModules.tasks.createDocumentTasks({
    documents,
    readSettings: () => ({ mineru: { apiKey } }),
    mineru: calls,
  });
  return { id, documents, tasks, calls };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("document task orchestration", () => {
  it("recovers version-two column bounds from the completed batch without another upload", async () => {
    const upgraded = { ...validResult, layoutVersion: 3, blocks: [{ ...validResult.blocks[0], id: "replacement",
      pageBounds: [{ pageNumber: 1, bbox: validResult.blocks[0].bbox }, { pageNumber: 1, bbox: [.85, .1, .95, .3] }],
    }] };
    const { id, tasks, documents, calls } = await fixture({
      getBatch: vi.fn(async () => ({ state: "done", progress: 1, zipUrl: "https://cdn-mineru.openxlab.org.cn/cloud.zip" })),
      extractResultZip: vi.fn(() => ({ result: upgraded, assets: [] })),
    });
    await documents.saveTask(id, { batchId: "completed", resultBatchId: "completed", state: "done", progress: 1 });
    await documents.saveParse(id, { ...validResult, layoutVersion: 2 });
    expect((await tasks.snapshot(id)).layoutRecoveryNeeded).toBe(true);
    await tasks.status(id);
    const status = await tasks.status(id);
    expect(status.result.blocks[0]).toMatchObject({ id: "b1", pageBounds: upgraded.blocks[0].pageBounds });
    expect(calls.requestUpload).not.toHaveBeenCalled();
    expect(calls.uploadPdf).not.toHaveBeenCalled();
  });
  it("upgrades a version-one completed result from the same batch without uploading", async () => {
    const upgraded = { ...validResult, layoutVersion: 3, blocks: [{ ...validResult.blocks[0],
      id: "replacement-id", pageBounds: [
        { pageNumber: 1, bbox: validResult.blocks[0].bbox },
        { pageNumber: 2, bbox: [.1, .2, .8, .4] },
      ],
    }] };
    const { id, tasks, documents, calls } = await fixture({
      getBatch: vi.fn(async () => ({ state: "done", progress: 1, zipUrl: "https://cdn-mineru.openxlab.org.cn/cloud.zip" })),
      extractResultZip: vi.fn(() => ({ result: upgraded, assets: [] })),
    });
    await documents.saveTask(id, { batchId: "completed", resultBatchId: "completed", state: "done", progress: 1 });
    await documents.saveParse(id, { ...validResult, layoutVersion: 1 });
    expect((await tasks.snapshot(id)).layoutRecoveryNeeded).toBe(true);
    expect(await tasks.status(id)).toMatchObject({ state: "downloading", batchId: "completed" });
    const status = await tasks.status(id);
    expect(status.result.blocks[0]).toMatchObject({ id: validResult.blocks[0].id, pageBounds: upgraded.blocks[0].pageBounds });
    expect(calls.requestUpload).not.toHaveBeenCalled();
    expect(calls.uploadPdf).not.toHaveBeenCalled();
    expect(calls.downloadResultZip).toHaveBeenCalledOnce();
  });

  it("does not let an older status response overwrite a newly accepted upload or its timestamp", async () => {
    let releaseBatch!: (value: { state: string; progress: number }) => void;
    const { id, tasks, documents, calls } = await fixture({
      getBatch: vi.fn(() => new Promise((resolve) => { releaseBatch = resolve; })) as never,
    });
    await documents.saveTask(id, { batchId: "batch-1", state: "waiting-file", progress: 0 });
    const status = tasks.status(id);
    await vi.waitFor(() => expect(calls.getBatch).toHaveBeenCalledOnce());
    const start = tasks.start(id);
    expect(calls.uploadPdf).not.toHaveBeenCalled();
    releaseBatch({ state: "waiting-file", progress: 0 });
    await expect(status).resolves.toMatchObject({ state: "pending" });
    await start;
    expect(await documents.loadTask(id)).toMatchObject({ state: "pending", uploadCompletedAt: expect.any(Number) });
    expect(calls.uploadPdf).toHaveBeenCalledOnce();
  });

  it("serializes a slow old write before committing a newly uploaded batch", async () => {
    let releaseWrite!: () => void;
    const { id, tasks, documents, calls } = await fixture({
      getBatch: vi.fn(async () => ({ state: "waiting-file", progress: 0 })),
    });
    await documents.saveTask(id, { batchId: "old-batch", state: "waiting-file", progress: 0 });
    const saveTask = documents.saveTask.bind(documents);
    const save = vi.spyOn(documents, "saveTask").mockImplementation(async (documentId, task) => {
      if (task.batchId === "old-batch") await new Promise<void>((resolve) => { releaseWrite = resolve; });
      await saveTask(documentId, task);
    });
    const status = tasks.status(id);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    const start = tasks.start(id);
    expect(calls.requestUpload).not.toHaveBeenCalled();
    releaseWrite();
    await expect(status).resolves.toMatchObject({ state: "pending" });
    await start;
    expect(await documents.loadTask(id)).toMatchObject({ batchId: "batch-1", state: "pending", uploadCompletedAt: expect.any(Number) });
  });

  it("continues polling when an older GET fails while a retry is queued", async () => {
    let rejectBatch!: (error: Error) => void;
    const { id, tasks, documents, calls } = await fixture({
      getBatch: vi.fn(() => new Promise((_resolve, reject) => { rejectBatch = reject; })) as never,
    });
    await documents.saveTask(id, { batchId: "old-batch", state: "waiting-file", progress: 0 });
    const status = tasks.status(id);
    await vi.waitFor(() => expect(calls.getBatch).toHaveBeenCalledOnce());
    const start = tasks.start(id);
    rejectBatch(new Error("network"));
    await expect(status).resolves.toMatchObject({ state: "pending" });
    await start;
    expect(await documents.loadTask(id)).toMatchObject({ batchId: "batch-1", state: "pending", uploadCompletedAt: expect.any(Number) });
  });

  it("waits for upload detection without creating another batch, then exposes an actionable timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T00:00:00Z"));
    const { id, tasks, documents, calls } = await fixture({
      getBatch: vi.fn(async () => ({ state: "waiting-file", progress: 0 })),
    });
    await tasks.start(id);
    expect(await tasks.status(id)).toMatchObject({ state: "pending", message: expect.stringContaining("确认") });
    expect(await tasks.start(id)).toEqual({ batchId: "batch-1" });
    expect(calls.uploadPdf).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date("2026-10-11T00:02:01Z"));
    expect(await tasks.status(id)).toMatchObject({ state: "waiting-file", message: expect.stringContaining("重新上传") });
    expect(await documents.loadTask(id)).toMatchObject({ state: "waiting-file" });
    await tasks.start(id);
    expect(calls.uploadPdf).toHaveBeenCalledTimes(2);
  });

  it("exports the bounded factory and the three recovery methods", () => {
    expect(Object.keys(loadedModules.tasks)).toEqual(["createDocumentTasks"]);
  });

  it("uploads once, persists the batch before upload, and exposes durable task state", async () => {
    const { id, tasks, documents, calls } = await fixture();
    expect(await tasks.start(id)).toEqual({ batchId: "batch-1" });
    expect(calls.requestUpload).toHaveBeenCalledTimes(1);
    expect(calls.uploadPdf).toHaveBeenCalledTimes(1);
    const task = { batchId: "batch-1", state: "pending", progress: 0, uploadCompletedAt: expect.any(Number) };
    expect(await documents.loadTask(id)).toEqual(task);
    expect(await tasks.snapshot(id)).toEqual({ task, result: null });
  });

  it("reuses active pending, running, converting, and cloud-done-download-pending batches", async () => {
    for (const state of ["pending", "running", "converting", "downloading"]) {
      const { id, tasks, documents, calls } = await fixture();
      await documents.saveTask(id, { batchId: "existing", state, progress: 0.5, ...(state === "downloading" ? { zipUrl: "https://cdn-mineru.openxlab.org.cn/existing.zip" } : {}) });
      expect(await tasks.start(id)).toEqual({ batchId: "existing" });
      expect(calls.requestUpload).not.toHaveBeenCalled();
      expect(calls.uploadPdf).not.toHaveBeenCalled();
    }
  });

  it("reuses a completed valid matching result without network calls", async () => {
    const { id, tasks, documents, calls } = await fixture();
    await documents.saveParse(id, validResult);
    await documents.saveTask(id, { batchId: "complete", resultBatchId: "complete", state: "done", progress: 1 });
    expect(await tasks.start(id)).toEqual({ batchId: "complete" });
    expect(await tasks.status(id)).toMatchObject({ state: "done", batchId: "complete", result: validResult });
    expect(calls.requestUpload).not.toHaveBeenCalled();
    expect(calls.getBatch).not.toHaveBeenCalled();
  });

  it("recovers coordinates from an existing completed batch without uploading and preserves block identity", async () => {
    const positioned = { ...validResult, layoutVersion: 3, blocks: [{ ...validResult.blocks[0], id: "new-id", bbox: [0.1, 0.2, 0.8, 0.4] }] };
    const { id, tasks, documents, calls } = await fixture({
      getBatch: vi.fn(async () => ({ state: "done", progress: 1, zipUrl: "https://cdn-mineru.openxlab.org.cn/result.zip" })),
      extractResultZip: vi.fn(() => ({ result: positioned, assets: [] })),
    });
    await documents.saveParse(id, { ...validResult, layoutVersion: undefined });
    await documents.saveTask(id, { batchId: "existing", resultBatchId: "existing", state: "done", progress: 1 });
    expect((await tasks.snapshot(id)).layoutRecoveryNeeded).toBe(true);
    expect(await tasks.status(id)).toMatchObject({ state: "downloading" });
    const status = await tasks.status(id);
    expect(status.result.blocks[0]).toMatchObject({ id: "b1", bbox: [0.1, 0.2, 0.8, 0.4] });
    expect(calls.requestUpload).not.toHaveBeenCalled();
    expect(calls.uploadPdf).not.toHaveBeenCalled();
    expect(calls.getBatch).toHaveBeenCalledOnce();
    expect((await documents.loadParse(id)).layoutVersion).toBe(3);
  });

  it("lets an explicit restart replace unavailable or partial coordinates", async () => {
    for (const blocks of [
      [{ ...validResult.blocks[0], bbox: undefined }],
      [...validResult.blocks, { ...validResult.blocks[0], id: "missing", bbox: undefined }],
    ]) {
      const { id, tasks, documents, calls } = await fixture();
      await documents.saveParse(id, { layoutVersion: 3, layoutStatus: "unavailable", blocks });
      await documents.saveTask(id, { batchId: "no-layout", resultBatchId: "no-layout", state: "done", progress: 1 });
      expect((await tasks.snapshot(id)).layoutRecoveryNeeded).toBeUndefined();
      expect(await tasks.start(id)).toEqual({ batchId: "batch-1" });
      expect(calls.requestUpload).toHaveBeenCalledOnce();
    }
  });

  it("recovers a legacy completed batch without trusting or uploading its unbound parse data", async () => {
    const { id, tasks, documents, calls } = await fixture({
      getBatch: vi.fn(async () => ({ state: "done", progress: 1, zipUrl: "https://cdn-mineru.openxlab.org.cn/result.zip" })),
    });
    await documents.saveParse(id, { ...validResult, blocks: [{ ...validResult.blocks[0], text: "Old unbound result" }] });
    await documents.saveTask(id, { batchId: "legacy", state: "done", progress: 1 });
    expect((await tasks.snapshot(id)).layoutRecoveryNeeded).toBe(true);
    expect(await tasks.start(id)).toEqual({ batchId: "legacy" });
    expect(await tasks.status(id)).toMatchObject({ state: "downloading" });
    expect((await tasks.status(id)).result).toEqual(validResult);
    expect(calls.requestUpload).not.toHaveBeenCalled();
  });

  it("does not return old parse data for a different batch and does not clear it before upload succeeds", async () => {
    const { id, tasks, documents, calls } = await fixture({
      requestUpload: vi.fn(async () => { throw new Error("network"); }),
    });
    await documents.saveParse(id, { old: true });
    await documents.saveTask(id, { batchId: "new", resultBatchId: "old", state: "done", progress: 1 });
    await expect(tasks.start(id)).rejects.toThrow(/MinerU|解析|网络/);
    expect(await documents.loadParse(id)).toEqual({ old: true });
    const snapshot = await tasks.snapshot(id);
    expect(snapshot.result).toBeNull();
  });

  it("marks downloading before download, resumes after failure, and publishes done only after all durable writes", async () => {
    let releaseDownload!: () => void;
    let notifyDownloadStarted!: () => void;
    const downloadStarted = new Promise<void>((resolve) => { notifyDownloadStarted = resolve; });
    const download = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => new Promise<Uint8Array>((resolve) => {
        releaseDownload = () => resolve(Uint8Array.from([1]));
        notifyDownloadStarted();
      }));
    const { id, tasks, documents, calls } = await fixture({
      getBatch: vi.fn(async () => ({ state: "done", progress: 1, zipUrl: "https://cdn-mineru.openxlab.org.cn/result.zip" })),
      downloadResultZip: download,
    });
    await tasks.start(id);
    await documents.saveTask(id, { batchId: "batch-1", state: "done", progress: 1 });
    expect(await tasks.status(id)).toMatchObject({ state: "downloading", progress: 1 });
    expect(download).not.toHaveBeenCalled();
    expect((await tasks.snapshot(id)).result).toBeNull();
    await expect(tasks.status(id)).rejects.toThrow(/解析|网络|结果/);
    expect(await documents.loadTask(id)).toMatchObject({ batchId: "batch-1", state: "downloading" });
    const status = tasks.status(id);
    // Synchronize with the actual download phase instead of a one-second poll
    // that races filesystem scheduling on Windows CI. Propagate task failures.
    await Promise.race([downloadStarted, status]);
    expect(await documents.loadTask(id)).toMatchObject({ state: "downloading", batchId: "batch-1", zipUrl: "https://cdn-mineru.openxlab.org.cn/result.zip" });
    expect(download).toHaveBeenCalledTimes(2);
    releaseDownload();
    await expect(status).resolves.toMatchObject({ state: "done", batchId: "batch-1", result: validResult });
    expect(download).toHaveBeenCalledTimes(2);
    expect(await documents.readAsset(id, "images/figure.png")).toEqual(Uint8Array.from([2, 3]));
    expect(await documents.loadTask(id)).toEqual({ batchId: "batch-1", state: "done", progress: 1, resultBatchId: "batch-1" });
  });

  it("uses the persisted cloud ZIP URL on start resume without polling or requesting another upload", async () => {
    const { id, tasks, documents, calls } = await fixture({
      downloadResultZip: vi.fn(async () => Uint8Array.from([1])),
    });
    await documents.saveTask(id, { batchId: "cloud", state: "downloading", progress: 1, zipUrl: "https://cdn-mineru.openxlab.org.cn/cloud.zip" });
    expect(await tasks.start(id)).toEqual({ batchId: "cloud" });
    expect(calls.requestUpload).not.toHaveBeenCalled();
    expect(calls.getBatch).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent starts and status calls by document id", async () => {
    let resolveUpload!: (value: { batchId: string; uploadUrl: string }) => void;
    const requestUpload = vi.fn(() => new Promise<{ batchId: string; uploadUrl: string }>((resolve) => { resolveUpload = resolve; }));
    const { id, tasks, calls } = await fixture({ requestUpload });
    const first = tasks.start(id);
    const second = tasks.start(id);
    await vi.waitFor(() => expect(calls.requestUpload).toHaveBeenCalledTimes(1));
    resolveUpload({ batchId: "dedup", uploadUrl: "https://mineru.oss-cn-shanghai.aliyuncs.com/upload" });
    await expect(Promise.all([first, second])).resolves.toEqual([{ batchId: "dedup" }, { batchId: "dedup" }]);

    let resolveBatch!: (value: any) => void;
    (calls.getBatch as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise((resolve) => { resolveBatch = resolve; }));
    const statusOne = tasks.status(id);
    const statusTwo = tasks.status(id);
    await vi.waitFor(() => expect(calls.getBatch).toHaveBeenCalledTimes(1));
    resolveBatch({ state: "running", progress: 0.2 });
    await expect(Promise.all([statusOne, statusTwo])).resolves.toEqual([
      { state: "running", progress: 0.2, batchId: "dedup", message: "MinerU 正在解析，已处理 20% 页面…" },
      { state: "running", progress: 0.2, batchId: "dedup", message: "MinerU 正在解析，已处理 20% 页面…" },
    ]);
  });

  it("snapshot is read-only, validates only matching published results, and never calls settings or MinerU", async () => {
    const readSettings = vi.fn(() => ({ mineru: { apiKey } }));
    const { id, documents, calls } = await fixture();
    const tasks = loadedModules.tasks.createDocumentTasks({ documents, readSettings, mineru: calls });
    await documents.saveParse(id, validResult);
    await documents.saveTask(id, { batchId: "new", resultBatchId: "old", state: "done", progress: 1 });
    expect(await tasks.snapshot(id)).toEqual({ task: { batchId: "new", resultBatchId: "old", state: "done", progress: 1 }, result: null });
    expect(readSettings).not.toHaveBeenCalled();
    expect(calls.getBatch).not.toHaveBeenCalled();
    expect(calls.downloadResultZip).not.toHaveBeenCalled();
    expect(calls.requestUpload).not.toHaveBeenCalled();
  });

  it("does not let a legacy done task pretend a stored result is current", async () => {
    const { id, tasks, documents } = await fixture();
    await documents.saveParse(id, validResult);
    await documents.saveTask(id, { batchId: "legacy", state: "done", progress: 1 });
    expect(await tasks.snapshot(id)).toEqual({ task: { batchId: "legacy", state: "done", progress: 1 }, result: null, layoutRecoveryNeeded: true });
  });

  it("validates document IDs through the store boundary", async () => {
    const { tasks } = await fixture();
    await expect(tasks.start("../escape")).rejects.toThrow(/id|文档/);
    await expect(tasks.status("../escape")).rejects.toThrow(/id|文档/);
    await expect(tasks.snapshot("../escape")).rejects.toThrow(/id|文档/);
  });
});
