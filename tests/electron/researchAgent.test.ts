import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createResearchAgentRuntime, normalizeContext } = require("../../electron/research-agent-runtime.cjs");
const { searchLiterature, isUsablePaper } = require("../../electron/literature-search.cjs");
const { parseArxivFeed } = require("../../electron/literature-search.cjs");

const context = {
  paper: { id: "paper-1", title: "Synthetic attention study", authors: ["Alice"], year: 2025,
    blocks: [{ id: "block-1", pageNumber: 1, text: "Attention selects relevant features." }] },
  library: [],
};

const metadataFetch = async (url: string) => url.startsWith("https://export.arxiv.org/")
  ? new Response('<feed xmlns="http://www.w3.org/2005/Atom"/>')
  : new Response(JSON.stringify({ message: { items: [{ title: ["New finding"], DOI: "10.1234/new",
    author: [], published: { "date-parts": [[2026]] }, URL: "https://doi.org/10.1234/new" }] } }));

describe("research Agent", () => {
  it("exposes DeepSeek native web tools only for DeepSeek sessions", () => {
    const { createToolDefinitions } = require("../../electron/research-agent-tools.cjs");
    const makeTools = (provider: string) => createToolDefinitions({
      getContext: () => context,
      service: { provider, apiKey: "synthetic-test-placeholder" },
    });

    expect(makeTools("deepseek").map((tool: any) => tool.name))
      .toEqual(expect.arrayContaining(["search_web", "fetch_web_page"]));
    expect(makeTools("aliyun").map((tool: any) => tool.name))
      .not.toEqual(expect.arrayContaining(["search_web", "fetch_web_page"]));
  });

  it("calls DeepSeek Search and Fetch with bounded, structured results", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url.endsWith("/tools/search")) {
        return new Response(JSON.stringify({
          results: [{ title: "DeepSeek", url: "https://www.deepseek.com", snippet: "A result", content: "Page content." }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ title: "Fetched page", content: "# Full page\n\nBody." }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });
    const { createToolDefinitions } = require("../../electron/research-agent-tools.cjs");
    const tools = createToolDefinitions({
      getContext: () => context,
      service: { provider: "deepseek", apiKey: "deepseek-test-key", baseUrl: "https://api.deepseek.com" },
      fetchImpl,
    });

    const search = tools.find((tool: any) => tool.name === "search_web");
    const searchResult = await search.execute("search-1", { query: "DeepSeek", count: 3, needContent: true });
    expect(requests[0]).toMatchObject({
      url: "https://api.deepseek.com/v1/tools/search",
      init: expect.objectContaining({ method: "POST" }),
    });
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ query: "DeepSeek", count: 3, need_content: true });
    expect(searchResult.details).toMatchObject({
      source: "DeepSeek Search",
      results: [{ title: "DeepSeek", url: "https://www.deepseek.com/", content: "Page content." }],
    });

    const fetchTool = tools.find((tool: any) => tool.name === "fetch_web_page");
    const fetchResult = await fetchTool.execute("fetch-1", { url: "https://www.deepseek.com/docs" });
    expect(requests[1]).toMatchObject({
      url: "https://api.deepseek.com/v1/tools/fetch",
      init: expect.objectContaining({ method: "POST" }),
    });
    expect(JSON.parse(String(requests[1].init.body))).toEqual({ url: "https://www.deepseek.com/docs" });
    expect(fetchResult.details).toEqual({
      source: "DeepSeek Fetch",
      url: "https://www.deepseek.com/docs",
      title: "Fetched page",
      content: "# Full page\n\nBody.",
    });
  });

  it("rejects malformed or oversized DeepSeek Search responses before exposing empty evidence", async () => {
    const { createToolDefinitions } = require("../../electron/research-agent-tools.cjs");
    const makeSearch = (fetchImpl: any) => createToolDefinitions({
      getContext: () => context,
      service: { provider: "deepseek", apiKey: "deepseek-test-key", baseUrl: "https://api.deepseek.com" },
      fetchImpl,
    }).find((tool: any) => tool.name === "search_web");

    await expect(makeSearch(async () => new Response("{}")).execute("malformed", { query: "DeepSeek" }))
      .rejects.toThrow("响应格式");
    const oversized = JSON.stringify({
      results: [{ title: "Large", url: "https://example.com", content: "x".repeat(600_000) }],
    });
    await expect(makeSearch(async () => new Response(oversized)).execute("oversized", { query: "DeepSeek" }))
      .rejects.toThrow("响应过大");
  });

  it("retries transient DeepSeek Search failures and times out a stalled request", async () => {
    const { createToolDefinitions } = require("../../electron/research-agent-tools.cjs");
    let attempts = 0;
    const retryTools = createToolDefinitions({
      getContext: () => context,
      service: { provider: "deepseek", apiKey: "deepseek-test-key", baseUrl: "https://api.deepseek.com" },
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 429 });
        return new Response(JSON.stringify({ results: [] }));
      },
    });
    await expect(retryTools.find((tool: any) => tool.name === "search_web").execute("retry", { query: "DeepSeek" }))
      .resolves.toMatchObject({ details: { results: [] } });
    expect(attempts).toBe(2);

    const stalled = createToolDefinitions({
      getContext: () => context,
      service: { provider: "deepseek", apiKey: "deepseek-test-key", baseUrl: "https://api.deepseek.com", searchTimeoutMs: 10 },
      fetchImpl: async (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }),
    });
    const request = stalled.find((tool: any) => tool.name === "search_web").execute("stalled", { query: "DeepSeek" });
    await expect(Promise.race([
      request,
      new Promise((_, reject) => setTimeout(() => reject(new Error("test did not time out")), 100)),
    ])).rejects.toThrow("超时");
  });

  it("redacts the configured model key from native web tool failures", async () => {
    const events: any[] = [];
    const key = "deepseek-secret";
    const runtime = createResearchAgentRuntime({
      emit: (event: any) => events.push(event),
      fetchImpl: async () => { throw new Error(`upstream leaked ${key}`); },
      piSessionFactory: async ({ tools }: any) => ({
        prompt: async () => tools.find((tool: any) => tool.name === "search_web").execute("web", { query: "DeepSeek" }),
        abort: async () => {},
        dispose: () => {},
      }),
    });
    await runtime.start(context, { aiProvider: "deepseek", deepseek: { apiKey: key, baseUrl: "https://api.deepseek.com" } });
    await runtime.prompt("联网搜索");
    expect(events.find((event) => event.type === "tool_end")?.tool.error).toBe("upstream leaked [已隐藏]");
    runtime.dispose();
  });

  it("passes restored text history to Pi and keeps identical block IDs in different library papers distinct", async () => {
    const events: any[] = [];
    const history = [{ type: "message", message: { id: "old", role: "user", content: "旧问题" } }];
    const factory = vi.fn(async ({ tools, emit }: any) => ({
      prompt: async () => {
        const read = tools.find((tool: any) => tool.name === "read_current_paper");
        const a = await read.execute("r1", { paperId: "p1" });
        const b = await read.execute("r2", { paperId: "p2" });
        expect(a.details.paper.blocks[0].referenceId).toBe("p1::same");
        expect(b.details.paper.blocks[0].referenceId).toBe("p2::same");
        emit({ type: "message_end", message: { id: "a", role: "assistant", content: "对比[引用:p1::same]与[引用:p2::same]，不采信[引用:same]。" } });
      }, abort: async () => {}, dispose: () => {},
    }));
    const runtime = createResearchAgentRuntime({ emit: (event: any) => events.push(event), piSessionFactory: factory,
      readLibraryPaper: async (paper: any) => ({ ...paper, blocks: [{ id: "same", pageNumber: 1, text: "Evidence." }] }) });
    await runtime.start({ scope: "library", library: [{ id: "p1", title: "One" }, { id: "p2", title: "Two" }] },
      { aiProvider: "deepseek", deepseek: { apiKey: "synthetic-placeholder" } }, history);
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ history, scope: "library" }));
    await runtime.prompt("对比");
    expect(events.at(-2).message.citations.map((item: any) => [item.paperId, item.referenceId])).toEqual([["p1", "p1::same"], ["p2", "p2::same"]]);
    runtime.dispose();
  });
  it("binds final answer references to actually returned blocks and clears evidence after changing context", async () => {
    const events: any[] = [];
    let read = false;
    const runtime = createResearchAgentRuntime({
      emit: (event: any) => events.push(event),
      piSessionFactory: async ({ tools, emit }: any) => ({
        prompt: async () => {
          if (read) await tools.find((tool: any) => tool.name === "read_current_paper").execute("read", {});
          emit({ type: "message_end", message: { id: "answer", role: "assistant",
            content: "来源[引用:block-1]，猜测[引用:missing]。" } });
        }, abort: async () => {}, dispose: () => {},
      }),
    });
    await runtime.start(context, { aiProvider: "deepseek", deepseek: { apiKey: "synthetic-placeholder" } });
    await runtime.prompt("没有读取");
    expect(events.at(-2).message.citations).toEqual([]);
    read = true;
    await runtime.prompt("读取原文");
    expect(events.at(-2).message.citations).toEqual([{ paperId: "paper-1", blockId: "block-1", pageNumber: 1, label: "第 1 页" }]);
    runtime.updateContext({ ...context, paper: { ...context.paper, blocks: [] } });
    read = false;
    await runtime.prompt("已更换解析");
    expect(events.at(-2).message.citations).toEqual([]);
    runtime.dispose();
  });

  it("invalidates approvals and the session when its worker reports a failure", async () => {
    const events: any[] = [];
    let failWorker: (reason: string) => void = () => {};
    const runtime = createResearchAgentRuntime({
      emit: (event: any) => events.push(event),
      fetchImpl: metadataFetch,
      piSessionFactory: async ({ onFailure, tools }: any) => {
        failWorker = onFailure;
        const add = tools.find((tool: any) => tool.name === "add_paper_to_library");
        return { prompt: async () => {
          const result = await tools.find((tool: any) => tool.name === "search_literature").execute("search", { query: "new" });
          return add.execute("approval", { candidateId: result.details.papers[0].candidateId });
        },
          abort: async () => {}, dispose: () => {} };
      },
    });
    await runtime.start(context, { aiProvider: "deepseek", deepseek: { apiKey: "synthetic-placeholder" } });
    const pending = runtime.prompt("加入论文");
    await vi.waitFor(() => expect(events.some((event) => event.type === "approval_required")).toBe(true));
    failWorker("worker crashed");
    await pending;
    expect(events.at(-1)).toMatchObject({ type: "agent_error", recoverable: false });
    expect(runtime.approve({ approvalId: events.find((event) => event.type === "approval_required").approvalId, approved: true })).toBe(false);
    await expect(runtime.prompt("重试")).rejects.toThrow("Agent 尚未启动");
    runtime.dispose();
  });

  it("cancels a Pi worker initialization when the runtime is disposed", async () => {
    let started = false, aborted = false;
    const runtime = createResearchAgentRuntime({
      emit: () => {},
      piSessionFactory: ({ signal }: any) => new Promise((_resolve, reject) => {
        started = true;
        signal.addEventListener("abort", () => { aborted = true; reject(new Error("启动已取消")); }, { once: true });
      }),
    });
    const starting = runtime.start(context, { aiProvider: "deepseek", deepseek: { apiKey: "synthetic-placeholder" } });
    await vi.waitFor(() => expect(started).toBe(true));
    runtime.dispose();
    await expect(starting).rejects.toThrow("启动已取消");
    expect(aborted).toBe(true);
  });

  it("runs a multi-turn Pi session through tools, confirmation and document generation", async () => {
    const events: any[] = [];
    let tools: any[] = [];
    let searchOutput: any;
    const runtime = createResearchAgentRuntime({ emit: (event: any) => {
      events.push(event);
      if (event.type === "approval_required") {
        queueMicrotask(() => runtime.approve({ approvalId: event.approvalId, approved: true,
          result: { persisted: true, id: "saved-paper", duplicate: false, kind: "metadata" } }));
      }
    }, fetchImpl: async () => ({ ok: true, json: async () => ({ message: { items: [
      { title: ["Attention paper"], DOI: "10.1234/attention", author: [], published: { "date-parts": [[2024]] },
        URL: "https://doi.org/10.1234/attention" },
      { title: ["Evidence paper"], DOI: "10.1234/evidence", author: [], published: { "date-parts": [[2023]] },
        URL: "https://doi.org/10.1234/evidence" },
    ] } }) }), piSessionFactory: async ({ tools: registeredTools, emit }: any) => {
      tools = registeredTools;
      const byName = (name: string) => tools.find((tool) => tool.name === name);
      const call = async (name: string, input: any = {}) => byName(name).execute(`call-${name}`, input);
      return {
        prompt: async (prompt: string) => {
          const messageId = `message-${events.filter((event) => event.type === "message_end").length + 1}`;
          if (prompt.includes("查找")) {
            await call("read_current_paper");
            searchOutput = await call("search_literature", { query: "attention", limit: 2 });
            emit({ type: "message_delta", messageId, delta: "已读取论文并完成文献检索。" });
          } else if (prompt.includes("加入")) {
            await call("read_current_paper");
            await call("add_paper_to_library", searchOutput.details.papers[0]);
            emit({ type: "message_delta", messageId, delta: "已处理加入文献库的请求。" });
          } else {
            await call("read_current_paper");
            await call("create_document", { title: "阅读笔记", markdown: "# 阅读笔记\n\nAttention selects relevant features." });
            emit({ type: "message_delta", messageId, delta: "已生成阅读笔记草稿。" });
          }
          emit({ type: "message_end", message: { id: messageId, role: "assistant", content: "已完成本轮研究任务。" } });
        },
        abort: async () => {},
        dispose: () => {},
      };
    } });
    await runtime.start(context, { aiProvider: "deepseek", deepseek: { apiKey: "synthetic-test-placeholder" } });
    await runtime.prompt("查找相关论文");
    await runtime.prompt("把第1篇加入文献库");
    await runtime.prompt("生成一份阅读笔记文档");
    expect(events.filter((event) => event.type === "tool_end").map((event) => event.tool.name))
      .toEqual(["read_current_paper", "search_literature", "read_current_paper", "add_paper_to_library", "read_current_paper", "create_document"]);
    expect(events.find((event) => event.type === "approval_required").paper.title).toBe("Attention paper");
    expect(events.filter((event) => event.type === "message_end")).toHaveLength(3);
    expect(events.find((event) => event.type === "tool_end" && event.tool.name === "create_document").tool.output.document.markdown)
      .toContain("Attention selects");
    runtime.dispose();
  });

  it("rejects invalid context and cancels a pending approval without hanging", async () => {
    expect(() => normalizeContext({ paper: { ...context.paper, blocks: new Array(2001).fill(context.paper.blocks[0]) } }))
      .toThrow("阅读块");
    const events: any[] = [];
    let addTool: any;
    const runtime = createResearchAgentRuntime({
      emit: (event: any) => events.push(event),
      fetchImpl: metadataFetch,
      piSessionFactory: async ({ tools }: any) => {
        addTool = tools.find((tool: any) => tool.name === "add_paper_to_library");
        return { prompt: async () => {
          const result = await tools.find((tool: any) => tool.name === "search_literature").execute("search", { query: "new" });
          return addTool.execute("pending", { candidateId: result.details.papers[0].candidateId });
        }, abort: async () => {}, dispose: () => {} };
      },
    });
    await runtime.start(context, { aiProvider: "deepseek", deepseek: { apiKey: "synthetic-test-placeholder" } });
    const pending = runtime.prompt("加入第1篇");
    await vi.waitFor(() => expect(events.some((event) => event.type === "approval_required")).toBe(true));
    await runtime.abort();
    const ended = events.length;
    await pending;
    expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);
    expect(events.slice(ended)).toEqual([]);
    runtime.dispose();
  });

  it.each([false, true])("makes confirmed additions visible to subsequent library tools (existing=%s)", async (existing) => {
    let customTools: any[] = [];
    const runtime = createResearchAgentRuntime({
      fetchImpl: metadataFetch,
      piSessionFactory: async ({ tools }: any) => {
        customTools = tools;
        return { prompt: async () => {}, abort: async () => {}, dispose: () => {} };
      },
      emit: (event: any) => {
        if (event.type === "approval_required") queueMicrotask(() => runtime.approve({
          approvalId: event.approvalId, approved: true, result: { persisted: true, id: "added", duplicate: false, kind: "metadata" },
        }));
      },
    });
    await runtime.start({ ...context, library: existing
      ? [{ id: "added", title: "New finding", doi: "10.1234/old" }] : [] },
    { aiProvider: "deepseek", deepseek: { apiKey: "synthetic-placeholder" } });
    const candidate = (await customTools.find((tool) => tool.name === "search_literature").execute("search", { query: "new" })).details.papers[0];
    await customTools.find((tool) => tool.name === "add_paper_to_library").execute("add", { candidateId: candidate.candidateId });
    const result = await customTools.find((tool) => tool.name === "search_library").execute("search", { query: "10.1234/new" });
    expect(result.details.papers).toEqual([expect.objectContaining({ id: "added", title: "New finding", doi: "10.1234/new" })]);
    runtime.dispose();
  });

  it("searches real provider-shaped metadata without leaking raw response fields", async () => {
    const fetchImpl = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ message: { items: [
      { DOI: "10.1234/attention", title: ["Attention paper"], author: [{ given: "Ada", family: "Lovelace" }],
        published: { "date-parts": [[2024]] }, URL: "https://doi.org/10.1234/attention", abstract: "<p>A synthetic abstract.</p>" },
    ] } }) }));
    const result = await searchLiterature({ query: "attention", limit: 3 }, fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toContain("https://api.crossref.org/works?");
    expect(result.papers[0]).toMatchObject({ title: "Attention paper", authors: ["Ada Lovelace"], year: 2024, abstract: "A synthetic abstract." });
    await expect(searchLiterature({ query: "attention" }, async () => ({ ok: false, status: 429 })))
      .rejects.toThrow("429");
    expect(isUsablePaper({ title: "Figure 3: attention map", authors: [], year: null })).toBe(false);
  });

  it("ranks the exact arXiv paper above similarly titled Crossref records", async () => {
    const atom = `<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/1706.03762v7</id>
          <published>2017-06-12T17:57:34Z</published>
          <title>Attention Is All You Need</title>
          <summary>We propose a new architecture based on attention mechanisms.</summary>
          <author><name>Ashish Vaswani</name></author>
          <author><name>Noam Shazeer</name></author>
        </entry>
      </feed>`;
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://export.arxiv.org/api/query?")) {
        return new Response(atom, { headers: { "content-type": "application/atom+xml" } });
      }
      return new Response(JSON.stringify({ message: { items: [{
        title: ["Attention Is All You Need"], DOI: "10.9999/misindexed", author: [],
        published: { "date-parts": [[2025]] }, URL: "https://doi.org/10.9999/misindexed",
      }] } }), { headers: { "content-type": "application/json" } });
    });

    const result = await searchLiterature({ query: "Attention Is All You Need", limit: 5 }, fetchImpl as any);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.papers[0]).toMatchObject({
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani", "Noam Shazeer"],
      year: 2017,
      arxivId: "1706.03762v7",
      landingUrl: "https://arxiv.org/abs/1706.03762v7",
      source: "arXiv",
    });
    expect(result.papers).toHaveLength(1);
    expect(result.sources).toEqual(["arXiv", "Crossref"]);
    expect(() => parseArxivFeed('<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///secret">]><feed>&x;</feed>')).toThrow("无效");
  });

  it("reports partial source outages instead of implying both indexes answered", async () => {
    const result = await searchLiterature({ query: "verified topic" }, async (input: string | URL) => {
      if (String(input).startsWith("https://export.arxiv.org/")) return new Response("offline", { status: 503 });
      return new Response(JSON.stringify({ message: { items: [{
        title: ["Verified topic paper"], DOI: "10.1234/verified", author: [],
        published: { "date-parts": [[2024]] }, URL: "https://doi.org/10.1234/verified",
      }] } }), { headers: { "content-type": "application/json" } });
    });

    expect(result).toMatchObject({ sources: ["Crossref"], unavailableSources: ["arXiv"] });
  });

  it("binds add requests to a candidate returned by literature search", async () => {
    const { createToolDefinitions } = require("../../electron/research-agent-tools.cjs");
    const candidateStore = new Map();
    const emitApproval = vi.fn(async () => ({ approved: false }));
    const tools = createToolDefinitions({
      getContext: () => context,
      candidateStore,
      emitApproval,
      fetchImpl: async (input: string | URL) => String(input).startsWith("https://export.arxiv.org/")
        ? new Response(`<feed xmlns="http://www.w3.org/2005/Atom"><entry>
          <id>http://arxiv.org/abs/2401.01234v2</id><published>2024-01-03T00:00:00Z</published>
          <title>Verified work</title><summary>Abstract.</summary><author><name>Ada Author</name></author>
        </entry></feed>`, { headers: { "content-type": "application/atom+xml" } })
        : new Response(JSON.stringify({ message: { items: [] } }), { headers: { "content-type": "application/json" } }),
    });
    const search = tools.find((tool: any) => tool.name === "search_literature");
    const add = tools.find((tool: any) => tool.name === "add_paper_to_library");
    const candidate = (await search.execute("search", { query: "Verified work" })).details.papers[0];

    await expect(add.execute("invented", { ...candidate, candidateId: "not-from-search" }))
      .rejects.toThrow("检索结果");
    expect(emitApproval).not.toHaveBeenCalled();
    await add.execute("verified", candidate);
    expect(emitApproval).toHaveBeenCalledWith(expect.objectContaining({
      paper: expect.objectContaining({ title: "Verified work", arxivId: "2401.01234v2" }),
    }));
  });

  it("requires a real configured model and rejects empty document bodies", async () => {
    const factory = vi.fn();
    const runtime = createResearchAgentRuntime({ emit: () => {}, piSessionFactory: factory });
    await expect(runtime.start(context, { aiProvider: "deepseek", deepseek: { apiKey: "" } })).rejects.toThrow("模型密钥");
    expect(factory).not.toHaveBeenCalled();
    const { createToolDefinitions } = require("../../electron/research-agent-tools.cjs");
    const document = createToolDefinitions({ getContext: () => context }).find((tool: any) => tool.name === "create_document");
    await expect(document.execute("empty", {})).rejects.toThrow("模型生成的正文");
    const manyBlocks = { ...context, paper: { ...context.paper, blocks: Array.from({ length: 60 }, (_, index) => ({
      id: `block-${index}`, pageNumber: 1, text: "x".repeat(6000),
    })) } };
    const read = createToolDefinitions({ getContext: () => manyBlocks }).find((tool: any) => tool.name === "read_current_paper");
    const output = await read.execute("read", {});
    expect(output.details.paper.blocks.map((block: any) => block.text).join("").length).toBe(24000);
    expect(output.details.truncated).toBe(true);
    runtime.dispose();
  });

  it("bounds large library results while reporting total matches", async () => {
    const { createToolDefinitions, normalizeContext } = require("../../electron/research-agent-tools.cjs");
    const largeContext = normalizeContext({ ...context, library: Array.from({ length: 500 }, (_, index) => ({
      id: `p${index}`, title: `Attention ${"x".repeat(480)}`, authors: Array(20).fill("A".repeat(120)),
      year: 2024, doi: `10.1234/${index}`,
    })) });
    const search = createToolDefinitions({ getContext: () => largeContext }).find((tool: any) => tool.name === "search_library");
    const { details } = await search.execute("large", { query: "attention" });
    expect(details.totalMatches).toBe(500);
    expect(details.truncated).toBe(true);
    expect(details.papers.length).toBeGreaterThan(0);
    expect(JSON.stringify(details).length).toBeLessThan(100_000);
  });

  it("matches combined author, year and non-contiguous title keywords", async () => {
    const { createToolDefinitions } = require("../../electron/research-agent-tools.cjs");
    const search = createToolDefinitions({ getContext: () => ({ ...context, library: [{
      id: "shaw", title: "Self-Attention with Relative Position Representations",
      authors: ["Peter Shaw"], year: 2018, doi: "10.18653/v1/n18-2074",
    }] }) }).find((tool: any) => tool.name === "search_library");
    for (const query of ["Shaw 2018 Self-Attention with Relative Position Representations", "Self-Attention Relative Position"]) {
      expect((await search.execute("query", { query })).details.papers).toHaveLength(1);
    }
    expect((await search.execute("query", { query: "Shaw 2024" })).details.papers).toHaveLength(0);
  });

  it("ignores model-supplied metadata and requires a persisted receipt before reporting an addition", async () => {
    const { createToolDefinitions } = require("../../electron/research-agent-tools.cjs");
    const emitApproval = vi.fn(async (_request: any): Promise<any> => ({ approved: false }));
    const candidateStore = new Map([["verified", { title: "A paper", authors: [], year: 2024, landingUrl: "doi.org/10.1234/example" }]]);
    const add = createToolDefinitions({ getContext: () => context, emitApproval, candidateStore }).find((tool: any) => tool.name === "add_paper_to_library");
    await add.execute("doi", { candidateId: "verified", title: "Invented", landingUrl: "javascript:alert(1)" });
    expect(emitApproval.mock.calls[0][0].paper.landingUrl).toBe("https://doi.org/10.1234/example");
    expect(emitApproval.mock.calls[0][0].paper.title).toBe("A paper");
    emitApproval.mockResolvedValueOnce({ approved: true, result: { id: "not-confirmed", duplicate: false } });
    await expect(add.execute("missing-receipt", { candidateId: "verified" })).rejects.toThrow("已保存回执");
    emitApproval.mockResolvedValueOnce({ approved: true, result: { persisted: true, id: "saved", duplicate: false, kind: "metadata" } });
    expect((await add.execute("saved", { candidateId: "verified" })).details).toMatchObject({
      status: "added", result: { persisted: true, id: "saved", kind: "metadata" },
    });
  });
});
