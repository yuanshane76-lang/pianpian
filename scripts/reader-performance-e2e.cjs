// Explicit local acceptance: real papers stay in an isolated profile; reports contain no credentials.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

if (process.versions.electron) {
  const { app, safeStorage } = require("electron");
  app.setName("纸研工作台");
  app.setPath("userData", process.env.ZHIYAN_PERFORMANCE_PROFILE);
  app.setPath("sessionData", path.join(app.getPath("userData"), "session"));
  Object.defineProperty(app, "isPackaged", { value: true });
  const state = globalThis.readerAcceptance = { reads: [], mainGaps: [], unresponsive: 0, pi: [], ai: [], events: [] };
  let previous = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    if (now - previous > 100) state.mainGaps.push(Math.round(now - previous));
    previous = now;
  }, 25);
  app.once("before-quit", () => clearInterval(timer));
  app.on("browser-window-created", (_, window) => window.on("unresponsive", () => state.unresponsive++));
  app.whenReady().then(() => {
    if (process.env.ZHIYAN_PERFORMANCE_LIVE === "1") return;
    require("../electron/secret-store.cjs").createEncryptedSecretStore({
      filePath: path.join(app.getPath("userData"), "service-settings.enc.json"), safeStorage,
    }).write(require("../electron/settings.cjs").normalize({
      aiProvider: "deepseek", deepseek: { apiKey: "synthetic-test-placeholder" },
    }));
  });
  const store = require("../electron/document-store.cjs");
  const createStore = store.createDocumentStore;
  store.createDocumentStore = (options) => {
    const documents = createStore(options), read = documents.read;
    documents.read = async (id) => {
      const start = performance.now(), data = await read(id);
      state.reads.push({ bytes: data.length, ms: Math.round(performance.now() - start) });
      return data;
    };
    return documents;
  };
  const pi = require("../electron/pi-agent.cjs"), createPi = pi.createPiSession;
  pi.createPiSession = async (options) => {
    const start = performance.now();
    try { return await createPi(options); }
    finally { state.pi.push({ ms: Math.round(performance.now() - start) }); }
  };
  const ai = require("../electron/ai.cjs"), streamModel = ai.streamModel;
  ai.streamModel = (settings, request, onDelta, ...args) => {
    const call = { operation: request.operation, deltas: 0, characters: 0 };
    state.ai.push(call);
    return streamModel(settings, request, (text) => {
      call.deltas++; call.characters += text.length; onDelta(text);
    }, ...args);
  };
  const runtime = require("../electron/research-agent-runtime.cjs"), createRuntime = runtime.createResearchAgentRuntime;
  runtime.createResearchAgentRuntime = (options) => createRuntime({ ...options, emit: (event) => {
    state.events.push({ type: event.type, tool: event.tool?.name, status: event.tool?.status,
      characters: event.delta?.length, citations: event.message?.citations?.map((citation) => citation.blockId) });
    options.emit(event);
  } });
  if (process.env.ZHIYAN_PERFORMANCE_LIVE !== "1") {
    globalThis.fetch = async () => { throw new Error("性能验收禁止外部服务请求"); };
  }
  require("../electron/main.cjs");
} else {
  const { _electron } = require("playwright");
  const assert = require("node:assert/strict");
  const live = process.argv.includes("--live-ai");
  const reparse = process.argv.includes("--reparse");
  assert(!reparse || live, "重新解析必须显式启用 --live-ai");
  const source = path.join(process.env.APPDATA, "纸研工作台");
  const output = path.join(root, "out", live ? "reader-live-acceptance" : "reader-performance-acceptance");
  fs.mkdirSync(output, { recursive: true });
  const papers = fs.readdirSync(path.join(source, "documents")).filter((id) => /^[a-f0-9]{64}$/.test(id)).flatMap((id) => {
    const directory = path.join(source, "documents", id), parsePath = path.join(directory, "parse.json");
    if (!fs.existsSync(parsePath)) return [];
    const parse = JSON.parse(fs.readFileSync(parsePath, "utf8"));
    if (!/DEER|FINDEEPRESEARCH/.test(parse.title)) return [];
    return [{ id, originalId: id, title: parse.title, authors: [], year: null,
      sourcePath: `local://${id}`, importedAt: new Date().toISOString(), tags: [], favorite: false,
      blocks: parse.blocks.length, blockData: parse.blocks, pageCount: parse.pageCount,
      parseStatus: "ready", parseVersion: 2, readingPosition: { mode: "pdf", page: 1 } }];
  }).sort((a, b) => b.pageCount - a.pageCount);
  assert(papers.length >= 2 && papers[0].pageCount >= 40, "需要本机已解析的真实长论文（至少40页）和另一篇论文");
  console.log(`准备隔离真实论文：${papers.map((paper) => paper.pageCount).join(" / ")} 页`);
  const report = { passed: false, profile: live ? "isolated real papers, real configured model and public Crossref" : "isolated real papers; no remote services",
    checks: [], cases: [], errors: [] };
  function copyDirectory(sourceDirectory, targetDirectory) {
    fs.mkdirSync(targetDirectory, { recursive: true });
    for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
      const from = path.join(sourceDirectory, entry.name), to = path.join(targetDirectory, entry.name);
      if (entry.isDirectory()) copyDirectory(from, to);
      else if (entry.isFile()) fs.copyFileSync(from, to);
      else throw new Error("验收论文目录包含不支持的文件类型");
    }
  }

  async function run(paper, index) {
    console.log(`开始第 ${index + 1} 个冷启动验收：${paper.pageCount} 页`);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "zhiyan-reader-acceptance-"));
    fs.mkdirSync(path.join(profile, "session"));
    for (const entry of papers) {
      copyDirectory(path.join(source, "documents", entry.id), path.join(profile, "documents", entry.id));
    }
    if (live) {
      fs.copyFileSync(path.join(source, "service-settings.enc.json"), path.join(profile, "service-settings.enc.json"));
      if (fs.existsSync(path.join(source, "Local State"))) {
        fs.copyFileSync(path.join(source, "Local State"), path.join(profile, "Local State"));
        fs.copyFileSync(path.join(source, "Local State"), path.join(profile, "session", "Local State"));
      }
    }
    console.log("隔离论文目录已就绪，启动 Electron");
    const electron = await _electron.launch({
      executablePath: require("electron"), args: [__filename, "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
      cwd: root, env: { ...process.env, ZHIYAN_PERFORMANCE_PROFILE: profile, ZHIYAN_PERFORMANCE_LIVE: live ? "1" : "0" },
    });
    const page = await electron.firstWindow();
    page.setDefaultTimeout(60000);
    page.on("pageerror", (error) => report.errors.push(error.message));
    async function capture(name) {
      const image = await electron.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
      fs.writeFileSync(path.join(output, name), Buffer.from(image, "base64"));
    }
    async function waitIdle() {
      await page.waitForFunction(() => !document.querySelector('[aria-label="停止回答"]'), null, { timeout: 180000 });
      assert.equal(await page.locator(".research-agent-error").count(), 0, "真实Agent调用失败");
    }
    async function send(text) {
      await page.getByLabel("向篇篇提问").fill(text);
      await page.getByRole("button", { name: "发送给篇篇", exact: true }).click();
    }
    try {
      await page.addInitScript(() => {
        window.readerAcceptance = { gaps: [], longTasks: [] };
        let previous = performance.now();
        setInterval(() => {
          const now = performance.now();
          if (now - previous > 100) window.readerAcceptance.gaps.push(Math.round(now - previous));
          previous = now;
        }, 25);
        new PerformanceObserver((list) => list.getEntries().forEach((entry) =>
          window.readerAcceptance.longTasks.push(Math.round(entry.duration)))).observe({ type: "longtask", buffered: true });
      });
      await page.waitForSelector(".workspace-shell");
      if (live) {
        const configured = await page.evaluate(async () => {
          const settings = await window.zhiyan.invoke("zhiyan:settings:get");
          return Boolean(settings[settings.aiProvider]?.configured);
        });
        assert(configured, "隔离配置未能解密；请检查本机服务配置");
      }
      await page.evaluate((items) => localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify(items)), papers);
      await page.reload();
      await page.locator(".paper-row").filter({ hasText: paper.title }).click();
      await electron.evaluate(() => { globalThis.readerAcceptance.mainGaps = []; globalThis.readerAcceptance.reads = []; });
      await page.evaluate(() => { window.readerAcceptance.gaps = []; window.readerAcceptance.longTasks = []; });
      const start = Date.now();
      await page.getByRole("button", { name: "打开阅读", exact: true }).click();
      await page.waitForSelector('.pdf-page-stage[data-rendered="true"]');
      const firstPaintMs = Date.now() - start;
      await page.waitForFunction(() => document.querySelectorAll(".pdf-page-stage[data-rendered='true']").length >= 2);
      const before = await electron.evaluate(() => globalThis.readerAcceptance);
      assert.equal(before.pi.length, 0, "打开论文不应初始化研究Agent");
      assert.equal(before.reads.length, 1, "一次打开论文只读一次原始PDF");
      assert.equal(before.unresponsive, 0);
      assert(Math.max(0, ...before.mainGaps) < 1000, "主进程出现超过1秒的停顿");
      assert(firstPaintMs < 5000, "首屏应在5秒内出现");
      await capture(`${index}-cold-${paper.pageCount}-pages.png`);
      const pageInput = page.getByRole("spinbutton", { name: "PDF 页码" });
      await pageInput.fill(String(paper.pageCount - 2));
      await pageInput.press("Enter");
      await page.waitForSelector(`.pdf-page-stage[data-rendered="true"][data-page-number="${paper.pageCount - 2}"]`);
      await page.getByRole("button", { name: "放大 PDF", exact: true }).click();
      await page.getByRole("button", { name: "缩小 PDF", exact: true }).click();
      await page.getByRole("button", { name: "适应宽度", exact: true }).click();
      assert(await page.locator(".pdf-page-stage canvas").count() <= 5, "长论文应只保留可见页画布");
      await capture(`${index}-tail-${paper.pageCount}-pages.png`);
      report.cases.push({ title: paper.title, pages: paper.pageCount, firstPaintMs,
        mainMaxGapMs: Math.max(0, ...before.mainGaps), nativeUnresponsive: before.unresponsive, pdfReads: before.reads.length });
      report.checks.push(`${paper.pageCount}页真实论文冷启动、尾页跳转、缩放、可见画布数量通过`);
      console.log(JSON.stringify(report.cases.at(-1)));

      if (live && index === 0) {
        await pageInput.fill("7"); await pageInput.press("Enter");
        await page.waitForSelector('.pdf-page-stage[data-page-number="7"][data-rendered="true"]');
        const target = paper.blockData.find((block) => block.kind === "paragraph" && block.pageNumber === 7 && block.text.length > 120 && block.bbox);
        assert(target, "第7页需要真实可命中的段落");
        const targetRegion = page.locator(`.pdf-page-stage[data-page-number="7"] .pdf-block-hit-area[data-block-id="${target.id}"]`).first();
        await targetRegion.scrollIntoViewIfNeeded();
        await targetRegion.focus();
        await page.keyboard.press("Enter");
        await page.getByRole("tab", { name: /学术词汇/ }).click();
        assert.equal(await page.locator(".vocabulary-card").count(), 0);
        await capture("vocabulary-before.png");
        await page.getByRole("tab", { name: "读懂这段", exact: true }).click();
        await targetRegion.dblclick({ force: true });
        await page.getByRole("tab", { name: /学术词汇/ }).click();
        await page.waitForSelector(".vocabulary-empty.is-loading");
        await capture("vocabulary-generating.png");
        await page.getByText("本段词汇已生成", { exact: true }).waitFor({ timeout: 180000 });
        assert(await page.locator(".vocabulary-card").count() > 0, "真实AI应生成有依据的段落词汇");
        await capture("vocabulary-complete.png");
        await page.getByRole("tab", { name: "读懂这段", exact: true }).click();
        await page.getByRole("tab", { name: "翻译", exact: true }).click();
        await page.getByRole("button", { name: "复制译文", exact: true }).waitFor({ timeout: 180000 });
        await capture("paragraph-translation.png");
        await page.getByRole("tab", { name: "解释", exact: true }).click();
        await page.waitForSelector(".assistant-explanation .markdown-content");
        await capture("paragraph-explanation.png");
        const calls = await electron.evaluate(() => globalThis.readerAcceptance.ai);
        assert.deepEqual(calls.map((call) => call.operation).sort(), ["explain", "insight", "translate", "vocabulary"]);
        assert(calls.every((call) => call.deltas > 0), "四项独立真实流应都产生增量");
        console.log("真实段落四项结果完成");
        report.checks.push("双击真实段落触发四项独立请求；词汇生成前空态、生成中、完成与翻译解释通过");
        const mainBeforeAgent = await electron.evaluate(() => globalThis.readerAcceptance.mainGaps.length);
        await page.getByRole("tab", { name: "聊聊", exact: true }).click();
        await page.getByText("就绪", { exact: true }).waitFor();
        const initialized = await electron.evaluate(() => globalThis.readerAcceptance);
        assert.equal(initialized.pi.length, 1);
        assert(Math.max(0, ...initialized.mainGaps.slice(mainBeforeAgent)) < 1000, "Pi初始化不能阻塞主进程");
        await send("先调用 read_research_skill 读取 paper-deep-reading，再读取当前论文第7页。用三句话解释该页一个重要段落，并以 [引用:blockId] 引用该块。不要检索外部文献。");
        await page.waitForSelector(".research-tool-card");
        await capture("agent-tool-chain.png");
        await page.waitForFunction(() => document.querySelectorAll(".research-message.is-assistant .markdown-content").length > 0);
        await capture("agent-streaming.png");
        await waitIdle();
        console.log("真实Agent第1轮完成");
        await page.locator(".research-message.is-assistant .research-inline-citation").first().waitFor();
        await capture("agent-cited-answer.png");
        await page.locator(".research-message.is-assistant .research-inline-citation").first().click();
        assert(await page.locator(".pdf-block-hit-area.is-active").count() > 0, "引用点击应选中原文块");
        await capture("agent-reference-jump.png");
        await send("接着用 search_literature 检索2篇 deep research agent evaluation 相关论文，输出标题、年份和DOI。只检索，不加入文献库。");
        await page.locator('[aria-label="工具：查找相关论文"]').last().waitFor();
        await capture("agent-search-execution.png");
        await waitIdle();
        console.log("真实Agent第2轮完成");
        await page.locator('[aria-label="工具：查找相关论文"] .research-tool-heading').last().click();
        await page.locator(".research-result-item").first().waitFor();
        await capture("agent-search-results.png");
        await send("基于当前论文及刚才的检索，用 create_document 生成中文阅读笔记草稿，约200字。引用原文块，说明检索来源。");
        await waitIdle();
        console.log("真实Agent第3轮完成");
        await page.getByRole("button", { name: "保存 Markdown 文档", exact: true }).waitFor();
        await capture("agent-document.png");
        assert.equal(await page.locator(".research-message.is-user").count(), 3);
        await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 720));
        await capture("agent-compact-light.png");
        await page.getByRole("button", { name: "切换为深色模式", exact: true }).click();
        await capture("agent-compact-dark.png");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const events = await electron.evaluate(() => globalThis.readerAcceptance.events);
        assert(events.filter((event) => event.type === "message_delta").length > 3);
        assert(events.some((event) => event.type === "tool_end" && event.tool === "create_document"));
        report.checks.push("真实Pi三轮对话、工具状态、流式Markdown、原文引用跳转、Crossref检索与文档草稿通过；小窗口明暗主题无横向溢出");
        report.live = { aiCalls: calls, agentEvents: events, piInitMs: initialized.pi[0].ms };

        if (reparse) {
          await page.getByRole("button", { name: "返回文献库", exact: true }).click();
          // Remove only the isolated recognized data, then import the real original anew.
          await page.evaluate(async (id) => {
            await window.zhiyan.invoke("zhiyan:documents:delete", id);
            const remaining = JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1")).filter((entry) => entry.id !== id);
            localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify(remaining));
          }, paper.id);
          await page.reload();
          await page.locator(".import-button input").setInputFiles(path.join(source, "documents", paper.id, "original.pdf"));
          await page.locator(".paper-row").first().click();
          console.log("真实长论文已重新导入，等待MinerU完成");
          await page.getByRole("button", { name: "打开阅读", exact: true }).waitFor();
          await page.waitForFunction(() => document.querySelector('[aria-label="打开阅读"]')?.disabled === false, null, { timeout: 600000 });
          await page.getByRole("button", { name: "打开阅读", exact: true }).click();
          await page.waitForSelector('.pdf-page-stage[data-rendered="true"]');
          await capture("fresh-mineru-reader.png");
          report.checks.push("隔离目录重新导入45页真实PDF、真实MinerU解析后首次打开通过");
        }
      }
      const final = await electron.evaluate(() => globalThis.readerAcceptance);
      assert.equal(final.unresponsive, 0);
      assert(Math.max(0, ...final.mainGaps) < 1000, "全过程主进程出现1秒以上停顿");
    } catch (error) {
      report.failure = error.message;
      report.lastState = await electron.evaluate(() => globalThis.readerAcceptance).catch(() => undefined);
      await capture(`failure-${index}.png`).catch(() => undefined);
      throw error;
    } finally {
      await electron.close();
      const resolved = fs.realpathSync(profile), tempRoot = fs.realpathSync(os.tmpdir());
      assert(path.dirname(resolved) === tempRoot && path.basename(resolved).startsWith("zhiyan-reader-acceptance-"));
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
  (async () => {
    try {
      for (const [index, paper] of papers.entries()) await run(paper, index);
      assert.equal(report.errors.length, 0);
      report.passed = true;
    } finally {
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify({ passed: report.passed, cases: report.cases, checks: report.checks }, null, 2));
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
