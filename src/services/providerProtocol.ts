export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

export function getChatCompletionText(payload: unknown): string {
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> } | null)
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("模型没有返回可用内容");
  }
  return content.trim();
}

export async function callOpenAiCompatible(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): Promise<string> {
  if (!options.apiKey.trim()) throw new Error("尚未填写模型服务密钥");
  const response = await fetch(buildChatCompletionsUrl(options.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model.trim(),
      messages: options.messages,
      temperature: 0.2,
    }),
    signal: options.signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "error" in payload
      ? JSON.stringify(payload.error)
      : `HTTP ${response.status}`;
    throw new Error(`模型服务请求失败：${detail}`);
  }
  return getChatCompletionText(payload);
}
