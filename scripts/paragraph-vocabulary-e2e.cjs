const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (process.versions.electron) {
  const { app } = require("electron");
  app.setPath("userData", process.env.ZHIYAN_VOCABULARY_USER_DATA);
  app.setPath("sessionData", path.join(process.env.ZHIYAN_VOCABULARY_USER_DATA, "session"));
  // Exercise the built application and its real app protocol without competing for a dev port.
  Object.defineProperty(app, "isPackaged", { value: true });
  globalThis.vocabularyE2e = { requests: [], jobs: [], unexpectedRequests: 0 };
  const { createDocumentStore } = require("../electron/document-store.cjs");
  const fixtureDocuments = createDocumentStore({ rootDirectory: path.join(app.getPath("userData"), "documents") });
  globalThis.publishVocabularyFixture = async (paper) => {
    await fixtureDocuments.saveParse(paper.originalId, { resultBatchId: "synthetic-batch", layoutVersion: 2,
      title: paper.title, blocks: paper.blockData, pageCount: 1 });
    await fixtureDocuments.saveTask(paper.originalId, { state: "done", batchId: "synthetic-batch", resultBatchId: "synthetic-batch" });
  };
  globalThis.fetch = async (url, options) => {
    const state = globalThis.vocabularyE2e;
    if (!String(url).endsWith("/chat/completions")) {
      state.unexpectedRequests++;
      throw new Error("External requests are disabled in the isolated vocabulary checks");
    }
    const body = JSON.parse(options.body);
    const instruction = body.messages[0].content;
    const operation = instruction.includes("图表阅读助手") ? "chart"
      : instruction.includes("学术搭配") ? "vocabulary"
      : instruction.includes('"summary"') ? "insight"
      : instruction.includes("只输出译文") ? "translate" : "explain";
    const content = body.messages[1].content;
    state.requests.push({ operation, stream: body.stream, thinking: body.thinking,
      imageAttached: Array.isArray(content) && content.some((item) => item.type === "image_url"),
      prompt: typeof content === "string" ? content : content.find((item) => item.type === "text")?.text });
    const job = { queue: [], resolve: null };
    state.jobs.push(job);
    options.signal.addEventListener("abort", () => {
      const result = { done: true };
      if (job.resolve) { const resolve = job.resolve; job.resolve = null; resolve(result); }
      else job.queue.push(result);
    }, { once: true });
    return { ok: true, body: { getReader: () => ({
      read: () => job.queue.length ? Promise.resolve(job.queue.shift()) : new Promise((resolve) => { job.resolve = resolve; }),
      releaseLock: () => undefined,
    }) } };
  };
  require("../electron/main.cjs");
} else {
  const { _electron } = require("playwright");
  const assert = require("node:assert/strict");
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "out", "paragraph-vocabulary-checks");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "zhiyan-vocabulary-e2e-"));
  const report = { checks: [], errors: [], profile: "isolated synthetic PDF and mocked SSE; no user files or paid services" };
  fs.mkdirSync(path.join(userData, "session"));
  fs.mkdirSync(output, { recursive: true });

  function syntheticPdf() {
    const stream = "BT /F1 22 Tf 60 730 Td (Academic Reading Fixture) Tj /F1 12 Tf 0 -60 Td " +
      "(The model uses attention to select useful features.) Tj 0 -20 Td " +
      "(An ablation study evaluates the model.) Tj 0 -160 Td " +
      "(The hypothesis supports inference and estimation.) Tj 0 -120 Td " +
      "(Method Accuracy) Tj 0 -20 Td (Baseline 40.0) Tj 0 -20 Td (RAG 44.5) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ];
    let data = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => { offsets.push(Buffer.byteLength(data)); data += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(data);
    data += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
    data += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return [...Buffer.from(data)];
  }

  (async () => {
    const electron = await _electron.launch({
      executablePath: require("electron"), args: [__filename], cwd: root,
      env: { ...process.env, ZHIYAN_VOCABULARY_USER_DATA: userData },
    });
    const page = await electron.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => report.errors.push(error.message));
    async function waitForRequest(index) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const request = await electron.evaluate((_electron, index) => globalThis.vocabularyE2e.requests[index], index);
        if (request) return request;
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      throw new Error(`Model request ${index} did not start`);
    }
    async function emit(index, text, complete = false) {
      await electron.evaluate((_electron, { index, text, complete }) => {
        const job = globalThis.vocabularyE2e.jobs[index];
        let frame = `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: complete ? "stop" : null }] })}\n\n`;
        if (complete) frame += "data: [DONE]\n\n";
        const result = { value: new TextEncoder().encode(frame), done: false };
        if (job.resolve) { const resolve = job.resolve; job.resolve = null; resolve(result); }
        else job.queue.push(result);
      }, { index, text, complete });
    }
    try {
      await page.waitForSelector(".workspace-shell");
      assert.equal(await page.locator(".paper-row").count(), 0);
      await page.getByRole("button", { name: "打开单词表", exact: true }).click();
      await page.getByText("暂无收藏", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.evaluate(async () => {
        await window.zhiyan.invoke("zhiyan:settings:save", { aiProvider: "deepseek", deepseek: { apiKey: "synthetic-test-placeholder", model: "deepseek-flash" } });
      });
      await page.reload();
      await page.locator(".import-button input").setInputFiles({
        name: "academic-fixture.pdf", mimeType: "application/pdf", buffer: Buffer.from(syntheticPdf()),
      });
      await page.waitForSelector(".reader-shell");
      await page.waitForSelector('.pdf-page-stage[data-rendered="true"]');
      await page.waitForFunction(() => {
        const paper = JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1") || "[]")[0];
        return paper?.parseStatus === "ready" && paper.blockData?.length > 0;
      });
      assert.equal(await electron.evaluate(() => globalThis.vocabularyE2e.requests.length), 0, "Import and basic extraction do not call a model");
      assert.equal(await page.getByText(/中文预览|后台翻译|导入与翻译/).count(), 0);
      await page.screenshot({ path: path.join(output, "00-import-no-background-ai.png") });
      report.checks.push("Real PDF import and local extraction with configured AI produce zero model requests");
      await page.evaluate(async (bytes) => {
        const saved = await window.zhiyan.invoke("zhiyan:documents:save", { name: "academic-fixture.pdf", data: new Uint8Array(bytes) });
        await window.zhiyan.invoke("zhiyan:settings:save", { aiProvider: "deepseek", deepseek: { apiKey: "synthetic-test-placeholder", model: "deepseek-flash" } });
        const paper = {
          id: saved.id, originalId: saved.id, title: "Academic Reading Fixture", authors: [], year: null, sourcePath: `local://${saved.id}`,
          importedAt: "2026-10-09", tags: [], favorite: false, overview: null, blocks: 3, parseVersion: 2, parseStatus: "ready", pageCount: 1,
          blockData: [
            { id: "fixture-a", kind: "paragraph", pageNumber: 1, order: 0, text: "The model uses attention to select useful features. An ablation study evaluates the model.", bbox: [.09, .14, .92, .20] },
            { id: "fixture-b", kind: "paragraph", pageNumber: 1, order: 1, text: "The hypothesis supports inference and estimation.", bbox: [.09, .36, .92, .40] },
            { id: "fixture-table", kind: "table", pageNumber: 1, order: 2,
              text: "<table><tr><th>Method</th><th>Accuracy</th></tr><tr><td>Baseline</td><td>40.0</td></tr><tr><td>RAG</td><td>44.5</td></tr></table>",
              caption: "Table 1. Accuracy comparison", bbox: [.09, .50, .92, .63] },
          ],
        };
        localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([paper]));
      }, syntheticPdf());
      const fixture = await page.evaluate(() => JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1"))[0]);
      await electron.evaluate(async (_electron, paper) => globalThis.publishVocabularyFixture(paper), fixture);
      await page.reload();
      await page.getByRole("button", { name: "打开阅读", exact: true }).click();
      await page.waitForSelector('.pdf-page-stage[data-rendered="true"]');
      const nonblank = await page.locator(".pdf-page-stage canvas").evaluate((canvas) => {
        const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
        let ink = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] < 180 && data[i + 1] < 180 && data[i + 2] < 180) ink++;
        return ink > 100;
      });
      assert(nonblank, "Synthetic original PDF is visible");
      assert.equal(await electron.evaluate(() => globalThis.vocabularyE2e.requests.length), 0, "Restoring parsed results does not call a model");
      assert.equal(await page.getByText(/中文预览|后台翻译|导入与翻译/).count(), 0);
      report.checks.push("Completed MinerU restore leaves original readable without translation counters or automatic model calls");
      assert.equal(await page.locator(".pipeline-step").count(), 2);
      assert.equal(await page.locator(".reader-processing").count(), 0);
      const beforeToast = await page.locator(".reader-layout").boundingBox();
      await page.locator(".reader-ready-toast").waitFor({ state: "hidden", timeout: 6000 });
      assert.deepEqual(await page.locator(".reader-layout").boundingBox(), beforeToast);
      report.checks.push("Original and positioning statuses stay independent; readiness toast auto-dismisses without moving the PDF");
      await page.locator("#pdf-block-fixture-a").focus();
      await page.keyboard.press("Enter");
      await page.getByRole("tab", { name: /学术词汇/ }).click();
      assert(await page.locator(".vocabulary-panel").getByText("attention", { exact: true }).isVisible());
      assert.equal(await page.locator(".vocabulary-panel").getByText("hypothesis", { exact: true }).count(), 0);
      assert.equal(await electron.evaluate(() => globalThis.vocabularyE2e.requests.length), 0);
      await page.getByRole("button", { name: "AI 精选本段词汇", exact: true }).click();
      await page.waitForSelector(".vocabulary-intro .spin");
      const request = await electron.evaluate(() => globalThis.vocabularyE2e.requests[0]);
      assert.equal(request.operation, "vocabulary");
      assert.equal(request.stream, true);
      assert.deepEqual(request.thinking, { type: "disabled" });
      assert(!request.prompt.includes("hypothesis"), "The model receives only the current paragraph");
      await emit(0, '{"overview":"理解方法与评价。","terms":[{"term":"attention","translation":"注意力","definition":"按相关性选择信息。"},{"term":"ablation study","translation":"消融实验","definition":"移除组件检验贡献。"}]}', true);
      await page.getByText("本段词汇已生成", { exact: true }).waitFor();
      await page.getByRole("button", { name: "将 attention 加入单词表", exact: true }).click();
      await page.getByRole("button", { name: "attention 已加入单词表", exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, "01-paragraph-vocabulary.png") });
      report.checks.push("Paragraph-only vocabulary, real secure IPC, SSE request and explicit collection");

      await page.getByRole("tab", { name: "读懂这段", exact: true }).click();
      const arrow = page.locator(".assistant-overview > summary > svg");
      assert.equal(await arrow.evaluate((element) => getComputedStyle(element).outlineStyle), "none");
      await page.locator(".assistant-overview").evaluate((element) => { element.open = true; });
      await page.waitForFunction(() => getComputedStyle(document.querySelector(".assistant-overview > summary > svg")).transform.startsWith("matrix(-1"));
      await page.locator(".assistant-overview").evaluate((element) => { element.open = false; });
      report.checks.push("Disclosure arrow rotates when open and has no persistent focus outline");
      await page.getByRole("tab", { name: "摘要与作用", exact: true }).click();
      await page.waitForSelector(".paragraph-progress");
      await emit(1, '{"summary":"这段介绍注意力');
      await page.locator(".assistant-insight").getByText("这段介绍注意力", { exact: true }).waitFor();
      assert.equal(await page.locator(".assistant-insight").getAttribute("aria-busy"), "true");
      await page.screenshot({ path: path.join(output, "02-streaming-insight.png") });
      await emit(1, '机制。","role":"连接方法与评价。"}', true);
      await page.locator(".assistant-insight").getByText("连接方法与评价。", { exact: true }).waitFor();
      await page.getByRole("tab", { name: "解释", exact: true }).click();
      await page.waitForSelector(".assistant-explanation .spin");
      await emit(2, "## 核心术语\n\n**注意力**：根据相关性选择信息。\n\n- 方法：分配权重。\n- 评价：消融实验。\n\n| 术语 | 含义 |\n| --- | --- |\n| ablation | 消融 |\n\n<img src=\"https://example.com/track.png\">\n\n[引用](javascript:alert(1))", true);
      await page.locator(".assistant-explanation h2").getByText("核心术语", { exact: true }).waitFor();
      assert.equal(await page.locator(".assistant-explanation strong").first().textContent(), "注意力");
      assert.equal(await page.locator(".assistant-explanation li").count(), 2);
      assert.equal(await page.locator(".assistant-explanation table").count(), 1);
      assert.equal(await page.locator(".assistant-explanation img, .assistant-explanation a").count(), 0);
      await page.screenshot({ path: path.join(output, "03-markdown-explanation.png") });
      report.checks.push("Summary visible before completion; Markdown headings, emphasis, lists, GFM table and HTML safety");

      await page.getByRole("tab", { name: "翻译", exact: true }).click();
      await page.waitForSelector('.assistant-translation[aria-busy="true"]');
      await emit(3, "用户主动生成的");
      await page.locator(".assistant-translation").getByText("用户主动生成的", { exact: true }).waitFor();
      await emit(3, "即时译文。", true);
      await page.locator(".assistant-translation").getByText("用户主动生成的即时译文。", { exact: true }).waitFor();
      assert.equal(await page.locator(".assistant-translation").getAttribute("aria-busy"), "false");
      await page.screenshot({ path: path.join(output, "05-on-demand-translation.png") });
      report.checks.push("Only explicit translate click starts a streaming translation");

      await page.locator("#pdf-block-fixture-table").focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "读图表", exact: true }).click();
      await page.waitForSelector(".chart-reading-progress");
      await page.waitForFunction(() => document.querySelector(".chart-context .figure-image-button img")?.complete);
      const chartRequest = await waitForRequest(4);
      assert.equal(chartRequest.operation, "chart");
      assert.equal(chartRequest.stream, true);
      assert.equal(chartRequest.imageAttached, true);
      assert.deepEqual(chartRequest.thinking, { type: "disabled" });
      await emit(4, '{"summary":"图表逐步比较成绩');
      await page.locator(".assistant-chart-streaming").getByText("图表逐步比较成绩", { exact: true }).waitFor();
      assert(!(await page.locator(".assistant-chart-streaming").innerText()).includes("summary"));
      assert(!(await page.evaluate(() => localStorage.getItem("zhiyan-workbench.analysis.v1"))).includes("图表逐步"));
      await page.screenshot({ path: path.join(output, "06-streaming-chart.png") });
      await emit(4, '。","encoding":"准确率越高越好","findings":["RAG 44.5，Baseline 40.0"],"role":"比较实验结果","caveats":["仅比较该实验条件"]}', true);
      await page.locator(".assistant-chart-reading").getByText("RAG 44.5，Baseline 40.0", { exact: true }).waitFor();
      assert.equal(await page.locator(".assistant-chart-streaming").count(), 0);
      report.checks.push("Image chart request disables thinking, streams readable fields before completion and caches only validated final results");

      await page.getByRole("button", { name: "打开单词表", exact: true }).click();
      await page.getByRole("dialog", { name: "单词表", exact: true }).waitFor();
      assert(await page.locator(".wordbook-entry").getByText("attention", { exact: true }).isVisible());
      await page.getByRole("button", { name: "将 attention 标记为已掌握", exact: true }).click();
      await page.getByRole("combobox", { name: "掌握状态", exact: true }).selectOption("learning");
      assert.equal(await page.locator(".wordbook-entry").count(), 0);
      await page.getByRole("combobox", { name: "掌握状态", exact: true }).selectOption("all");
      await page.getByRole("textbox", { name: "搜索单词表", exact: true }).fill("注意力");
      assert.equal(await page.locator(".wordbook-entry").count(), 1);
      const modal = page.getByRole("dialog", { name: "单词表", exact: true });
      for (const [name, width, height] of [["desktop", 1440, 920], ["laptop", 1024, 768], ["mobile", 390, 844], ["short", 640, 400]]) {
        await page.setViewportSize({ width, height });
        const bounds = await modal.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const controls = [...element.querySelectorAll("button, input, select")].filter((item) => {
            const rect = item.getBoundingClientRect();
            return rect.width && rect.height;
          });
          return { fits: rect.x >= 0 && rect.right <= innerWidth + 1 && rect.y >= 0 && rect.bottom <= innerHeight + 1,
            horizontalOverflow: element.scrollWidth - element.clientWidth,
            controlsFit: controls.every((item) => { const rect = item.getBoundingClientRect(); return rect.x >= 0 && rect.right <= innerWidth + 1; }) };
        });
        assert(bounds.fits && bounds.horizontalOverflow <= 1 && bounds.controlsFit, `${name}: modal and controls fit`);
        const progressFits = await page.locator(".pipeline-status-bar").evaluate((bar) => {
          const rect = bar.getBoundingClientRect();
          return [...bar.querySelectorAll(".pipeline-step, .pipeline-control")].every((element) => {
            const child = element.getBoundingClientRect();
            return child.left >= rect.left && child.right <= rect.right + 1 && child.top >= rect.top && child.bottom <= rect.bottom + 1;
          });
        });
        assert(progressFits, `${name}: reading status fits`);
        await page.screenshot({ path: path.join(output, `04-wordbook-${name}.png`) });
        report.checks.push({ name: `wordbook-${name}`, width, height, bounds });
      }
      await page.setViewportSize({ width: 1440, height: 920 });
      await page.locator(".wordbook-source button").click();
      await page.waitForSelector('.pdf-block-hit-area.is-active[id="pdf-block-fixture-a"]');
      assert.equal(await modal.count(), 0);
      await page.reload();
      await page.getByRole("button", { name: "打开单词表", exact: true }).click();
      await page.getByRole("button", { name: "将 attention 标记为待熟悉", exact: true }).waitFor();
      await page.getByRole("button", { name: "从单词表移除 attention", exact: true }).click();
      await page.getByText("暂无收藏", { exact: true }).waitFor();
      report.checks.push("Mastery, search, filters, source jump, reload persistence and removal");
      const state = await electron.evaluate(() => ({
        count: globalThis.vocabularyE2e.requests.length,
        unexpectedRequests: globalThis.vocabularyE2e.unexpectedRequests,
        requests: globalThis.vocabularyE2e.requests.map(({ operation, stream, thinking }) => ({ operation, stream, thinking })),
      }));
      assert.equal(state.count, 5);
      assert.equal(state.unexpectedRequests, 0);
      assert.deepEqual(report.errors, []);
      report.transport = state;
      report.status = "passed";
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      report.status = "failed";
      report.error = error.message;
      await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => undefined);
      console.error(error);
      process.exitCode = 1;
    } finally {
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
      await electron.close();
    }
  })().catch((error) => { console.error(error); process.exitCode = 1; });
}
