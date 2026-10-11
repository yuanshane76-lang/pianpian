const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "out", "reader-chart-checks");
const liveAi = process.argv.includes("--live-ai");
const report = { checks: [], errors: [] };

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const electron = await _electron.launch({
    executablePath: require("electron"), args: [path.join(__dirname, "reader-chart-launch.cjs")], cwd: root,
    env: { ...process.env, ZHIYAN_E2E_LIVE_AI: liveAi ? "1" : "0" },
  });
  const page = await electron.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  try {
    await page.waitForSelector(".workspace-shell");
    const userData = await electron.evaluate(({ app }) => app.getPath("userData"));
    const documents = path.join(userData, "documents");
    const fixtures = fs.readdirSync(documents).filter((id) => /^[a-f0-9]{64}$/.test(id)).map((id) => {
      const result = JSON.parse(fs.readFileSync(path.join(documents, id, "parse.json"), "utf8"));
      return { id, title: result.title, authors: [], year: null, sourcePath: `local://reader-e2e/${id}`,
        originalId: id, pageCount: result.pageCount, importedAt: "2026-10-09", tags: [], favorite: false,
        blocks: result.blocks.length, blockData: result.blocks, parseVersion: 2, parseStatus: "ready" };
    });
    await page.evaluate((papers) => localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify(papers)), fixtures);
    await page.reload();
    await page.waitForSelector(".paper-row");
    const row = page.locator(".paper-row").filter({ hasText: "Retrieval-Augmented" }).first();
    if (await row.count()) await row.click();
    else await page.locator(".paper-row").filter({ hasText: "Attention" }).first().click();
    await page.getByRole("button", { name: "打开阅读", exact: true }).click();
    await page.waitForSelector(".pdf-block-hit-area");
    const original = await page.evaluate(() => JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1") || "[]"));
    const title = await page.locator(".reader-title strong").textContent();
    const paper = original.find((item) => item.title === title);
    assert(paper, "A real MinerU-parsed paper is available");
    const table = paper.blockData.find((block) => block.kind === "table" && block.bbox);
    const image = paper.blockData.find((block) => block.kind === "image" && block.bbox);
    const paragraph = paper.blockData.find((block) => block.kind === "paragraph" && block.pageNumber === (table?.pageNumber || 1) && block.bbox && block.text.length > 120);
    assert(table && paragraph, "The paper contains a table and paragraph");
    const adjacentCanvasCheck = await page.evaluate(() => {
      const slots = [...document.querySelectorAll(".pdf-page-slot")].slice(0, 2);
      const canvases = slots.map((slot) => slot.querySelector("canvas"));
      return {
        slotCount: document.querySelectorAll(".pdf-page-slot").length,
        canvasCount: canvases.filter(Boolean).length,
        firstBottom: slots[0]?.getBoundingClientRect().bottom ?? 0,
        secondTop: slots[1]?.getBoundingClientRect().top ?? 0,
        sameScrollSurface: Boolean(document.querySelector(".pdf-page-stack")?.closest(".pdf-canvas-scroll")),
      };
    });
    assert(adjacentCanvasCheck.slotCount > 1 && adjacentCanvasCheck.canvasCount > 1 && adjacentCanvasCheck.sameScrollSurface,
      "Adjacent PDF pages must share one continuous scroll surface");
    report.checks.push({ name: "continuous-adjacent-pages", adjacentCanvasCheck });

    await electron.evaluate(() => {
      const originalFetch = globalThis.fetch;
      globalThis.readerChartRequests = [];
      globalThis.fetch = async (url, options) => {
        if (String(url).endsWith("/chat/completions")) {
          const body = JSON.parse(options.body);
          globalThis.readerChartRequests.push({
            model: body.model, thinking: body.thinking, enableThinking: body.enable_thinking,
            imageLength: Array.isArray(body.messages?.[1]?.content)
              ? body.messages[1].content.find((item) => item.type === "image_url")?.image_url?.url?.length || 0 : 0,
          });
        }
        return originalFetch(url, options);
      };
    });

    async function ready(number) {
      await page.waitForFunction((target) => document.querySelector('[aria-label="PDF 页码"]')?.value === String(target)
        && document.querySelector(`.pdf-page-slot[data-page-number="${target}"] canvas`)
        && document.querySelector(`.pdf-page-slot[data-page-number="${target}"] .pdf-structure-overlay`), number);
    }
    async function go(number) {
      await page.getByRole("spinbutton", { name: "PDF 页码" }).fill(String(number));
      await ready(number);
    }
    async function select(block) {
      await go(block.pageNumber);
      const target = page.locator(`[id="pdf-block-${block.id}"]`);
      await target.scrollIntoViewIfNeeded();
      const frame = await target.boundingBox();
      await target.click({ force: true, position: { x: frame.width / 2, y: Math.min(frame.height / 2, 10) } });
      await page.waitForFunction((id) => document.getElementById(`pdf-block-${id}`)?.getAttribute("aria-pressed") === "true", block.id);
    }

    await go(2);
    const scroll = page.locator(".pdf-canvas-scroll");
    await scroll.evaluate((element) => {
      const target = element.querySelector('.pdf-page-slot[data-page-number="3"]');
      element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - element.clientHeight / 2;
    });
    await page.waitForFunction(() => document.querySelector('.pdf-page-slot[data-page-number="2"] [data-rendered="true"]')
      && document.querySelector('.pdf-page-slot[data-page-number="3"] [data-rendered="true"]'));
    await page.screenshot({ path: path.join(output, "00-continuous-page-seam.png") });
    const seam = await scroll.evaluate((element) => {
      const viewport = element.getBoundingClientRect();
      return [2, 3].map((number) => {
        const canvas = element.querySelector(`.pdf-page-slot[data-page-number="${number}"] canvas`).getBoundingClientRect();
        return Math.min(canvas.bottom, viewport.bottom) - Math.max(canvas.top, viewport.top);
      });
    });
    assert(seam.every((height) => height > 100), "The same viewport shows substantial content from both adjacent pages");
    await scroll.hover({ position: { x: 40, y: 100 } });
    const beforeWheel = await scroll.evaluate((element) => element.scrollTop);
    await page.mouse.wheel(0, 160);
    await page.waitForFunction((before) => document.querySelector(".pdf-canvas-scroll").scrollTop > before + 100, beforeWheel);
    const afterWheel = await scroll.evaluate((element) => element.scrollTop);
    assert(Math.abs(afterWheel - beforeWheel - 160) < 5, "Wheel scrolling moves by the requested distance without page jumps");
    await page.mouse.wheel(0, -160);
    await page.waitForFunction((before) => Math.abs(document.querySelector(".pdf-canvas-scroll").scrollTop - before) < 5, beforeWheel);
    report.checks.push({ name: "continuous-seam-and-native-wheel", seam, beforeWheel, afterWheel });

    const visibleBlockId = await scroll.evaluate((element) => {
      const frame = element.getBoundingClientRect();
      return [...element.querySelectorAll('.pdf-page-slot[data-page-number="2"] .pdf-block-hit-area')]
        .find((target) => {
          const rectangle = target.getBoundingClientRect();
          return rectangle.top >= frame.top + 5 && rectangle.bottom < frame.bottom - 5;
        })?.id;
    });
    assert(visibleBlockId, "A previous-page block is available at the shared page seam");
    const previousPageTarget = page.locator(`[id="${visibleBlockId}"]`);
    await previousPageTarget.click({ force: true, position: { x: 10, y: 5 } });
    await page.waitForFunction((id) => document.getElementById(id)?.getAttribute("aria-pressed") === "true", visibleBlockId);
    const afterPreviousPageSelection = await scroll.evaluate((element) => element.scrollTop);
    assert(Math.abs(afterPreviousPageSelection - beforeWheel) < 5, "Selecting the previous page preserves the seam viewport");
    report.checks.push({ name: "previous-page-selection-without-scroll-reset", visibleBlockId, afterPreviousPageSelection });

    await go(paper.pageCount);
    await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight - element.clientHeight - 120; });
    const bottomAnchor = await scroll.evaluate((element, number) => {
      const frame = element.getBoundingClientRect();
      const slot = element.querySelector(`.pdf-page-slot[data-page-number="${number}"]`).getBoundingClientRect();
      return { page: number, fraction: (frame.top - slot.top) / slot.height };
    }, paper.pageCount);
    await page.getByRole("button", { name: "缩小 PDF", exact: true }).click();
    await page.waitForFunction((number) => document.querySelector(`.pdf-page-slot[data-page-number="${number}"] [data-rendered="true"]`), paper.pageCount);
    const afterBottomZoom = await scroll.evaluate((element, number) => {
      const frame = element.getBoundingClientRect();
      const slot = element.querySelector(`.pdf-page-slot[data-page-number="${number}"]`).getBoundingClientRect();
      return { page: Number(document.querySelector('[aria-label="PDF 页码"]').value), fraction: (frame.top - slot.top) / slot.height };
    }, paper.pageCount);
    assert(Math.abs(bottomAnchor.fraction - afterBottomZoom.fraction) < .015, "Zoom near the document end retains the current page anchor after native scroll clamping");
    report.checks.push({ name: "bottom-page-zoom-anchor", bottomAnchor, afterBottomZoom });
    await page.getByRole("button", { name: "适应宽度", exact: true }).click();

    await select(table);
    await page.locator(".assistant-chart-preview img").waitFor();
    assert.equal(await page.getByRole("button", { name: "翻译整段", exact: true }).count(), 0);
    await page.getByRole("button", { name: "放大选中图表" }).click();
    await page.getByRole("dialog", { name: "选中图表放大预览" }).waitFor();
    await page.getByRole("button", { name: "关闭图表预览" }).click();
    await page.screenshot({ path: path.join(output, "01-table-preview.png") });
    report.checks.push({ name: "table-image-preview-no-translation", page: table.pageNumber, block: table.id });
    if (image) {
      await select(image);
      await page.locator(".assistant-chart-preview img").waitFor();
      assert.equal(await page.getByRole("button", { name: "翻译整段", exact: true }).count(), 0);
      await page.screenshot({ path: path.join(output, "02-figure-preview.png") });
      report.checks.push({ name: "figure-image-preview-no-translation", page: image.pageNumber, block: image.id });
    }

    if (liveAi) {
      await select(paragraph);
      await page.getByRole("button", { name: "翻译整段", exact: true }).click();
      await page.waitForFunction(() => /[\u3400-\u9fff]/.test(document.querySelector(".assistant-translation p")?.textContent || "")
        || document.querySelector(".assistant-action-error"), null, { timeout: 120000 });
      await page.waitForFunction(() => !document.querySelector(".selected-context button:disabled"), null, { timeout: 120000 });
      assert.equal(await page.locator(".assistant-action-error").count(), 0, await page.evaluate(() => document.querySelector(".assistant-action-error")?.textContent || ""));
      const translation = await page.locator(".assistant-translation p").textContent();
      assert(/[\u3400-\u9fff]/.test(translation), "Real translation contains Chinese");
      report.checks.push({ name: "live-non-thinking-translation", translation });
      await page.screenshot({ path: path.join(output, "03-live-translation.png") });
      await select(table);
      await page.locator(".chart-context").getByRole("button", { name: "读图表", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".assistant-chart-reading") || document.querySelector(".assistant-action-error"), null, { timeout: 120000 });
      assert.equal(await page.locator(".assistant-action-error").count(), 0, await page.evaluate(() => document.querySelector(".assistant-action-error")?.textContent || ""));
      const reading = await page.locator(".assistant-chart-reading").textContent();
      assert(reading.includes("关键发现") && reading.includes("注意事项"), "Structured chart results render");
      report.checks.push({ name: "live-image-table-reading", reading });
      await page.screenshot({ path: path.join(output, "04-live-table-reading.png") });
      const requests = await electron.evaluate(() => globalThis.readerChartRequests);
      assert(requests.some((request) => request.imageLength > 1000), "A real chart request includes image bytes");
      assert(requests.some((request) => !request.imageLength && (request.thinking?.type === "disabled" || request.enableThinking === false)), "Translation thinking is disabled on the actual network request");
      report.requests = requests;
      const count = requests.length;
      await select(paragraph); await select(table);
      await page.locator(".chart-context").getByRole("button", { name: "读图表", exact: true }).click();
      assert.equal((await electron.evaluate(() => globalThis.readerChartRequests)).length, count, "Chart result is reused from cache");
      await page.reload();
      await page.waitForSelector(".workspace-shell");
      await page.locator(".paper-row").filter({ hasText: paper.title }).first().click();
      await page.getByRole("button", { name: "打开阅读", exact: true }).click();
      await select(table);
      await page.locator(".assistant-chart-reading").waitFor();
      report.checks.push({ name: "chart-cache-reload" });
    }

    await select(table);
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 920 });
      await page.waitForTimeout(250);
      await ready(table.pageNumber);
      const overflow = await page.evaluate(() => ({
        outer: document.documentElement.scrollWidth - window.innerWidth,
        assistant: document.querySelector(".reader-assistant").scrollWidth - document.querySelector(".reader-assistant").clientWidth,
        image: document.querySelector(".assistant-chart-preview img")?.naturalWidth || 0,
      }));
      assert(overflow.outer <= 1 && overflow.assistant <= 1 && overflow.image > 0, "No reader overflow or broken preview");
      await page.screenshot({ path: path.join(output, `05-layout-${width}.png`) });
      report.checks.push({ name: `layout-${width}`, overflow });
    }
    assert.deepEqual(report.errors, []);
    report.status = "passed";
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.status = "failed"; report.error = error.message;
    process.exitCode = 1;
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    console.error(error.message);
  } finally {
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    await electron.close();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
