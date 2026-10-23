import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { callModel, streamModel } = require("../../electron/ai.cjs");
const { DEFAULT } = require("../../electron/settings.cjs");

function sseResponse(data: string) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

describe("real translation transport", () => {
  it("extracts vocabulary from only the selected paragraph with streaming and thinking disabled", async () => {
    for (const provider of ["deepseek", "aliyun"]) {
      const settings = { ...DEFAULT, aiProvider: provider, [provider]: { ...DEFAULT[provider], apiKey: "unit-test-secret" } };
      const fetchImpl = vi.fn().mockResolvedValue(sseResponse('{"choices":[{"delta":{"content":"{}"}}]}'));
      await callModel(settings, { operation: "vocabulary",
        paper: { blockData: [{ id: "before", text: "UNRELATED hypothesis" }, { id: "selected", text: "Attention weighs features." }] },
        block: { id: "selected", kind: "paragraph", text: "Attention weighs features." },
      }, fetchImpl);
      const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
      if (provider === "deepseek") expect(body.thinking).toEqual({ type: "disabled" });
      else expect(body.enable_thinking).toBe(false);
      expect(body.messages[1].content).toContain("Attention weighs features.");
      expect(body.messages[1].content).not.toContain("UNRELATED");
      expect(body.messages[0].content).toContain("当前段落");
    }
  });

  it("streams paragraph insight with thinking disabled on both providers", async () => {
    for (const provider of ["deepseek", "aliyun"]) {
      const settings = { ...DEFAULT, aiProvider: provider, [provider]: { ...DEFAULT[provider], apiKey: "unit-test-secret" } };
      const fetchImpl = vi.fn().mockResolvedValue(sseResponse('{"choices":[{"delta":{"content":"{}"}}]}'));
      await callModel(settings, { operation: "insight", paper: {}, block: { text: "Attention weighs features." } }, fetchImpl);
      const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
      if (provider === "deepseek") expect(body.thinking).toEqual({ type: "disabled" });
      else expect(body.enable_thinking).toBe(false);
    }
  });
  it("disables thinking specifically for translations on each configured provider", async () => {
    for (const provider of ["deepseek", "aliyun"]) {
      const settings = { ...DEFAULT, aiProvider: provider, [provider]: { ...DEFAULT[provider], apiKey: "unit-test-secret" } };
      const fetchImpl = vi.fn().mockResolvedValue(sseResponse('{"choices":[{"delta":{"content":"你好"}}]}'));
      await callModel(settings, { operation: "translate", paper: {}, block: { text: "Hello" } }, fetchImpl);
      const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
      if (provider === "deepseek") expect(body.thinking).toEqual({ type: "disabled" });
      else expect(body.enable_thinking).toBe(false);
    }
  });

  it("adds an extremely plain-language instruction to grandma-mode paragraph requests", async () => {
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse('{"choices":[{"delta":{"content":"用大白话解释"}}]}'));
    await callModel(settings, {
      operation: "explain",
      readingMode: "grandma",
      paper: {},
      block: { text: "Attention weighs features." },
    }, fetchImpl);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain("祖母模式");
    expect(body.messages[0].content).toContain("极通俗");
    expect(body.messages[0].content).toContain("不要假设读者熟悉专业术语");
    expect(body.messages[0].content).toContain("先用一句话说清楚");
    expect(body.messages[0].content).toContain("复杂句要拆开");
    expect(body.messages[0].content).toContain("通俗不等于删减");
  });

  it("rejects the removed whole-paper overview operation before a model call", async () => {
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    const fetchImpl = vi.fn();
    await expect(callModel(settings, { operation: "overview", paper: {} }, fetchImpl)).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("disables thinking for short paragraph explanations on each configured provider", async () => {
    for (const provider of ["deepseek", "aliyun"]) {
      const settings = { ...DEFAULT, aiProvider: provider, [provider]: { ...DEFAULT[provider], apiKey: "unit-test-secret" } };
      const fetchImpl = vi.fn().mockResolvedValue(sseResponse('{"choices":[{"delta":{"content":"解释"}}]}'));
      await callModel(settings, { operation: "explain", paper: {}, block: { text: "A paragraph." } }, fetchImpl);
      const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
      if (provider === "deepseek") expect(body.thinking).toEqual({ type: "disabled" });
      else expect(body.enable_thinking).toBe(false);
    }
  });

  it("never presents reasoning-only output as a translation", async () => {
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    const deltas: string[] = [];
    await expect(streamModel(settings, { operation: "translate", paper: {}, block: { text: "Hello" } },
      (delta: string) => deltas.push(delta),
      vi.fn().mockResolvedValue(sseResponse('{"choices":[{"delta":{"reasoning_content":"I should translate this."},"finish_reason":"length"}]}'))))
      .rejects.toThrow("截断");
    expect(deltas).toEqual([]);
  });

  it("rejects truncated translations instead of caching partial output", async () => {
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    await expect(callModel(settings, { operation: "translate", paper: {}, block: { text: "Hello" } },
      vi.fn().mockResolvedValue(sseResponse('{"choices":[{"delta":{"content":"不完整"},"finish_reason":"length"}]}'))))
      .rejects.toThrow("截断");
  });

  it("rejects a prematurely closed stream and non-success finish reasons", async () => {
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    for (const finishReason of [null, "aborted", "content_filter"]) {
      const encoder = new TextEncoder();
      const response = new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "部分译文" }, finish_reason: finishReason }] })}\n\n`));
          controller.close();
        },
      }));
      await expect(callModel(settings, { operation: "translate", paper: {}, block: { text: "Hello" } }, vi.fn().mockResolvedValue(response))).rejects.toThrow(/中断|未正常完成/);
    }
  });

  it("does not expose reasoning as translation even after a normal finish", async () => {
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    await expect(callModel(settings, { operation: "translate", paper: {}, block: { text: "Hello" } },
      vi.fn().mockResolvedValue(sseResponse('{"choices":[{"delta":{"reasoning_content":"Plan a translation"},"finish_reason":"stop"}]}')))).rejects.toThrow("译文");
  });

  it("rejects malformed SSE data instead of silently losing part of the translation", async () => {
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"首段"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta": BROKEN\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"末段"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    }));
    await expect(callModel(settings, { operation: "translate", paper: {}, block: { text: "Hello" } }, vi.fn().mockResolvedValue(response))).rejects.toThrow("流式响应");
  });

  it("reads a local chart image alongside extracted table data and nearby paragraphs", async () => {
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse('{"choices":[{"delta":{"content":"{}"}}]}'));
    const imageDataUrl = "data:image/png;base64,aGVsbG8=";
    await callModel(settings, { operation: "chart", imageDataUrl,
      paper: { blockData: [{ id: "before", text: "The experiment evaluates retrieval." }, { id: "table", text: "RAG 44.5", kind: "table" }] },
      block: { id: "table", kind: "table", text: "RAG 44.5", caption: "Table 1. Scores", pageNumber: 6 },
    }, fetchImpl);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.messages[1].content).toEqual([
      { type: "text", text: expect.stringContaining("RAG 44.5") },
      { type: "image_url", image_url: { url: imageDataUrl } },
    ]);
    expect(body.messages[1].content[0].text).toContain("Table 1. Scores");
    expect(body.messages[1].content[0].text).toContain("The experiment");
    expect(body.messages[0].content).toContain("findings");
  });

  it("reads an extracted equation with nearby paragraphs without requiring an image", async () => {
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse('{"choices":[{"delta":{"content":"{}"}}]}'));
    await callModel(settings, {
      operation: "equation",
      paper: {
        blockData: [
          { id: "before", text: "The loss is minimized over the training set." },
          { id: "formula", kind: "equation", text: String.raw`L(\theta)=\sum_i \ell(f_\theta(x_i), y_i)` },
          { id: "after", text: "We optimize the parameters with gradient descent." },
        ],
      },
      block: { id: "formula", kind: "equation", text: String.raw`L(\theta)=\sum_i \ell(f_\theta(x_i), y_i)`, pageNumber: 4 },
    }, fetchImpl);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain(String.raw`L(\theta)=\sum_i \ell(f_\theta(x_i), y_i)`);
    expect(body.messages[1].content).toContain("gradient descent");
    expect(body.messages[0].content).toContain("variables");
    expect(body.messages[1].content).not.toEqual(expect.arrayContaining([{ type: "image_url" }]));
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("does not translate visual blocks or accept remote chart image URLs", async () => {
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    const fetchImpl = vi.fn();
    await expect(callModel(settings, { operation: "translate", paper: {}, block: { kind: "table", text: "A 1" } }, fetchImpl)).rejects.toThrow("读图表");
    await expect(callModel(settings, { operation: "translate", paper: {}, block: { kind: "equation", text: "x+y" } }, fetchImpl)).rejects.toThrow("解读公式");
    await expect(callModel(settings, { operation: "chart", paper: {}, block: { kind: "image" }, imageDataUrl: "https://example.com/image.png" }, fetchImpl)).rejects.toThrow("图片");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("translates the selected text with paragraph context and returns actual output", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse('{"choices":[{"delta":{"content":"这是第二句话。"}}]}'));
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    const text = await callModel(settings, {
      operation: "translate",
      paper: { blockData: [{ id: "b1", text: "First sentence. Second sentence." }] },
      block: { id: "b1", text: "Second sentence." },
    }, fetchImpl);
    expect(text).toBe("这是第二句话。");
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain("待翻译内容：\nSecond sentence.");
    expect(body.messages[1].content).toContain("First sentence. Second sentence.");
  });
  it("reports a useful error without exposing a response body containing a key", async () => {
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    await expect(callModel(settings, { operation: "translate", block: { text: "Hello" }, paper: {} },
      vi.fn().mockResolvedValue(new Response("unit-test-secret", { status: 401 })))).rejects.toThrow("密钥");
  });
  it("accepts structured content returned in a reasoning field by compatible models", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse('{"choices":[{"delta":{"reasoning_content":"{\\"summary\\":\\"摘要\\",\\"role\\":\\"承上启下\\"}"}}]}'));
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    await expect(callModel(settings, { operation: "insight", paper: {}, block: { text: "A paragraph." } }, fetchImpl)).resolves.toContain("summary");
  });

  it("requests SSE and emits deltas before the response stream completes", async () => {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(next) { controller = next; },
    }), { headers: { "Content-Type": "text/event-stream" } }));
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    const deltas: string[] = [];
    const complete = streamModel(settings, {
      operation: "translate",
      paper: {},
      block: { id: "b1", text: "Hello" },
    }, (delta: string) => deltas.push(delta), fetchImpl);

    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"首"}}]}\n\n'));
    await vi.waitFor(() => expect(deltas).toEqual(["首"]));
    expect(fetchImpl.mock.calls[0][1].body).toContain('"stream":true');

    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"token"}}]}\n\n'));
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    controller.close();
    await expect(complete).resolves.toBe("首token");
  });

  it("streams all AI operations through the same OpenAI-compatible request mode", async () => {
    const encoder = new TextEncoder();
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    for (const operation of ["translate", "qa", "explain", "insight", "guide"]) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"x"}}]}\n\n'));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ));
      await streamModel(settings, { operation, paper: {}, block: { text: "Text" } }, () => undefined, fetchImpl);
      expect(JSON.parse(fetchImpl.mock.calls[0][1].body).stream, operation).toBe(true);
    }
  });
});

describe("paper wiki requests", () => {
  const paper = {
    title: "A Structured Paper",
    blockData: [
      { id: "p001-b001", pageNumber: 1, kind: "heading", headingLevel: 1, text: "Introduction" },
      { id: "p001-b002", pageNumber: 1, kind: "paragraph", text: "We study the problem of X." },
      { id: "p002-b001", pageNumber: 2, kind: "paragraph", text: "Our method uses Y." },
    ],
  };

  it("builds the assembly prompt from part overview and opening text only", async () => {
    const richPaper = {
      title: "A Structured Paper",
      blockData: [
        ...paper.blockData,
        { id: "p003-b001", pageNumber: 3, kind: "paragraph", text: "Experiments confirm the approach." },
        { id: "p004-b001", pageNumber: 4, kind: "paragraph", text: "Limitations remain in noisy settings." },
      ],
    };
    for (const provider of ["deepseek", "aliyun"]) {
      const settings = { ...DEFAULT, aiProvider: provider, [provider]: { ...DEFAULT[provider], apiKey: "unit-test-secret" } };
      const fetchImpl = vi.fn().mockResolvedValue(sseResponse('{"choices":[{"delta":{"content":"{}"}}]}'));
      await callModel(settings, {
        operation: "wiki-thread",
        paper: richPaper,
        wikiParts: [
          { id: "part-pre", title: "开篇" },
          { id: "p001-b001", title: "Introduction", headings: ["Background"], firstBlockIds: ["p001-b002"] },
          { id: "p002-b001", title: "Method" },
        ],
      }, fetchImpl);
      const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
      const system = body.messages[0].content;
      const user = body.messages[1].content;
      expect(system).toContain("anchorBlockIds");
      expect(system).toContain("论证主线");
      expect(system).toContain("语义标题");
      expect(user).toContain("[部分 p001-b001] Introduction（含：Background）");
      expect(user).toContain("id 必须原样引用");
      expect(user).toContain("[p001-b002 | 第1页] We study the problem of X.");
      expect(user).toContain("[部分 p001-b001 开头 | p001-b002]");
      expect(user).not.toContain("Limitations remain in noisy settings."); // 开篇之外的长尾正文不进装配上下文
      expect(body.max_tokens).toBe(2500);
      if (provider === "deepseek") expect(body.thinking).toEqual({ type: "disabled" });
      else expect(body.enable_thinking).toBe(false);
    }
  });

  it("restricts part context to the passed part blocks", async () => {
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse('{"choices":[{"delta":{"content":"{}"}}]}'));
    await callModel(settings, {
      operation: "wiki-part",
      paper: { title: "Part Paper", blockData: paper.blockData.slice(0, 2) },
      wikiPart: { id: "p001-b001", title: "Introduction" },
    }, fetchImpl);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const system = body.messages[0].content;
    const user = body.messages[1].content;
    expect(system).toContain("两级要点树");
    expect(system).toContain("只能从本部分输入的方括号 ID");
    expect(user).toContain("当前部分：Introduction（id: p001-b001）");
    expect(user).toContain("[p001-b002 | 第1页 | paragraph]");
    expect(user).not.toContain("Our method uses Y.");
    expect(body.max_tokens).toBe(3000);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("extracts library knowledge entries from the whole paper", async () => {
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse('{"choices":[{"delta":{"content":"{}"}}]}'));
    await callModel(settings, { operation: "wiki-knowledge", paper }, fetchImpl);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const system = body.messages[0].content;
    const user = body.messages[1].content;
    expect(system).toContain("知识库助手");
    expect(system).toContain("concept|method");
    expect(system).toContain("单篇特有的实验数值结论、局限、背景不提取");
    expect(user).toContain("[p001-b002 | 第1页 | paragraph]");
    expect(user).toContain("Our method uses Y.");
    expect(body.max_tokens).toBe(2000);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("refuses wiki requests without blocks or a valid part", async () => {
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    const fetchImpl = vi.fn();
    await expect(callModel(settings, { operation: "wiki-thread", paper: { title: "Empty", blockData: [] } }, fetchImpl))
      .rejects.toThrow(/没有可分析的正文块/);
    await expect(callModel(settings, { operation: "wiki-part", paper, wikiPart: { id: "", title: "" } }, fetchImpl))
      .rejects.toThrow(/有效的部分/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("truncates long part blocks but keeps heading text", async () => {
    const settings = { ...DEFAULT, aiProvider: "deepseek", deepseek: { ...DEFAULT.deepseek, apiKey: "unit-test-secret" } };
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse('{"choices":[{"delta":{"content":"{}"}}]}'));
    const longText = "A".repeat(2000);
    await callModel(settings, {
      operation: "wiki-part",
      paper: { title: "Long", blockData: [
        { id: "p001-b001", pageNumber: 1, kind: "heading", headingLevel: 2, text: "Short heading" },
        { id: "p001-b002", pageNumber: 1, kind: "paragraph", text: longText },
      ] },
      wikiPart: { id: "p001-b001", title: "Short heading" },
    }, fetchImpl);
    const user = JSON.parse(fetchImpl.mock.calls[0][1].body).messages[1].content;
    expect(user).toContain("Short heading");
    expect(user).not.toContain("A".repeat(401));
  });
});
