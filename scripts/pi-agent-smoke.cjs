const http = require("node:http");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createResearchAgentRuntime } = require(path.join(process.env.ZHIYAN_SMOKE_APP_ROOT || path.resolve(__dirname, ".."),
  "electron", "research-agent-runtime.cjs"));

function sendCompletion(response, delta, finishReason) {
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.write(`data: ${JSON.stringify({ id: "synthetic-completion", object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`);
  response.end("data: [DONE]\n\n");
}

async function main() {
  const requests = [];
  const events = [];
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw);
      requests.push(body);
      const turn = requests.length;
      const calls = [
        { name: "read_research_skill", arguments: '{"name":"paper-deep-reading"}' },
        { name: "read_current_paper", arguments: "{}" },
        { name: "search_literature", arguments: '{"query":"attention","limit":2}' },
        { name: "create_document", arguments: '{"title":"Evidence note","markdown":"# Evidence note\\n\\nThe synthetic paper supports this summary."}' },
      ];
      if (turn <= calls.length) {
        sendCompletion(response, { tool_calls: [{ index: 0, id: `call-${turn}`, type: "function", function: calls[turn - 1] }] }, "tool_calls");
      } else {
        sendCompletion(response, { content: "已读取论文、检索相关文献并生成笔记。[第 1 页]" }, "stop");
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const runtime = createResearchAgentRuntime({
    emit: (event) => events.push(event),
    fetchImpl: async () => ({ ok: true, json: async () => ({ message: { items: [
      { title: ["Synthetic related work"], DOI: "10.0000/synthetic", author: [], published: { "date-parts": [[2025]] } },
    ] } }) }),
  });
  try {
    await runtime.start({ paper: { id: "synthetic", title: "Synthetic paper", authors: [], year: 2025,
      blocks: [{ id: "synthetic-block", pageNumber: 1, text: "The paper studies attention and evidence." }] }, library: [] },
    { aiProvider: "deepseek", deepseek: { apiKey: "synthetic-test-placeholder", model: "synthetic", baseUrl: `http://127.0.0.1:${port}/v1` } });
    await runtime.prompt("读取论文，检索相关工作并生成笔记");
    assert.equal(requests.length, 5, JSON.stringify(events.filter((event) => event.type === "agent_error")));
    const names = requests[0].tools.map((tool) => tool.function.name).sort();
    assert.deepEqual(names, ["add_paper_to_library", "create_document", "fetch_web_page", "read_current_paper", "read_research_skill", "search_library", "search_literature", "search_web"]);
    assert(JSON.stringify(requests[0].messages).includes("paper-deep-reading"));
    assert(!JSON.stringify(requests[0].messages).includes("## 获取原文证据"));
    assert(JSON.stringify(requests[1].messages).includes("## 获取原文证据"));
    assert.equal(events.find((event) => event.type === "session_started").skills.length, 3);
    assert(events.some((event) => event.type === "message_end" && event.message.content.includes("生成笔记")));
    assert.deepEqual(events.filter((event) => event.type === "tool_end").map((event) => event.tool.name),
      ["read_research_skill", "read_current_paper", "search_literature", "create_document"]);
    assert.equal(events.filter((event) => event.type === "agent_error").length, 0);
    console.log(JSON.stringify({ passed: true, modelRequests: requests.length, tools: names,
      skillsLoaded: ["paper-deep-reading"],
      profile: "Real Pi SDK loads a bundled skill on demand, local synthetic SSE and synthetic Crossref response; zero external requests" }, null, 2));
  } finally {
    runtime.dispose();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
