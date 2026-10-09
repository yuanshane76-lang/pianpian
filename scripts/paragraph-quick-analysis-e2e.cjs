const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "out", "paragraph-quick-analysis-checks");
const report = { checks: [], errors: [], content: "Real local PDF with deterministic streamed AI responses; no paid requests." };

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const electron = await _electron.launch({
    executablePath: require("electron"),
    args: [path.join(__dirname, "reader-chart-launch.cjs")], cwd: root,
  });
  const page = await electron.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  try {
    await page.waitForSelector(".workspace-shell");
    await electron.evaluate(() => {
      const originalFetch = globalThis.fetch;
      globalThis.paragraphQuickRequests = [];
      globalThis.paragraphQuickStreams = new Map();
      globalThis.fetch = async (url, options) => {
        if (!String(url).endsWith("/chat/completions")) return originalFetch(url, options);
        const body = JSON.parse(options.body);
        const operation = body.messages[0].content.includes("只输出译文") ? "translate" : "explain";
        globalThis.paragraphQuickRequests.push({
          operation, model: body.model, thinking: body.thinking,
          enableThinking: body.enable_thinking, prompt: body.messages[1].content,
        });
        const job = { queue: [], resolve: null };
        globalThis.paragraphQuickStreams.set(operation, job);
        return { ok: true, body: { getReader: () => ({
          read: () => job.queue.length ? Promise.resolve(job.queue.shift()) : new Promise((resolve) => { job.resolve = resolve; }),
          releaseLock: () => undefined,
        }) } };
      };
    });
    const userData = await electron.evaluate(({ app }) => app.getPath("userData"));
    const documents = path.join(userData, "documents");
    const papers = fs.readdirSync(documents).filter((id) => /^[a-f0-9]{64}$/.test(id)).map((id) => {
      const parsed = JSON.parse(fs.readFileSync(path.join(documents, id, "parse.json"), "utf8"));
      return { id, title: parsed.title, authors: [], year: null, sourcePath: `local://paragraph-quick-check/${id}`,
        originalId: id, pageCount: parsed.pageCount, importedAt: "2026-10-09", tags: [], favorite: false,
        overview: null, blocks: parsed.blocks.length, blockData: parsed.blocks, parseVersion: 2, parseStatus: "ready" };
    });
    const paper = papers.find((item) => item.title.includes("Retrieval-Augmented")) || papers[0];
    const paragraph = paper?.blockData.find((block) => block.kind === "paragraph" && block.bbox && block.text.length > 150);
    assert(paragraph, "A real PDF with a positioned paragraph is available");
    await page.evaluate((items) => {
      localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify(items));
      localStorage.removeItem("zhiyan-workbench.analysis.v1");
    }, [paper]);
    await page.reload();
    await page.locator(".paper-row").first().click();
    await page.getByRole("button", { name: "打开阅读", exact: true }).click();
    await page.getByRole("spinbutton", { name: "PDF 页码" }).fill(String(paragraph.pageNumber));
    const hit = page.locator(`[id="pdf-block-${paragraph.id}"]`);
    await hit.waitFor();
    await hit.scrollIntoViewIfNeeded();
    const box = await hit.boundingBox();
    assert(box, "The selected paragraph is visible");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction((id) => document.getElementById(`pdf-block-${id}`)?.getAttribute("aria-pressed") === "true", paragraph.id);
    assert.equal(await electron.evaluate(() => globalThis.paragraphQuickRequests.length), 0);
    const tooltip = hit.locator('[role="tooltip"]');
    await tooltip.waitFor({ state: "visible" });
    assert.equal(await tooltip.textContent(), "双击，翻译并解释整段");
    const hintBounds = await tooltip.boundingBox();
    assert(hintBounds && hintBounds.x >= 0 && hintBounds.x + hintBounds.width <= 1440, "The hint stays inside the viewport");
    await page.screenshot({ path: path.join(output, "01-selected-hint.png") });
    report.checks.push({ name: "single-click-selects-without-ai-and-shows-hint" });

    // Use the actual PDF text layer where possible, rather than forcing overlay clicks.
    const point = await page.evaluate((block) => {
      const stage = document.querySelector(`.pdf-page-stage[data-page-number="${block.pageNumber}"]`);
      const frame = stage.getBoundingClientRect();
      const [left, top, right, bottom] = block.bbox;
      for (const span of stage.querySelectorAll(".pdf-text-layer span")) {
        const rect = span.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (rect.width > 4 && rect.height > 4 && x > frame.left + left * frame.width &&
            x < frame.left + right * frame.width && y > frame.top + top * frame.height &&
            y < frame.top + bottom * frame.height) return { x, y, textLayer: true };
      }
      return { x: frame.left + (left + right) / 2 * frame.width,
        y: frame.top + (top + bottom) / 2 * frame.height, textLayer: false };
    }, paragraph);
    await page.mouse.dblclick(point.x, point.y);
    await page.waitForFunction(() => document.querySelector('[data-operation="translate"] .spin') &&
      document.querySelector('[data-operation="explain"] .spin'));
    const requests = await electron.evaluate(() => globalThis.paragraphQuickRequests);
    assert.equal(requests.length, 2, "Both requests start before either stream finishes");
    assert.deepEqual(requests.map((request) => request.operation).sort(), ["explain", "translate"]);
    for (const request of requests) {
      assert(request.prompt.endsWith(paragraph.text.slice(0, 15000)), "The entire paragraph is the request target");
      assert(request.thinking?.type === "disabled" || request.enableThinking === false, "Thinking remains disabled");
    }
    assert.equal(await page.evaluate(() => getSelection().toString()), "");
    await page.screenshot({ path: path.join(output, "02-both-running.png") });
    report.checks.push({ name: "real-double-click-starts-two-full-paragraph-streams", textLayer: point.textLayer });

    async function emit(operation, text, complete = false) {
      await electron.evaluate((_electron, { operation, text, complete }) => {
        const job = globalThis.paragraphQuickStreams.get(operation);
        let frame = `data: ${JSON.stringify({
          choices: [{ delta: { content: text }, finish_reason: complete ? "stop" : null }],
        })}\n\n`;
        if (complete) frame += "data: [DONE]\n\n";
        const result = { value: new TextEncoder().encode(frame), done: false };
        if (job.resolve) { const resolve = job.resolve; job.resolve = null; resolve(result); }
        else job.queue.push(result);
      }, { operation, text, complete });
    }
    await emit("translate", "模型将外部检索与生成相结合。");
    await emit("explain", "这一段解释了检索模块和生成模块的分工。");
    await page.locator(".assistant-translation").filter({ hasText: "外部检索" }).waitFor();
    await page.locator('[data-operation="explain"]').click();
    await page.locator(".assistant-explanation").filter({ hasText: "分工" }).waitFor();
    await emit("translate", "译文已完成。", true);
    await page.waitForFunction(() => !document.querySelector('[data-operation="translate"] .spin') &&
      document.querySelector('[data-operation="explain"] .spin'));
    await emit("explain", "这有助于理解整篇论文的方法。", true);
    await page.waitForFunction(() => !document.querySelector('[data-operation="explain"] .spin'));
    await page.screenshot({ path: path.join(output, "03-explanation-complete.png") });
    await page.locator('[data-operation="translate"]').click();
    assert((await page.locator(".assistant-translation").textContent()).includes("译文已完成"));
    await page.screenshot({ path: path.join(output, "04-translation-complete.png") });
    report.checks.push({ name: "independent-streaming-and-completion-in-result-tabs" });
    await page.mouse.dblclick(point.x, point.y);
    await page.waitForFunction(() => document.querySelector('[data-operation="translate"]')?.getAttribute("aria-selected") === "true");
    assert.equal(await electron.evaluate(() => globalThis.paragraphQuickRequests.length), 2);
    report.checks.push({ name: "completed-results-reused-without-duplicate-requests" });
    for (const width of [1024, 375]) {
      await page.setViewportSize({ width, height: 812 });
      await page.getByRole("button", { name: "收起助手", exact: true }).click();
      await page.waitForFunction((id) => {
        const hit = document.getElementById(`pdf-block-${id}`);
        return hit && hit.closest(".pdf-page-stage")?.dataset.rendered === "true";
      }, paragraph.id);
      await page.evaluate((id) => document.getElementById(`pdf-block-${id}`)?.scrollIntoView({ block: "center" }), paragraph.id);
      await hit.waitFor({ state: "visible" });
      await tooltip.waitFor({ state: "visible" });
      const bounds = await tooltip.boundingBox();
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, "The bubble fits narrow reading viewports");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const point = await hit.boundingBox();
      await page.mouse.dblclick(point.x + point.width / 2, point.y + Math.min(10, point.height / 2));
      await page.getByRole("button", { name: "收起助手", exact: true }).waitFor();
      assert.equal(await page.locator('[data-operation="translate"]').getAttribute("aria-selected"), "true");
      assert.equal(await electron.evaluate(() => globalThis.paragraphQuickRequests.length), 2);
      await page.screenshot({ path: path.join(output, `05-assistant-${width}.png`) });
      report.checks.push({ name: `hint-and-double-click-reopen-assistant-${width}` });
    }
    assert.deepEqual(report.errors, []);
    report.status = "passed";
    report.paper = paper.title;
    report.paragraphId = paragraph.id;
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.status = "failed";
    report.error = error.stack;
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    await electron.close();
  }
})();
