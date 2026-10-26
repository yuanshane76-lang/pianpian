// @vitest-environment node
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Bytes = ArrayBuffer | Uint8Array | Buffer;
type Store = {
  save(input: { name: string; data: Bytes }): Promise<{ id: string; name: string; duplicate: boolean }>;
  read(id: string): Promise<Uint8Array>;
  remove(id: string): Promise<boolean>;
  assetPath(id: string, relative: string): string;
  saveAsset(id: string, relative: string, data: Bytes): Promise<void>;
  readAsset(id: string, relative: string): Promise<Uint8Array>;
  loadParse(id: string): Promise<unknown | null>;
  saveParse(id: string, result: unknown): Promise<void>;
  loadTask(id: string): Promise<unknown | null>;
  saveTask(id: string, task: unknown): Promise<void>;
};
const temporaryRoots: string[] = [];
const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const idOf = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

async function fixture() {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "paperquay-store-"));
  temporaryRoots.push(rootDirectory);
  const { createDocumentStore } = require("../../electron/document-store.cjs") as {
    createDocumentStore(options: { rootDirectory: string }): Store;
  };
  return { rootDirectory, store: createDocumentStore({ rootDirectory }), createDocumentStore };
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("durable desktop document store", () => {
  it("exports the store factory", () => {
    expect(Object.keys(require("../../electron/document-store.cjs"))).toEqual(["createDocumentStore"]);
  });

  it("hashes exact view bytes, sanitizes the name, and persists the original PDF", async () => {
    const { rootDirectory, store } = await fixture();
    const backing = Buffer.concat([Buffer.from("prefix"), pdf, Buffer.from("suffix")]);
    const data = new Uint8Array(backing.buffer, backing.byteOffset + 6, pdf.length);
    const saved = await store.save({ name: "..\\private\\paper:<bad>\u0000.pdf", data });
    expect(saved).toEqual({ id: idOf(pdf), name: "paper__bad_.pdf", duplicate: false });
    expect(await readFile(path.join(rootDirectory, saved.id, "original.pdf"))).toEqual(pdf);
    expect(Buffer.from(await store.read(saved.id))).toEqual(pdf);
    expect(await readdir(path.join(rootDirectory, saved.id))).not.toContain("original.pdf.tmp");
  });

  it("accepts ArrayBuffer and deduplicates across store instances without replacing the original", async () => {
    const { rootDirectory, store, createDocumentStore } = await fixture();
    const first = await store.save({ name: "first.pdf", data: Uint8Array.from(pdf).buffer });
    const second = await createDocumentStore({ rootDirectory }).save({ name: "second.pdf", data: pdf });
    expect(second).toEqual({ id: first.id, name: "second.pdf", duplicate: true });
    expect(Buffer.from(await store.read(first.id))).toEqual(pdf);
  });

  it("reports one new document under concurrent duplicate imports", async () => {
    const { rootDirectory, store, createDocumentStore } = await fixture();
    const results = await Promise.all([
      store.save({ name: "one.pdf", data: pdf }),
      createDocumentStore({ rootDirectory }).save({ name: "two.pdf", data: pdf }),
    ]);
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect((await readdir(path.join(rootDirectory, results[0].id))).filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  it("rejects non-PDF and oversized inputs before creating a document directory", async () => {
    const { rootDirectory, store } = await fixture();
    await expect(store.save({ name: "fake.pdf", data: Buffer.from("not a PDF") })).rejects.toThrow(/不支持的文件内容/);
    await expect(store.save({ name: "empty.pdf", data: Buffer.alloc(0) })).rejects.toThrow(/不支持的文件内容/);
    const large = Buffer.alloc(100 * 1024 * 1024 + 1);
    pdf.copy(large);
    await expect(store.save({ name: "large.pdf", data: large })).rejects.toThrow(/100/);
    await expect(store.save({ name: "string.pdf", data: "bad" as unknown as Bytes })).rejects.toThrow(/bytes/i);
    expect(await readdir(rootDirectory)).toEqual([]);
    // pptx 容器与 PDF 一样被接受（MinerU 转换路径），保存会创建文档目录。
    await expect(store.save({ name: "deck.pptx", data: Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.from("deck")]) })).resolves.toBeTruthy();
  });

  it("normalizes empty, reserved, and long filenames to safe PDF names", async () => {
    const { store } = await fixture();
    expect((await store.save({ name: "", data: pdf })).name).toBe("document.pdf");
    expect((await store.save({ name: "CON.pdf", data: pdf })).name).toBe("_CON.pdf");
    expect((await store.save({ name: "name.txt", data: pdf })).name).toBe("name.txt.pdf");
    const saved = await store.save({ name: "论".repeat(200) + ".pdf", data: pdf });
    expect(Buffer.byteLength(saved.name)).toBeLessThanOrEqual(180);
    expect(saved.name.endsWith(".pdf")).toBe(true);
  });

  it("durably round-trips parse results and tasks and returns null for absent records", async () => {
    const { rootDirectory, store, createDocumentStore } = await fixture();
    const { id } = await store.save({ name: "paper.pdf", data: pdf });
    expect(await store.loadParse(id)).toBeNull();
    expect(await store.loadTask(id)).toBeNull();
    const parsed = { blocks: [{ id: "b1", kind: "paragraph", text: "中文", pageNumber: 1, order: 0 }] };
    await store.saveParse(id, parsed);
    await store.saveTask(id, { batchId: "batch-1", state: "pending", progress: 0 });
    const restarted = createDocumentStore({ rootDirectory });
    expect(await restarted.loadParse(id)).toEqual(parsed);
    expect(await restarted.loadTask(id)).toEqual({ batchId: "batch-1", state: "pending", progress: 0 });
    await restarted.saveTask(id, { batchId: "batch-1", state: "done", progress: 1 });
    expect(await store.loadTask(id)).toEqual({ batchId: "batch-1", state: "done", progress: 1 });
  });

  it("removes the original, parse result, task, and assets as one document", async () => {
    const { rootDirectory, store } = await fixture();
    const { id } = await store.save({ name: "paper.pdf", data: pdf });
    await store.saveParse(id, { blocks: [] });
    await store.saveTask(id, { state: "done" });
    await store.saveAsset(id, "images/figure.png", Buffer.from([1, 2, 3]));

    expect(await store.remove(id)).toBe(true);
    expect(await readdir(rootDirectory)).toEqual([]);
    expect(await store.remove(id)).toBe(false);
  });

  it("does not destroy a durable record when serialization fails or persist credential fields", async () => {
    const { rootDirectory, store } = await fixture();
    const { id } = await store.save({ name: "paper.pdf", data: pdf });
    await store.saveTask(id, { state: "pending" });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(store.saveTask(id, circular)).rejects.toThrow(/JSON/i);
    await expect(store.saveTask(id, { state: "pending", nested: { apiKey: "synthetic-key" } })).rejects.toThrow(/secret|credential/i);
    await expect(store.saveParse(id, { authorization: "Bearer synthetic" })).rejects.toThrow(/secret|credential/i);
    expect(await store.loadTask(id)).toEqual({ state: "pending" });
    expect((await readdir(path.join(rootDirectory, id))).some((name) => name.includes(".tmp"))).toBe(false);
  });

  it("returns asset paths inside a separate asset directory and reads exact image bytes", async () => {
    const { rootDirectory, store } = await fixture();
    const { id } = await store.save({ name: "paper.pdf", data: pdf });
    const target = store.assetPath(id, "images/figure.png");
    expect(target).toBe(path.join(rootDirectory, id, "assets", "images", "figure.png"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from([1, 2, 3]));
    expect(Buffer.from(await store.readAsset(id, "images/figure.png"))).toEqual(Buffer.from([1, 2, 3]));
  });

  it("atomically saves and replaces extracted assets using the block assetPath", async () => {
    const { rootDirectory, store, createDocumentStore } = await fixture();
    const { id } = await store.save({ name: "paper.pdf", data: pdf });
    await store.saveAsset(id, "paper/auto/images/figure.png", Buffer.from([4, 5]));
    const restarted = createDocumentStore({ rootDirectory });
    expect(Buffer.from(await restarted.readAsset(id, "paper/auto/images/figure.png"))).toEqual(Buffer.from([4, 5]));
    await restarted.saveAsset(id, "paper/auto/images/figure.png", Uint8Array.from([6]).buffer);
    expect(Buffer.from(await store.readAsset(id, "paper/auto/images/figure.png"))).toEqual(Buffer.from([6]));
    await expect(store.saveAsset(id, "../original.pdf", pdf)).rejects.toThrow(/path/i);
    await expect(store.saveAsset(id, "too-large.png", Buffer.alloc(64 * 1024 * 1024 + 1))).rejects.toThrow(/limit/i);
    expect(Buffer.from(await store.read(id))).toEqual(pdf);
  });

  it("strictly rejects invalid IDs and Windows or encoded asset traversal", async () => {
    const { store } = await fixture();
    const { id } = await store.save({ name: "paper.pdf", data: pdf });
    for (const invalid of ["../escape", "", id.toUpperCase(), "a".repeat(63), `${id}/file`]) {
      expect(() => store.assetPath(invalid, "image.png")).toThrow(/id/i);
      await expect(store.read(invalid)).rejects.toThrow(/id/i);
      await expect(store.saveTask(invalid, {})).rejects.toThrow(/id/i);
    }
    for (const invalid of ["../original.pdf", "a/../../b", "/tmp/a", "C:\\a", "\\\\host\\a", "a\\..\\b", "a:b", "a\0b", "%2e%2e/a", "a/./b", "a//b", "CON", "image.png.", "image.png "]) {
      expect(() => store.assetPath(id, invalid)).toThrow(/path/i);
      await expect(store.readAsset(id, invalid)).rejects.toThrow(/path/i);
    }
  });

  it("rejects directory junction escapes even when the lexical path is inside the root", async () => {
    const { rootDirectory, store } = await fixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), "paperquay-outside-"));
    temporaryRoots.push(outside);
    const { id } = await store.save({ name: "paper.pdf", data: pdf });
    await symlink(outside, path.join(rootDirectory, id, "assets"), "junction");
    expect(() => store.assetPath(id, "private.png")).toThrow(/path|link/i);
    await expect(store.readAsset(id, "private.png")).rejects.toThrow(/path|link/i);
  });

  it("does not follow a linked document directory or linked original file", async () => {
    const { rootDirectory, store } = await fixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), "paperquay-outside-"));
    temporaryRoots.push(outside);
    const id = idOf(pdf);
    await writeFile(path.join(outside, "original.pdf"), pdf);
    await symlink(outside, path.join(rootDirectory, id), "junction");
    await expect(store.read(id)).rejects.toThrow(/path|link/i);
    await expect(store.save({ name: "paper.pdf", data: pdf })).rejects.toThrow(/path|link/i);
    await expect(store.saveParse(id, {})).rejects.toThrow(/path|link/i);
  });
});
