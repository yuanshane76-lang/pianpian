import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { createToolDefinitions } = require("../../electron/research-agent-tools.cjs");

const paperContext: Record<string, unknown> = {
  scope: "paper",
  paper: { id: "p1", title: "Attention Is All You Need", authors: [], year: 2017, blocks: [] },
  library: [],
};

const CANDIDATES = [
  { title: "BART: Denoising Seq2Seq", authors: [{ name: "Lewis" }], year: 2019, doi: "10.1/x", url: "https://example.com/bart", abstract: "Denoising pre-training.", citationCount: 900, source: "Semantic Scholar" },
  { title: "", source: "Semantic Scholar" }, // 无标题的脏条目被丢弃
];

function radarStub(candidates: unknown[] = CANDIDATES) {
  return { findRelatedPapers: vi.fn().mockResolvedValue({ seed: { title: "Attention Is All You Need" }, candidates, source: "Semantic Scholar", cached: false }) };
}

function build(radar: unknown, context: Record<string, unknown> = paperContext) {
  const candidateStore = new Map();
  const tools = createToolDefinitions({
    getContext: () => context,
    emitApproval: vi.fn(),
    fetchImpl: vi.fn(),
    candidateStore,
    semanticScholarClient: radar,
  });
  return {
    find: tools.find((tool: { name: string }) => tool.name === "find_similar_papers")!,
    add: tools.find((tool: { name: string }) => tool.name === "add_paper_to_library")!,
    candidateStore,
  };
}

describe("find_similar_papers agent tool", () => {
  it("registers alongside the base tools with fallback guidance", () => {
    const { find } = build(radarStub());
    expect(find).toBeTruthy();
    expect(find.description).toContain("兜底");
    expect(find.description).toContain("add_paper_to_library");
  });

  it("seeds single-paper sessions from the current paper and registers candidates", async () => {
    const radar = radarStub();
    const { find, candidateStore } = build(radar);
    const result = await find.execute("call-1", { limit: 5 });
    expect(radar.findRelatedPapers.mock.calls[0][0]).toMatchObject({ seed: { title: "Attention Is All You Need" }, limit: 5 });
    expect(result.details.papers).toHaveLength(1);
    expect(result.details.papers[0]).toMatchObject({ title: "BART: Denoising Seq2Seq", source: "Semantic Scholar" });
    expect(candidateStore.size).toBe(1);
    const [candidate] = candidateStore.values();
    expect(result.details.papers[0].candidateId).toBe(candidate.candidateId);
    expect(candidate.candidateId).toBeTruthy();
  });

  it("requires an explicit seed in library scope", async () => {
    const radar = radarStub();
    const { find } = build(radar, { scope: "library", paper: null, library: [] });
    await expect(find.execute("call-2", {})).rejects.toThrow(/提供论文标题或 DOI/);
    await expect(find.execute("call-3", { title: "Some Paper", doi: "10.2/y" }))
      .resolves.toMatchObject({ details: expect.objectContaining({ papers: expect.any(Array) }) });
    expect(radar.findRelatedPapers.mock.calls[0][0].seed).toEqual({ title: "Some Paper", doi: "10.2/y" });
  });

  it("propagates abort signals to the radar client", async () => {
    const controller = new AbortController();
    const radar = { findRelatedPapers: vi.fn().mockResolvedValue({ candidates: [] }) };
    const { find } = build(radar);
    await find.execute("call-4", {}, controller.signal);
    expect(radar.findRelatedPapers.mock.calls[0][0].signal).toBe(controller.signal);
  });

  it("feeds candidates into add_paper_to_library as metadata", async () => {
    const { find, add } = build(radarStub());
    const found = await find.execute("call-5", {});
    const candidateId = found.details.papers[0].candidateId;
    const result = await add.execute("call-6", { candidateId });
    expect(result.details.status).toBe("rejected"); // 未确认时走拒绝路径，元数据候选可进入确认流程
    expect(result.details.paper).toMatchObject({ title: "BART: Denoising Seq2Seq", source: "Semantic Scholar" });
  });
});
