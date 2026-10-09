const { DEFAULT } = require("./settings.cjs");

const OPERATIONS = ["overview", "translate", "qa", "explain", "insight", "guide"];

function prepareModelRequest(settings, request) {
  const provider = settings.aiProvider;
  if (!["aliyun", "deepseek"].includes(provider)) throw new Error("请在服务配置中启用百炼或 DeepSeek");
  const service = settings[provider];
  if (!service?.apiKey) throw new Error("当前模型服务未配置密钥");
  if (!request || !OPERATIONS.includes(request.operation)) throw new Error("不支持的分析请求");
  if (JSON.stringify(request).length > 5_000_000) throw new Error("论文上下文过大");

  const blocks = Array.isArray(request.paper?.blockData) ? request.paper.blockData : [];
  const selectedIndex = blocks.findIndex((block) => block.id === request.block?.id);
  const isSelection = ["translate", "explain", "insight"].includes(request.operation);
  const structured = request.operation === "insight" || request.operation === "guide";
  const contextLimit = request.operation === "guide" ? 80000 : 180000;
  const context = (isSelection
    ? blocks.slice(Math.max(0, selectedIndex - 1), selectedIndex + 2)
      .map((block) => String(block.text ?? "").slice(0, 2500)).join("\n").slice(0, 6000)
    : blocks.map((block) => `[第 ${block.pageNumber ?? "?"} 页] ${String(block.text ?? "")}`).join("\n").slice(0, contextLimit));
  const instruction = request.operation === "insight"
    ? '帮助英文论文阅读困难的中文读者理解选中的段落。只返回 JSON 对象 {"summary":"用1-3句中文概括这段讲什么","role":"用2-4句中文说明这段在给定上下文中的作用、与前后段如何衔接"}。基于给定内容，不编造段落位置或论文结论。'
    : request.operation === "guide"
      ? '帮助中文读者开始阅读英文论文。只返回 JSON 对象 {"overview":"不超过120字的中文阅读指南，说明研究问题、方法和建议先读的部分","terms":[{"term":"原文中实际出现的英文词或术语","translation":"中文释义","definition":"本文语境下的简短解释"}]}。只选取6-8个最重要的学术词或论文专有术语，每个 term 必须逐字出现在正文。不要杜撰。'
      : request.operation === "overview"
        ? "用中文概括给定论文的研究问题、方法、主要发现和局限。仅根据论文，内容不足时说明。"
        : request.operation === "translate"
          ? "将待翻译内容译成自然、准确的中文。保留术语、公式和引文；只输出译文，不增添信息。"
          : request.operation === "explain"
            ? "用中文解释选中段落在论文中的意思、作用与重要术语，依据给定上下文，内容不足时说明。"
            : "用中文回答问题，注明相关论文页码，区分论文结论与推断。没有依据时说明。";
  const prompt = isSelection
    ? `论文上下文：\n${context}\n\n待${request.operation === "translate" ? "翻译" : "解释"}内容：\n${String(request.block?.text ?? "").slice(0, 15000)}`
    : `论文正文（最多开头 18 万字符，超出部分未提供）：\n${context}\n\n${request.operation === "qa" ? `问题：${String(request.question ?? "").slice(0, 2000)}` : request.operation === "guide" ? "请输出阅读指南和学术词汇 JSON。" : "请生成论文概览。"}`;

  return {
    provider,
    service,
    structured,
    body: {
      model: service.model,
      messages: [{ role: "system", content: instruction }, { role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: request.operation === "guide" ? 1800 : request.operation === "overview" ? 3000 : 2000,
      stream: true,
      ...(structured ? { thinking: { type: "disabled" } } : {}),
    },
  };
}

function deltaText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((item) => typeof item === "string" ? item : item?.text ?? "").join("");
}

async function streamModel(settings, request, onDelta = () => undefined, fetchImpl = fetch, signal) {
  const { provider, service, body } = prepareModelRequest(settings, request);
  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abortRequest, { once: true });
  const timeout = setTimeout(() => controller.abort(), 90000);
  let reader;
  try {
    const response = await fetchImpl(`${DEFAULT[provider].baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${service.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = response.status === 401 ? "密钥无效或已过期" : response.status === 402 ? "余额不足" : response.status === 429 ? "请求过于频繁或额度不足" : response.status === 400 ? "请检查模型名称与请求长度" : "请检查网络与服务状态";
      throw new Error(`模型服务 HTTP ${response.status}：${detail}`);
    }
    if (!response.body) throw new Error("模型服务没有返回流式响应");

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let frameData = [];
    let result = "";
    let reasoning = "";
    let done = false;

    function consumeFrame() {
      if (!frameData.length || done) { frameData = []; return; }
      const data = frameData.join("\n");
      frameData = [];
      if (data === "[DONE]") { done = true; return; }
      let payload;
      try { payload = JSON.parse(data); } catch { return; }
      const delta = payload?.choices?.[0]?.delta;
      const content = deltaText(delta?.content);
      if (content) {
        result += content;
        onDelta(content);
      } else if (typeof delta?.reasoning_content === "string") {
        reasoning += delta.reasoning_content;
      }
    }

    function consumeLines(final = false) {
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (!line) consumeFrame();
        else if (line.startsWith("data:")) frameData.push(line.slice(5).replace(/^ /, ""));
      }
      if (final) {
        if (buffer) {
          const line = buffer.replace(/\r$/, "");
          if (line.startsWith("data:")) frameData.push(line.slice(5).replace(/^ /, ""));
          buffer = "";
        }
        consumeFrame();
      }
    }

    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) {
        buffer += decoder.decode();
        consumeLines(true);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      consumeLines();
    }

    if (!result && reasoning) {
      result = reasoning;
      onDelta(reasoning);
    }
    if (!result.trim()) throw new Error("模型没有返回可用内容");
    return result.trim();
  } catch (cause) {
    if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
    if (controller.signal.aborted) throw new Error("模型请求超时，请重试或缩短所选段落");
    throw cause;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortRequest);
    reader?.releaseLock();
  }
}

async function callModel(settings, request, fetchImpl = fetch) {
  return streamModel(settings, request, () => undefined, fetchImpl);
}

module.exports = { callModel, streamModel };
