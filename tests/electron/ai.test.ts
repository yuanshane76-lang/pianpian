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
    for (const operation of ["overview", "translate", "qa", "explain", "insight", "guide"]) {
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
