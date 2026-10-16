import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { normalizeContext, createToolDefinitions } = require("../../electron/research-agent-tools.cjs");
const { createLibraryPaperReader } = require("../../electron/research-library.cjs");
const library = [{ id: "p1", originalId: "original1", title: "Attention study", authors: ["Alice"], year: 2025 },
  { id: "p2", title: "Metadata only", authors: [], year: null }];
describe("library conversation retrieval", () => {
  it("reads only published completed batches and propagates corrupt storage instead of inventing empty evidence", async () => {
    const documents = { loadTask: vi.fn(async (): Promise<any> => ({ state: "running", batchId: "b", resultBatchId: "a" })),
      loadParse: vi.fn(async (): Promise<any> => ({ layoutVersion: 3, blocks: [{ id: "b", pageNumber: 1, text: "<b>Actual</b> source." }] })) };
    const read = createLibraryPaperReader({ documents });
    expect(await read(library[1])).toBeNull();
    expect(await read(library[0])).toBeNull();
    expect(documents.loadParse).not.toHaveBeenCalled();
    documents.loadTask.mockResolvedValue({ state: "done", batchId: "b", resultBatchId: "a" });
    expect(await read(library[0])).toBeNull();
    documents.loadTask.mockResolvedValue({ state: "done", batchId: "b", resultBatchId: "b" });
    expect((await read(library[0])).blocks[0].text).toBe("Actual source.");
    documents.loadParse.mockResolvedValue({ layoutVersion: 2, blocks: [] });
    expect(await read(library[0])).toBeNull();
    documents.loadParse.mockRejectedValue(new Error("损坏的解析文件"));
    await expect(read(library[0])).rejects.toThrow("损坏");
  });
  it("accepts a global context without inventing a current paper", () => {
    expect(normalizeContext({ scope: "library", library })).toMatchObject({ scope: "library", paper: null });
  });
  it("searches parsed content and reads only existing library papers on demand", async () => {
    const context = normalizeContext({ scope: "library", library });
    const readLibraryPaper = vi.fn(async (paper: any) => paper.id === "p1" ? {
      ...paper, blocks: [{ id: "b1", pageNumber: 2, text: "Sparse routing reduces computation." }],
    } : null);
    const tools = createToolDefinitions({ getContext: () => context, readLibraryPaper });
    const search = tools.find((x: any) => x.name === "search_library");
    const result = await search.execute("s", { query: "sparse routing" });
    expect(result.details.papers).toEqual([expect.objectContaining({ id: "p1", snippets: [expect.objectContaining({ blockId: "b1" })] })]);
    const read = tools.find((x: any) => x.name === "read_current_paper");
    expect((await read.execute("r", { paperId: "p1" })).details.paper.blocks[0].id).toBe("b1");
    await expect(read.execute("r", {})).rejects.toThrow("论文");
    await expect(read.execute("r", { paperId: "outside" })).rejects.toThrow("文献库");
    await expect(read.execute("r", { paperId: "p2" })).rejects.toThrow("解析");
  });
  it("does not permit a single-paper conversation to read another paper", async () => {
    const context = normalizeContext({ scope: "paper", paper: { ...library[0], blocks: [] }, library });
    const read = createToolDefinitions({ getContext: () => context }).find((x: any) => x.name === "read_current_paper");
    await expect(read.execute("r", { paperId: "p2" })).rejects.toThrow("当前论文");
  });
});
