const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (process.versions.electron) {
  const { app, dialog } = require("electron");
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
  globalThis.agentTestRequests = [];
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("http://127.0.0.1:")) return nativeFetch(url, options);
    if (String(url).startsWith("https://api.crossref.org/works?")) return new Response(JSON.stringify({ message: { items: [
      { title: ["Synthetic attention paper"], DOI: "10.1234/attention", author: [{ given: "Synthetic", family: "Team" }],
        published: { "date-parts": [[2025]] }, URL: "https://doi.org/10.1234/attention" },
      { title: ["Synthetic evidence paper"], DOI: "10.1234/evidence", author: [],
        published: { "date-parts": [[2024]] }, URL: "https://doi.org/10.1234/evidence" },
    ] } }), { headers: { "content-type": "application/json" } });
    globalThis.agentRemoteRequests++;
    throw new Error("External services are disabled in this synthetic desktop test");
  };
  const server = require("node:http").createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", async () => {
      const body = JSON.parse(raw);
      globalThis.agentTestRequests.push(body.messages.map((message) => ({ role: message.role, content: message.role === "user" ? message.content : undefined, tool_call_id: message.tool_call_id })));
      const userIndex = body.messages.findLastIndex((message) => message.role === "user");
      const rawQuestion = body.messages[userIndex]?.content;
      const question = Array.isArray(rawQuestion)
        ? rawQuestion.map((part) => part?.text || "").join(" ")
        : String(rawQuestion || "");
      const toolMessages = body.messages.slice(userIndex + 1).filter((message) =>
        message.role === "tool" || message.role === "toolResult" || message.tool_call_id);
      const related = { title: "Synthetic attention paper", authors: ["Synthetic Team"], year: 2025,
        doi: "10.1234/attention", landingUrl: "https://doi.org/10.1234/attention", source: "Crossref" };
      const taskCalls = question.includes("滚动验收") ? [] : question.includes("加入")
        ? [{ name: "add_paper_to_library", arguments: JSON.stringify(related) }]
        : question.includes("文档")
          ? [{ name: "read_current_paper", arguments: "{}" },
            { name: "create_document", arguments: JSON.stringify({ title: "阅读笔记", markdown: "# 阅读笔记\n\nThe model uses attention. [第 1 页]" }) }]
          : question.includes("查找")
            ? [{ name: "read_current_paper", arguments: "{}" }, { name: "search_literature", arguments: '{"query":"attention","limit":2}' }]
            : [{ name: "read_current_paper", arguments: "{}" }];
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
        const fragments = question.includes("滚动验收")
          ? Array.from({ length: 120 }, (_, index) => `第 ${index + 1} 段：这是用于验证流式阅读位置的合成文字，持续输出期间可以向上阅读。\n\n`)
          : ["已完成", "论文读取与", "研究任务。", "\n\n依据：", "[第 1 页]"];
        for (const text of fragments) {
          if (response.destroyed) break;
          chunk({ content: text });
          await new Promise((resolve) => setTimeout(resolve, 60));
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
  adapter.createPiSession = (options) => createPiSession({
    ...options, service: { ...options.service, baseUrl: `http://127.0.0.1:${server.address().port}/v1` },
  });
  app.whenReady().then(() => require("../electron/secret-store.cjs").createEncryptedSecretStore({
    filePath: path.join(app.getPath("userData"), "service-settings.enc.json"),
    safeStorage: require("electron").safeStorage,
  }).write(require("../electron/settings.cjs").normalize({
    aiProvider: "deepseek", deepseek: { apiKey: "synthetic-test-placeholder", model: "synthetic" },
  })));
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: process.env.ZHIYAN_AGENT_DOCUMENT_OUTPUT });
  require("../electron/main.cjs");
} else {
  const { _electron } = require("playwright");
  const assert = require("node:assert/strict");
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "out", "research-agent-checks");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "zhiyan-agent-"));
  const savedDocument = path.join(userData, "reading-note.md");
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(path.join(userData, "session"));
  const report = { profile: "Isolated desktop, real Pi SDK, local synthetic SSE model and Crossref fixture, synthetic paper; zero external requests", checks: [], errors: [] };
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
  (async () => {
    const electron = await _electron.launch({
      executablePath: require("electron"),
      args: [__filename, "--force-device-scale-factor=1", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"],
      cwd: root,
      env: { ...process.env, ZHIYAN_AGENT_USER_DATA: userData, ZHIYAN_AGENT_DOCUMENT_OUTPUT: savedDocument },
    });
    const page = await electron.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => report.errors.push(error.message));
    async function send(question) {
      await page.getByLabel("向研究 Agent 提问").fill(question);
      await page.getByRole("button", { name: "发送给研究 Agent", exact: true }).click();
    }
    async function capture(name) {
      const image = await electron.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
      fs.writeFileSync(path.join(output, name), Buffer.from(image, "base64"));
    }
    try {
      await page.waitForSelector(".workspace-shell");
      await page.getByRole("button", { name: "打开研究助手", exact: true }).click();
      await page.getByText("从这篇论文开始研究", { exact: true }).waitFor();
      await page.locator(".research-skills summary").waitFor();
      await page.locator(".research-skills summary").click();
      assert.equal(await page.locator(".research-skills-list button").count(), 3);
      await page.getByRole("button", { name: "论文精读", exact: true }).click();
      assert((await page.getByLabel("向研究 Agent 提问").inputValue()).includes("精读当前论文"));
      await capture("01-research-workspace.png");
      report.checks.push("Three bundled skills are discoverable and populate their Chinese workflow prompts");
      await send("查找相关论文");
      await page.locator(".research-result-item").first().waitFor();
      await page.getByRole("button", { name: "发送给研究 Agent" }).waitFor();
      assert.equal(await page.locator(".research-message.is-user").count(), 1);
      assert.equal(await page.locator(".research-result-item").count(), 2);
      await capture("02-tool-chain.png");
      report.checks.push("Streaming-compatible multi-turn timeline renders read and search tool cards");

      await send("把第1篇加入文献库");
      await page.getByRole("button", { name: "确认加入", exact: true }).waitFor();
      await page.getByRole("button", { name: "确认加入", exact: true }).scrollIntoViewIfNeeded();
      await capture("03-confirmation.png");
      await page.getByRole("button", { name: "确认加入", exact: true }).click();
      await page.getByRole("button", { name: "发送给研究 Agent" }).waitFor();
      const entries = await page.evaluate(() => JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1")));
      assert.equal(entries.length, 1);
      assert.equal(entries[0].recordType, "reference");
      report.checks.push("Confirmed tool writes one reference record to the real local library");

      await send("把第1篇加入文献库");
      await page.getByRole("button", { name: "拒绝", exact: true }).click();
      await page.getByRole("button", { name: "发送给研究 Agent" }).waitFor();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1")).length), 1);
      report.checks.push("Rejected write leaves the library unchanged");

      await send("把第1篇加入文献库");
      await page.getByRole("button", { name: "确认加入", exact: true }).waitFor();
      await page.getByRole("button", { name: "停止 Agent", exact: true }).click();
      await page.getByRole("button", { name: "发送给研究 Agent" }).waitFor();
      report.checks.push("Stop cancels a pending approval without hanging");

      await send("生成一份阅读笔记文档");
      await page.getByRole("button", { name: "保存 Markdown 文档", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="停止 Agent"]'));
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
      await page.getByRole("button", { name: "发送给研究 Agent" }).waitFor();
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
      await page.getByText("文献条目 · 全文待导入", { exact: true }).waitFor();
      await page.locator(".paper-row").first().click();
      assert(await page.getByRole("button", { name: "打开阅读", exact: true }).isDisabled());
      report.checks.push("Library accurately separates references from readable local PDFs");

      const fixture = await page.evaluate(async (bytes) => {
        const saved = await window.zhiyan.invoke("zhiyan:documents:save", { name: "research-agent-fixture.pdf", data: new Uint8Array(bytes) });
        const paper = { id: saved.id, originalId: saved.id, title: "Research Agent Fixture", authors: ["Synthetic Team"], year: 2026,
          sourcePath: `local://${saved.id}`, importedAt: "2026-10-12", tags: [], favorite: false, blocks: 1,
          parseVersion: 2, parseStatus: "ready", pageCount: 1, blockData: [
            { id: "agent-fixture-paragraph", kind: "paragraph", pageNumber: 1, order: 0,
              text: "The model uses attention to select useful features. An ablation study evaluates the model.", bbox: [.09, .14, .92, .20] },
          ] };
        const papers = JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1"));
        localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([paper, ...papers]));
        return paper;
      }, syntheticPdf());
      await electron.evaluate(async (_electron, paper) => globalThis.publishAgentFixture(paper), fixture);
      await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 950));
      await page.reload();
      await page.locator(".paper-row").filter({ hasText: "Research Agent Fixture" }).click();
      await page.getByRole("button", { name: "打开阅读", exact: true }).click();
      await page.waitForSelector('.pdf-page-stage[data-rendered="true"]');
      await page.getByRole("tab", { name: "研究对话", exact: true }).click();
      await send("概括这篇论文");
      await page.locator(".research-citations button").first().waitFor();
      await send("这个实验方法有什么限制？");
      await page.getByRole("button", { name: "发送给研究 Agent" }).waitFor();
      assert.equal(await page.locator(".research-message.is-user").count(), 2);
      assert.equal(await page.locator(".research-message.is-assistant").count(), 2);
      await page.locator(".research-citations button").last().click();
      await page.waitForSelector('#pdf-block-agent-fixture-paragraph');
      assert(await page.locator('.pdf-page-stage[data-rendered="true"]').isVisible());
      await capture("06-reader-agent.png");
      report.checks.push("Reader supports two-turn paper conversation and stable block citation navigation with the original PDF visible");
      assert.deepEqual(report.errors, []);
      assert.equal(await electron.evaluate(() => globalThis.agentRemoteRequests), 0);
      report.status = "passed";
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      report.status = "failed";
      report.error = error.message;
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
