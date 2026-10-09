import { describe, expect, it } from "vitest";
import {
  buildChatCompletionsUrl,
  getChatCompletionText,
} from "../../src/services/providerProtocol";

describe("provider protocol helpers", () => {
  it("normalizes OpenAI-compatible base URLs", () => {
    expect(buildChatCompletionsUrl("https://api.deepseek.com")).toBe(
      "https://api.deepseek.com/chat/completions",
    );
    expect(buildChatCompletionsUrl("https://example.com/v1/")).toBe(
      "https://example.com/v1/chat/completions",
    );
    expect(buildChatCompletionsUrl("https://example.com/v1/chat/completions")).toBe(
      "https://example.com/v1/chat/completions",
    );
  });

  it("extracts the first assistant message and rejects malformed responses", () => {
    expect(getChatCompletionText({ choices: [{ message: { content: "回答" } }] })).toBe("回答");
    expect(() => getChatCompletionText({ choices: [] })).toThrow("没有返回可用内容");
  });
});
