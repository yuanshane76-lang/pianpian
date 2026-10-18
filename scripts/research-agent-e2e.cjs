const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function syntheticPdf() {
  const stream = "BT /F1 22 Tf 60 730 Td (Research Agent Fixture) Tj /F1 12 Tf 0 -60 Td " +
    "(The model uses attention to select useful features.) Tj 0 -20 Td " +
    "(An ablation study evaluates the model.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let data = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(data)); data += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(data);
  data += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  data += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return [...Buffer.from(data)];
}

if (process.versions.electron) {
  const { app, dialog, ipcMain } = require("electron");
  app.setPath("userData", process.env.ZHIYAN_AGENT_USER_DATA);
  app.setPath("sessionData", path.join(process.env.ZHIYAN_AGENT_USER_DATA, "session"));
  Object.defineProperty(app, "isPackaged", { value: true });
  const documents = require("../electron/document-store.cjs").createDocumentStore({
    rootDirectory: path.join(app.getPath("userData"), "documents"),
  });
  globalThis.publishAgentFixture = async (paper) => {
    await documents.saveParse(paper.originalId, { resultBatchId: "synthetic-agent", layoutVersion: 3,
      title: paper.title, blocks: paper.blockData, pageCount: 1 });
    await documents.saveTask(paper.originalId, { state: "done", batchId: "synthetic-agent", resultBatchId: "synthetic-agent" });
  };
  globalThis.agentRemoteRequests = 0;
  globalThis.arxivMineruStarts = 0;
  globalThis.agentTestRequests = [];
  globalThis.agentLifecycle = [];
  const nativeHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => nativeHandle(channel, async (...args) => {
    if (channel === "zhiyan:mineru:start") {
      const id = args[1];
      globalThis.arxivMineruStarts++;
      const batchId = "synthetic-arxiv-import";
      const result = { layoutVersion: 3, title: "Attention Is All You Need", pageCount: 1, blocks: [{
        id: "synthetic-arxiv-paragraph", kind: "paragraph", text: "Attention Is All You Need",
        pageNumber: 1, order: 0, bbox: [.1, .1, .9, .2],
        pageBounds: [{ pageNumber: 1, bbox: [.1, .1, .9, .2] }],
      }] };
      await documents.saveParse(id, { ...result, resultBatchId: batchId });
      await documents.saveTask(id, { state: "done", batchId, resultBatchId: batchId, progress: 1 });
      return { batchId };
    }
    if (channel === "zhiyan:mineru:status") {
      const id = args[1];
      const task = await documents.loadTask(id);
      const result = task?.resultBatchId === task?.batchId ? await documents.loadParse(id) : null;
      return result ? { state: "done", batchId: task.batchId, result } : { state: "idle" };
    }
    if (!["zhiyan:agent:start", "zhiyan:agent:abort"].includes(channel)) return handler(...args);
    const entry = { channel, startedAt: Date.now() };
    globalThis.agentLifecycle.push(entry);
    try { return await handler(...args); }
    finally { entry.completedAt = Date.now(); }
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("http://127.0.0.1:")) return nativeFetch(url, options);
    if (String(url).startsWith("https://api.crossref.org/works?")) return new Response(JSON.stringify({ message: { items: [
      { title: ["Synthetic attention paper"], DOI: "10.1234/attention", author: [{ given: "Synthetic", family: "Team" }],
        published: { "date-parts": [[2025]] }, URL: "https://doi.org/10.1234/attention" },
      { title: ["Synthetic evidence paper"], DOI: "10.1234/evidence", author: [],
        published: { "date-parts": [[2024]] }, URL: "https://doi.org/10.1234/evidence" },
    ] } }), { headers: { "content-type": "application/json" } });
    if (String(url).startsWith("https://export.arxiv.org/api/query?")) {
      const searchQuery = new URL(String(url)).searchParams.get("search_query") || "";
      const entry = searchQuery.toLowerCase().includes("attention is all you need")
        ? `<entry><id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T17:57:34Z</published>
          <title>Attention Is All You Need</title><summary>We propose a new architecture based on attention.</summary>
          <author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author></entry>`
        : "";
      return new Response(`<feed xmlns="http://www.w3.org/2005/Atom">${entry}</feed>`, {
        headers: { "content-type": "application/atom+xml" },
      });
    }
    if (String(url) === "https://arxiv.org/pdf/1706.03762v7") {
      return new Response(Buffer.from(syntheticPdf()), { headers: { "content-type": "application/pdf" } });
    }
    globalThis.agentRemoteRequests++;
    throw new Error("External services are disabled in this synthetic desktop test");
  };
  const server = require("node:http").createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", async () => {
      const body = JSON.parse(raw);
      globalThis.agentTestRequests.push(body.messages.map((message) => ({ role: message.role, content: ["user", "assistant"].includes(message.role) ? message.content : undefined, tool_call_id: message.tool_call_id })));
      const userIndex = body.messages.findLastIndex((message) => message.role === "user");
      const rawQuestion = body.messages[userIndex]?.content;
      const question = Array.isArray(rawQuestion)
        ? rawQuestion.map((part) => part?.text || "").join(" ")
        : String(rawQuestion || "");
      const toolMessages = body.messages.slice(userIndex + 1).filter((message) =>
        message.role === "tool" || message.role === "toolResult" || message.tool_call_id);
      const globalScope = body.messages.some((message) => message.role === "system" && String(message.content).includes("当前会话范围：整个本地文献库"));
      let retrievedPaperId;
      let candidateId;
      for (const message of toolMessages) {
        try {
          const result = JSON.parse(typeof message.content === "string" ? message.content : message.content?.map((part) => part.text || "").join(""));
          if (result.papers?.[0]?.id) retrievedPaperId = result.papers[0].id;
          if (result.papers?.[0]?.candidateId) candidateId = result.papers[0].candidateId;
        } catch { /* Synthetic non-search tool output. */ }
      }
      const taskCalls = question.includes("全库检索验收") ? [{ name: "search_library", arguments: '{"query":"ablation"}' },
        { name: "read_current_paper", arguments: JSON.stringify({ paperId: retrievedPaperId || "missing" }) }]
        : question.includes("滚动验收") ? []
        : question.includes("加入")
          ? [{ name: "search_literature", arguments: JSON.stringify({
            query: question.includes("Attention Is All You Need") ? "Attention Is All You Need" : "attention", limit: 2,
          }) }, { name: "add_paper_to_library", arguments: JSON.stringify({ candidateId: candidateId || "missing" }) }]
        : question.includes("文档")
          ? [{ name: "read_current_paper", arguments: "{}" },
            { name: "create_document", arguments: JSON.stringify({ title: "阅读笔记", markdown: "# 阅读笔记\n\nThe model uses attention. [第 1 页]" }) }]
          : question.includes("查找")
            ? [{ name: globalScope ? "search_library" : "read_current_paper", arguments: globalScope ? '{"query":"attention"}' : "{}" }, { name: "search_literature", arguments: '{"query":"attention","limit":2}' }]
            : globalScope ? [{ name: "search_library", arguments: '{"query":"attention"}' }] : [{ name: "read_current_paper", arguments: "{}" }];
      const skillName = question.includes("文档") ? "literature-comparison-notes"
        : question.includes("查找") ? "literature-search-review" : "paper-deep-reading";
      const calls = question.includes("加入") || question.includes("滚动验收") ? taskCalls
        : [{ name: "read_research_skill", arguments: JSON.stringify({ name: skillName }) }, ...taskCalls];
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({
        id: "synthetic-completion", object: "chat.completion.chunk",
        choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`);
      const call = calls[toolMessages.length];
      if (call) {
        chunk({ role: "assistant", tool_calls: [{ index: 0, id: require("node:crypto").randomUUID(), type: "function", function: call }] });
        chunk({}, "tool_calls");
      } else {
        const fragments = question.includes("全库检索验收") ? [`本地消融实验证据[引用:${retrievedPaperId}::agent-fixture-evaluation]。`]
          : question.includes("滚动验收")
          ? Array.from({ length: 120 }, (_, index) => `第 ${index + 1} 段：这是用于验证流式阅读位置的合成文字，持续输出期间可以向上阅读。\n\n`)
          : question.includes("序号验收")
            ? ["消融实验用于评估模型。", "[引用:agent-fixture-evaluation]", "\n\n模型通过注意力选择有效特征。",
              "[引用:agent-fixture-paragraph]", "实验结果支撑这一判断。", "[引用:agent-fixture-evaluation]"]
          : ["已完成", "论文读取与", "研究任务。", "\n\n依据：", "[引用:agent-fixture-paragraph]"];
        for (const text of fragments) {
          if (response.destroyed) break;
          chunk({ content: text });
          await new Promise((resolve) => setTimeout(resolve, question.includes("序号验收") ? 180 : 60));
        }
        chunk({}, "stop");
      }
      response.end("data: [DONE]\n\n");
    });
  });
  server.listen(0, "127.0.0.1");
  app.once("before-quit", () => server.close());
  const adapter = require("../electron/pi-agent.cjs");
  const createPiSession = adapter.createPiSession;
  adapter.createPiSession = async (options) => {
    const entry = { channel: "pi:initialize", startedAt: Date.now() };
    globalThis.agentLifecycle.push(entry);
    try { return await createPiSession({
      ...options, service: { ...options.service, baseUrl: `http://127.0.0.1:${server.address().port}/v1` },
    }); } finally { entry.completedAt = Date.now(); }
  };
  app.whenReady().then(() => require("../electron/secret-store.cjs").createEncryptedSecretStore({
    filePath: path.join(app.getPath("userData"), "service-settings.enc.json"),
    safeStorage: require("electron").safeStorage,
  }).write(require("../electron/settings.cjs").normalize({
    aiProvider: "deepseek", mineru: { apiKey: "synthetic-mineru-placeholder" }, deepseek: { apiKey: "synthetic-test-placeholder", model: "synthetic" },
  })));
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: process.env.ZHIYAN_AGENT_DOCUMENT_OUTPUT });
  require("../electron/main.cjs");
} else {
  const { _electron } = require("playwright");
  const assert = require("node:assert/strict");
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "out", "research-agent-checks", process.argv.includes("--dark") ? "dark" : "light");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "zhiyan-agent-"));
  const savedDocument = path.join(userData, "reading-note.md");
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(path.join(userData, "session"));
  const report = { profile: "Isolated desktop, real Pi SDK, local synthetic SSE model and Crossref fixture, synthetic paper; zero external requests", checks: [], errors: [] };
  (async () => {
    const launchOptions = {
      executablePath: require("electron"),
      args: [__filename, "--force-device-scale-factor=1", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"],
      cwd: root,
      env: { ...process.env, ZHIYAN_AGENT_USER_DATA: userData, ZHIYAN_AGENT_DOCUMENT_OUTPUT: savedDocument },
    };
    let electron = await _electron.launch(launchOptions);
    let page = await electron.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => report.errors.push(error.message));
    async function send(question) {
      await page.getByLabel("向篇篇提问").fill(question);
      await page.getByRole("button", { name: "发送给篇篇", exact: true }).click({ timeout: 60000 });
    }
    async function waitReady() {
      // A fresh real Pi worker imports its SDK; loaded Windows CI machines can
      // exceed the ordinary interaction timeout without an application error.
      await page.getByText("就绪", { exact: true }).waitFor({ timeout: 60000 });
    }
    async function capture(name) {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const image = await electron.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
      fs.writeFileSync(path.join(output, name), Buffer.from(image, "base64"));
    }
    try {
      await page.waitForSelector(".workspace-shell");
      assert.equal(await page.title(), "篇篇");
      assert.equal(await electron.evaluate(({ app }) => app.getName()), "篇篇");
      assert.equal(path.resolve(await electron.evaluate(({ app }) => app.getPath("userData"))).toLowerCase(), path.resolve(userData).toLowerCase());
      await page.waitForFunction(() => [...document.querySelectorAll("img.pianpian")].every((image) => image.complete && image.naturalWidth > 0));
      report.checks.push("Pianpian desktop identity, isolated userData and generated mascot resources load correctly");
      if (process.argv.includes("--dark")) {
        await page.getByRole("button", { name: "切换为深色模式", exact: true }).click();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
        report.checks.push("Research workflow runs in the user-selected dark theme");
      }
      await page.getByRole("button", { name: "问问篇篇", exact: true }).click();
      await page.getByText("你的文献，我们一起理一理。", { exact: true }).waitFor();
      assert((await page.locator(".research-conversation-toolbar").boundingBox()).height <= 56);
      const conversationBounds = await page.locator(".research-agent-scroll").boundingBox();
      await capture("00-global-empty.png");
      await page.getByRole("button", { name: "篇篇的拿手活", exact: true }).click();
      assert.equal(await page.locator(".research-skills-list button").count(), 3);
      assert.deepEqual(await page.locator(".research-agent-scroll").boundingBox(), conversationBounds);
      await capture("00-global-skills.png");
      await page.getByRole("button", { name: "论文精读", exact: true }).click();
      assert((await page.getByLabel("向篇篇提问").inputValue()).includes("精读当前论文"));
      assert.equal(await page.locator(".research-skills-list").count(), 0);
      await capture("01-research-workspace.png");
      report.checks.push("One 52px toolbar replaces stacked headers; skills float without moving the conversation and close after populating the composer");
      await send("查找相关论文");
      await page.locator('[aria-label="工具：查找相关论文"] .research-tool-heading').click();
      await page.locator(".research-result-item").first().waitFor();
      await page.locator('[aria-label="停止回答"]').waitFor({ state: "detached" });
      await page.getByRole("button", { name: "发送给篇篇", exact: true }).waitFor();
      assert.equal(await page.locator(".research-message.is-user").count(), 1);
      assert.equal(await page.locator(".research-result-item").count(), 2);
      await capture("02-tool-chain.png");
      report.checks.push("Streaming-compatible multi-turn timeline renders read and search tool cards");

      await send("把第1篇加入文献库");
      await page.getByRole("button", { name: "确认加入元数据", exact: true }).waitFor();
      await page.getByRole("button", { name: "确认加入元数据", exact: true }).scrollIntoViewIfNeeded();
      await capture("03-confirmation.png");
      await page.getByRole("button", { name: "确认加入元数据", exact: true }).click();
      await page.locator('[aria-label="停止回答"]').waitFor({ state: "detached" });
      await page.getByRole("button", { name: "发送给篇篇", exact: true }).waitFor();
      const entries = await page.evaluate(() => JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1")));
      assert.equal(entries.length, 1);
      assert.equal(entries[0].recordType, "reference");
      assert.equal(entries[0].originalId, undefined);
      report.checks.push("Confirmed Crossref result writes metadata only and does not claim a local PDF");

      await send("查找《Attention Is All You Need》并加入论文列表");
      await page.getByRole("button", { name: "确认下载 PDF", exact: true }).waitFor();
      await page.getByRole("button", { name: "确认下载 PDF", exact: true }).scrollIntoViewIfNeeded();
      await capture("03-arxiv-confirmation.png");
      await page.getByRole("button", { name: "确认下载 PDF", exact: true }).click();
      await page.getByText("PDF 已下载并保存", { exact: true }).waitFor();
      const imported = await page.evaluate(() => JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1"))
        .find((item) => item.arxivId === "1706.03762v7"));
      assert(imported);
      assert.equal(imported.recordType, undefined);
      assert.equal(imported.title, "Attention Is All You Need");
      assert.match(imported.originalId, /^[a-f0-9]{64}$/);
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1"))
        .find((item) => item.arxivId === "1706.03762v7")?.parseStatus === "ready");
      assert.equal(await electron.evaluate(() => globalThis.arxivMineruStarts), 1);
      await page.locator('[aria-label="停止回答"]').waitFor({ state: "detached" });
      report.checks.push("Verified arXiv candidate downloads and persists a local PDF, creates a readable paper record, and starts MinerU parsing");

      await page.getByRole("button", { name: "历史对话", exact: true }).click();
      await page.getByRole("button", { name: /重命名对话/ }).first().click();
      await page.getByLabel("对话标题", { exact: true }).fill("全库主题研究");
      await page.locator(".research-history form").getByRole("button", { name: "保存", exact: true }).click();
      await page.getByRole("button", { name: "新建", exact: true }).click();
      await page.getByText("你的文献，我们一起理一理。", { exact: true }).waitFor();
      await page.getByRole("button", { name: "历史对话", exact: true }).click();
      await page.locator(".research-history-select").filter({ hasText: "全库主题研究" }).click();
      await page.locator(".research-message.is-user").filter({ hasText: "查找相关论文" }).waitFor();
      await waitReady();
      await send("查找更多相关论文");
      await page.waitForFunction(() => !document.querySelector('[aria-label="停止回答"]'));
      const restoredRequest = await electron.evaluate(() => globalThis.agentTestRequests.at(-1));
      assert(restoredRequest.some((item) => item.role === "user" && String(item.content).includes("查找相关论文")));
      assert(restoredRequest.some((item) => item.role === "assistant" && JSON.stringify(item.content).includes("已完成")));
      await capture("10-conversation-history.png");
      report.checks.push("History supports rename, new and one-click restore; restored user AND assistant messages reach the real Pi model request without replaying tools");
      await page.getByRole("button", { name: "新建", exact: true }).click();
      await page.getByText("你的文献，我们一起理一理。", { exact: true }).waitFor();
      await page.getByRole("button", { name: "历史对话", exact: true }).click();
      await page.getByRole("button", { name: /删除对话：全库主题研究/ }).click();
      await page.getByRole("button", { name: "确认删除", exact: true }).click();
      await page.locator(".research-history-select").filter({ hasText: "全库主题研究" }).waitFor({ state: "detached" });
      await page.getByRole("button", { name: "历史对话", exact: true }).click();
      report.checks.push("Delete is confirmed and removes the persisted history without replaying pending actions");

      await send("把第1篇加入文献库");
      await page.getByRole("button", { name: "拒绝", exact: true }).click();
      await page.getByRole("button", { name: "发送给篇篇" }).waitFor();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1")).length), 2);
      report.checks.push("Rejected write leaves the library unchanged");

      await send("把第1篇加入文献库");
      await page.getByRole("button", { name: "确认加入元数据", exact: true }).waitFor();
      await page.getByRole("button", { name: "停止回答", exact: true }).click();
      await page.getByRole("button", { name: "发送给篇篇" }).waitFor();
      report.checks.push("Stop cancels a pending approval without hanging");

      await send("生成一份阅读笔记文档");
      await page.getByRole("button", { name: "保存 Markdown 文档", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="停止回答"]'));
      assert(fs.readFileSync(savedDocument, "utf8").includes("# 阅读笔记"));
      await capture("04-document.png");
      report.checks.push("Generated Markdown is saved through Electron's native save boundary");

      await send("滚动验收：持续输出长文");
      await page.waitForFunction(() => {
        const element = document.querySelector(".research-agent-scroll");
        return element.scrollHeight - element.clientHeight > 800;
      });
      await page.waitForFunction(() => {
        const element = document.querySelector(".research-agent-scroll");
        return element.scrollHeight - element.clientHeight - element.scrollTop < 3;
      });
      const styles = await page.locator(".research-agent-scroll").evaluate((element) => ({
        behavior: getComputedStyle(element).scrollBehavior, anchor: getComputedStyle(element).overflowAnchor,
      }));
      assert.deepEqual(styles, { behavior: "auto", anchor: "none" });
      const paused = await page.locator(".research-agent-scroll").evaluate(async (element) => {
        element.scrollTop -= 40;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { top: element.scrollTop, height: element.scrollHeight };
      });
      await page.waitForFunction((height) => document.querySelector(".research-agent-scroll").scrollHeight > height + 300, paused.height);
      assert(Math.abs(await page.locator(".research-agent-scroll").evaluate((element) => element.scrollTop) - paused.top) < 2);
      await capture("07-stream-reading-position.png");
      await page.locator(".research-agent-scroll").evaluate(async (element) => {
        element.scrollTop = element.scrollHeight;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await page.locator('[aria-label="停止回答"]').waitFor({ state: "detached" });
      await page.getByRole("button", { name: "发送给篇篇", exact: true }).waitFor();
      await page.waitForFunction(() => {
        const element = document.querySelector(".research-agent-scroll");
        return element.scrollHeight - element.clientHeight - element.scrollTop < 3;
      });
      const tailGap = await page.locator(".research-agent-scroll").evaluate((element) =>
        element.scrollHeight - element.clientHeight - element.scrollTop);
      assert(tailGap < 3);
      assert.equal(await page.evaluate(() => document.documentElement.scrollTop), 0);
      report.checks.push("120 streamed paragraphs keep the bottom visible, preserve an upward reading position, and resume following at the bottom");

      await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 720));
      await page.waitForFunction(() => {
        const element = document.querySelector(".research-agent-scroll");
        return element.scrollHeight - element.clientHeight - element.scrollTop < 3;
      });
      await capture("05-compact.png");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(overflow, false);
      report.checks.push("1000px desktop layout has no horizontal overflow");
      await page.getByRole("button", { name: "返回文献库", exact: true }).click();
      await page.locator(".paper-row").filter({ hasText: "Synthetic attention paper" }).click();
      assert(await page.getByRole("button", { name: "打开阅读", exact: true }).isDisabled());
      report.checks.push("Library accurately separates metadata-only references from readable local PDFs");

      const fixture = await page.evaluate(async (bytes) => {
        const saved = await window.zhiyan.invoke("zhiyan:documents:save", { name: "research-agent-fixture.pdf", data: new Uint8Array(bytes) });
        const paper = { id: saved.id, originalId: saved.id, title: "Research Agent Fixture", authors: ["Synthetic Team"], year: 2026,
          sourcePath: `local://${saved.id}`, importedAt: "2026-10-12", groupId: "group-inbox", favorite: false, blocks: 2,
          parseVersion: 2, parseStatus: "ready", pageCount: 1, blockData: [
            { id: "agent-fixture-paragraph", kind: "paragraph", pageNumber: 1, order: 0,
              text: "The model uses attention to select useful features.", bbox: [.09, .14, .92, .17] },
            { id: "agent-fixture-evaluation", kind: "paragraph", pageNumber: 1, order: 1,
              text: "An ablation study evaluates the model.", bbox: [.09, .17, .92, .20] },
          ] };
        const papers = JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1"));
        localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([paper, ...papers]));
        return paper;
      }, syntheticPdf());
      await electron.evaluate(async (_electron, paper) => globalThis.publishAgentFixture(paper), fixture);
      await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 950));
      await page.reload();
      await page.locator(".paper-row").filter({ hasText: "Research Agent Fixture" }).click();
      await page.getByRole("button", { name: "编辑文献", exact: true }).click();
      const editDialog = page.getByRole("dialog", { name: "编辑文献", exact: true });
      const yearBounds = await page.locator("#paper-year").boundingBox();
      const groupBounds = await page.locator("#paper-group").boundingBox();
      assert.equal(yearBounds.height, groupBounds.height);
      assert(Math.abs(yearBounds.y - groupBounds.y) < 2);
      assert(groupBounds.width > 200);
      await capture("13-paper-edit.png");
      await page.getByRole("button", { name: "在编辑文献中创建分组", exact: true }).click();
      assert.equal(await page.getByRole("dialog").count(), 1);
      await page.getByRole("textbox", { name: "新分组名称", exact: true }).fill("研究方法");
      assert.equal((await page.getByRole("button", { name: "确认创建分组", exact: true }).boundingBox()).height, yearBounds.height);
      assert.equal((await page.getByRole("button", { name: "取消创建分组", exact: true }).boundingBox()).height, yearBounds.height);
      await capture("14-inline-group.png");
      await page.getByRole("button", { name: "确认创建分组", exact: true }).click();
      assert.equal(await page.locator("#paper-group option:checked").innerText(), "研究方法");
      await page.getByRole("button", { name: "保存文献", exact: true }).click();
      await editDialog.waitFor({ state: "detached" });
      assert.equal(await page.getByRole("button", { name: "分组：研究方法", exact: true }).count(), 1);
      report.checks.push("Paper editor aligns year and group controls at 42px; inline group creation selects and persists the group without a second dialog");
      await page.getByRole("button", { name: "打开阅读", exact: true }).click();
      await page.waitForSelector('.pdf-page-stage[data-rendered="true"]');
      await page.getByRole("tab", { name: "聊聊", exact: true }).click();
      await waitReady();
      assert((await page.locator(".research-conversation-toolbar").boundingBox()).height <= 56);
      const readerBounds = await page.locator(".research-agent-scroll").boundingBox();
      await capture("15-reader-empty.png");
      await page.getByRole("button", { name: "篇篇的拿手活", exact: true }).click();
      assert.deepEqual(await page.locator(".research-agent-scroll").boundingBox(), readerBounds);
      const pickerBounds = await page.locator(".research-skills").boundingBox();
      assert(pickerBounds.x + pickerBounds.width <= await page.evaluate(() => innerWidth));
      await capture("16-reader-skills.png");
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("button", { name: "篇篇的拿手活", exact: true }).evaluate((button) => document.activeElement === button), true);
      await page.getByRole("button", { name: "篇篇的拿手活", exact: true }).click();
      await page.getByRole("tab", { name: "读懂这段", exact: true }).click();
      await page.getByRole("tab", { name: "聊聊", exact: true }).click();
      assert.equal(await page.locator(".research-skills").count(), 0);
      report.checks.push("Reader floating pickers stay within the sidebar, return focus on Escape, and dismiss when switching tabs without restarting the Agent");
      await send("概括这篇论文，序号验收");
      await page.locator(".research-inline-citation").first().waitFor();
      assert.equal(await page.locator(".research-inline-citation").first().textContent(), "[1]");
      await page.waitForFunction(() => !document.querySelector('[aria-label="停止回答"]'));
      assert.deepEqual(await page.locator(".research-inline-citation").allTextContents(), ["[1]", "[2]", "[1]"]);
      assert.equal(await page.locator(".research-citations, .research-message-citations, .research-citation-excerpt").count(), 0);
      assert(!/第\s*\d+\s*页/.test(await page.locator(".research-assistant-panel").innerText()));
      assert.deepEqual(await page.locator(".research-inline-citation").evaluateAll((buttons) =>
        buttons.map((button) => button.title)), ["查看原文", "查看原文", "查看原文"]);
      await capture("08-inline-citations.png");
      await page.locator(".research-inline-citation").first().click();
      await page.waitForSelector("#pdf-block-agent-fixture-evaluation.is-focus-flash");
      await capture("09-citation-target-highlight.png");
      await page.waitForSelector("#pdf-block-agent-fixture-evaluation.is-focus-flash", { state: "detached" });
      report.checks.push("Inline citations number first visible mentions as [1], [2], [1] without pages, excerpts or footer lists; clicking highlights the correct same-page source briefly");
      await send("这个实验方法有什么限制？");
      await page.getByRole("button", { name: "发送给篇篇" }).waitFor();
      assert.equal(await page.locator(".research-message.is-user").count(), 2);
      assert.equal(await page.locator(".research-message.is-assistant").count(), 2);
      const nextCitation = page.locator(".research-message.is-assistant .research-inline-citation").last();
      assert.equal(await nextCitation.textContent(), "[1]");
      await nextCitation.focus();
      await nextCitation.press("Enter");
      await page.waitForSelector('#pdf-block-agent-fixture-paragraph.is-focus-flash');
      assert(await page.locator('.pdf-page-stage[data-rendered="true"]').isVisible());
      await capture("06-reader-agent.png");
      report.checks.push("Reader restarts citation numbers in the next answer and supports keyboard-activated block navigation with the original PDF visible");
      const paperHistory = await page.evaluate((paperId) => window.zhiyan.invoke("zhiyan:agent:conversations:list", { scope: "paper", paperId }), fixture.id);
      assert.equal(paperHistory.length, 1);
      assert.equal(paperHistory[0].messageCount, 4);
      await page.reload();
      await page.locator(".paper-row").filter({ hasText: "Research Agent Fixture" }).click();
      await page.getByRole("button", { name: "问问篇篇", exact: true }).click();
      assert.equal(await page.locator(".research-message.is-user").filter({ hasText: "概括这篇论文" }).count(), 0);
      await send("全库检索验收：从已解析正文查找消融实验");
      await page.waitForFunction(() => !document.querySelector('[aria-label="停止回答"]'));
      await page.locator(".research-message.is-assistant .research-inline-citation").last().waitFor();
      await page.getByRole("button", { name: "历史对话", exact: true }).click();
      await page.getByLabel("搜索历史对话").fill("全库检索验收");
      await page.waitForFunction(() => document.querySelectorAll(".research-history-select").length === 1);
      await capture("11-global-local-retrieval.png");
      await page.locator(".research-message.is-assistant .research-inline-citation").last().click();
      await page.waitForSelector("#pdf-block-agent-fixture-evaluation.is-focus-flash");
      await page.getByRole("tab", { name: "聊聊", exact: true }).click();
      await waitReady();
      assert.equal(await page.locator(".research-message.is-user").count(), 2);
      assert.equal(await page.locator(".research-message.is-user").filter({ hasText: "全库检索验收" }).count(), 0);
      report.checks.push("Reload retains paper history; homepage stays global despite a selected paper, searches parsed body, and navigates a paper-qualified citation while keeping both histories isolated");
      assert.deepEqual(report.errors, []);
      assert.equal(await electron.evaluate(() => globalThis.agentRemoteRequests), 0);
      assert.equal(await electron.evaluate(() => globalThis.arxivMineruStarts), 1);
      await electron.close();
      electron = await _electron.launch(launchOptions);
      page = await electron.firstWindow();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => report.errors.push(error.message));
      await page.waitForSelector(".workspace-shell");
      await page.getByRole("button", { name: "问问篇篇", exact: true }).click();
      await page.locator(".research-message.is-user").filter({ hasText: "全库检索验收" }).waitFor();
      await waitReady();
      await send("重启后继续查找相关论文");
      await page.waitForFunction(() => !document.querySelector('[aria-label="停止回答"]'));
      const restartedRequest = await electron.evaluate(() => globalThis.agentTestRequests.at(-1));
      assert(restartedRequest.some((item) => item.role === "user" && String(item.content).includes("全库检索验收")));
      assert(restartedRequest.some((item) => item.role === "assistant" && JSON.stringify(item.content).includes("本地消融实验证据")));
      assert.deepEqual(report.errors, []);
      assert.equal(await electron.evaluate(() => globalThis.agentRemoteRequests), 0);
      assert.equal(await electron.evaluate(() => globalThis.arxivMineruStarts), 0);
      await capture("12-restarted-history.png");
      report.checks.push("Closing and relaunching the real Electron process retains history and restores previous user and assistant text into the next model request");
      report.status = "passed";
      report.lifecycle = await electron.evaluate(() => globalThis.agentLifecycle);
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      report.status = "failed";
      report.error = error.message;
      report.stack = error.stack;
      report.lifecycle = await electron.evaluate(() => globalThis.agentLifecycle);
      report.requests = await electron.evaluate(() => globalThis.agentTestRequests);
      await capture("failure.png");
      console.error(error.message);
      process.exitCode = 1;
    } finally {
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
      await electron.close();
    }
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
