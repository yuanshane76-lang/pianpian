const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (process.versions.electron) {
  const { app } = require("electron");
  app.setPath("userData", process.env.ZHIYAN_LAYOUT_USER_DATA);
  app.setPath("sessionData", path.join(process.env.ZHIYAN_LAYOUT_USER_DATA, "session"));
  Object.defineProperty(app, "isPackaged", { value: true });
  globalThis.layoutExternalRequests = 0;
  globalThis.fetch = async () => {
    globalThis.layoutExternalRequests++;
    throw new Error("External services are disabled in the isolated reader layout checks");
  };
  const { createDocumentStore } = require("../electron/document-store.cjs");
  const documents = createDocumentStore({ rootDirectory: path.join(app.getPath("userData"), "documents") });
  globalThis.publishLayoutFixture = async (paper) => {
    await documents.saveParse(paper.originalId, {
      resultBatchId: "synthetic-layout", layoutVersion: 3,
      title: paper.title, blocks: paper.blockData, pageCount: 2,
    });
    await documents.saveTask(paper.originalId, { state: "done", batchId: "synthetic-layout", resultBatchId: "synthetic-layout" });
  };
  require("../electron/main.cjs");
} else {
  const assert = require("node:assert/strict");
  const { _electron } = require("playwright");
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "out", "reader-layout-checks");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "zhiyan-layout-e2e-"));
  const report = { checks: [], failures: [], errors: [], profile: "isolated synthetic PDF; no keys, user papers or external services" };
  fs.mkdirSync(path.join(userData, "session"));
  fs.mkdirSync(output, { recursive: true });

  function syntheticPdf() {
    const streams = [
      "BT /F1 24 Tf 60 720 Td (1 Introduction) Tj /F1 18 Tf 0 -80 Td (1.1 Context) Tj " +
      "/F1 12 Tf 0 -50 Td (The model uses evidence to answer a question.) Tj 0 -20 Td " +
      "(Original paragraphs remain selectable after resizing.) Tj 0 -160 Td " +
      "(Method        Accuracy) Tj 0 -25 Td (Baseline      40.0) Tj 0 -25 Td (Model         44.5) Tj " +
      "0 -100 Td (E = m c^2) Tj ET",
      "BT /F1 24 Tf 60 720 Td (2 Method) Tj /F1 18 Tf 0 -70 Td (2.1 Dataset) Tj " +
      "/F1 16 Tf 0 -80 Td (2.1.1 Training) Tj /F1 12 Tf 0 -50 Td " +
      "(The experiment evaluates a synthetic dataset.) Tj ET",
    ];
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Count 2 /Kids [4 0 R 6 0 R] >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    streams.forEach((stream, index) => {
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`);
      objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    });
    let data = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => { offsets.push(Buffer.byteLength(data)); data += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(data);
    data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    data += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
    data += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return [...Buffer.from(data)];
  }

  (async () => {
    const electron = await _electron.launch({
      executablePath: require("electron"), args: [__filename], cwd: root,
      env: { ...process.env, ZHIYAN_LAYOUT_USER_DATA: userData },
    });
    const page = await electron.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => report.errors.push(error.message));
    async function geometry() {
      return page.locator(".reader-layout").evaluate((layout) => {
        const frame = layout.getBoundingClientRect();
        const bounds = (selector) => {
          const rect = layout.querySelector(selector)?.getBoundingClientRect();
          return rect ? { x: rect.x, right: rect.right, width: rect.width, center: rect.x + rect.width / 2 } : null;
        };
        return { width: frame.width, right: frame.right, outline: bounds(".reader-outline"),
          document: bounds(".reader-document"), assistant: bounds(".reader-assistant"),
          leftSeparator: bounds(".reader-resizer-left"), rightSeparator: bounds(".reader-resizer-right") };
      });
    }
    async function expectFit(width) {
      await page.waitForFunction(() => {
        const layout = document.querySelector(".reader-layout");
        const frame = layout.getBoundingClientRect();
        const original = layout.querySelector(".reader-document").getBoundingClientRect();
        const assistant = layout.querySelector(".reader-assistant")?.getBoundingClientRect();
        return original.width >= 319 && (!assistant || assistant.right <= frame.right + 1);
      });
      const bounds = await geometry();
      assert(bounds.document.width >= 319, `${width}: original has at least 320px`);
      assert(!bounds.assistant || bounds.assistant.right <= bounds.right + 1, `${width}: assistant fits`);
      if (bounds.outline) assert(Math.abs(bounds.leftSeparator.center - bounds.outline.right) < 1, "Left separator aligns with the panel boundary");
      if (bounds.assistant) assert(Math.abs(bounds.rightSeparator.center - bounds.assistant.x) < 1, "Right separator aligns with the panel boundary");
      return bounds;
    }
    async function drag(separator, delta) {
      const box = await separator.boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + delta, y, { steps: 8 });
      await page.mouse.up();
      assert.equal(await page.locator("body").evaluate((body) => body.classList.contains("is-reader-resizing")), false);
    }
    try {
      await page.waitForSelector(".workspace-shell");
      await page.setViewportSize({ width: 1440, height: 920 });
      await page.evaluate(async (bytes) => {
        const saved = await window.zhiyan.invoke("zhiyan:documents:save", { name: "reader-layout-fixture.pdf", data: new Uint8Array(bytes) });
        const block = (id, kind, text, pageNumber, bbox, headingLevel) => ({
          id, kind, text, pageNumber, bbox, ...(headingLevel ? { headingLevel } : {}),
        });
        const blocks = [
          block("introduction", "heading", "1 Introduction", 1, [.09, .065, .8, .11], 1),
          block("context", "heading", "1.1 Context", 1, [.09, .175, .8, .215], 2),
          block("paragraph", "paragraph", "The model uses evidence to answer a question. Original paragraphs remain selectable after resizing.", 1, [.09, .245, .92, .30]),
          block("table", "table", "Method Accuracy\nBaseline 40.0\nModel 44.5", 1, [.09, .475, .8, .59]),
          block("equation", "equation", "E = m c^2", 1, [.09, .66, .6, .70]),
          block("method", "heading", "2 Method", 2, [.09, .065, .8, .11], 1),
          block("dataset", "heading", "2.1 Dataset", 2, [.09, .15, .8, .20], 2),
          block("training", "heading", "2.1.1 Training", 2, [.09, .25, .8, .30], 3),
        ].map((item, order) => ({ ...item, order }));
        localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([{
          id: saved.id, originalId: saved.id, title: "Reader Layout Fixture", authors: [], year: null,
          sourcePath: `local://${saved.id}`, importedAt: "2026-10-10", tags: [], favorite: false,
          overview: null, blocks: blocks.length, blockData: blocks, parseVersion: 2, parseStatus: "ready", pageCount: 2,
        }]));
      }, syntheticPdf());
      const fixture = await page.evaluate(() => JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1"))[0]);
      await electron.evaluate(async (_electron, paper) => globalThis.publishLayoutFixture(paper), fixture);
      await page.reload();
      await page.getByRole("button", { name: "打开阅读", exact: true }).click();
      await page.waitForSelector('.pdf-page-stage[data-rendered="true"]');
      await page.locator(".reader-ready-toast").waitFor({ state: "hidden", timeout: 6000 });
      assert.equal(await page.locator(".outline-pages").count(), 0);
      assert.deepEqual(await page.locator(".outline-heading").evaluateAll((items) => items.map((item) => [
        item.textContent, item.dataset.headingLevel, getComputedStyle(item).paddingInlineStart,
      ])), [
        ["1 Introduction", "1", "9px"], ["1.1 Context", "2", "23px"],
        ["2 Method", "1", "9px"], ["2.1 Dataset", "2", "23px"], ["2.1.1 Training", "3", "37px"],
      ]);
      await page.screenshot({ path: path.join(output, "01-outline-default.png") });
      report.checks.push("Real PDF original and headings with three indentation levels; no page-number list");
      const beforeDrag = await page.locator('.pdf-page-stage[data-page-number="1"] .pdf-text-layer span').filter({ hasText: "The model uses evidence" }).evaluate((span) => {
        const range = document.createRange();
        range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 28);
        const rect = range.getBoundingClientRect();
        return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 };
      });
      await page.mouse.move(beforeDrag.left + .2, beforeDrag.y); await page.mouse.down();
      await page.mouse.move(beforeDrag.right - .2, beforeDrag.y, { steps: 10 }); await page.mouse.up();
      report.mouseSelectionBeforeResize = await page.evaluate(() => window.getSelection().toString());
      await page.evaluate(() => window.getSelection().removeAllRanges());

      const left = page.getByRole("separator", { name: "调整目录宽度" });
      const right = page.getByRole("separator", { name: "调整篇篇侧栏宽度" });
      await drag(left, 80);
      await drag(right, -80);
      const bounds = await expectFit(1440);
      assert.equal(Math.round(bounds.outline.width), 255);
      assert.equal(Math.round(bounds.assistant.width), 460);
      await page.screenshot({ path: path.join(output, "02-panels-resized.png") });
      report.checks.push({ name: "Pointer drag changes both boundaries and the middle PDF width", bounds });

      await page.locator(".outline-heading").getByText("2.1.1 Training", { exact: true }).click();
      await page.waitForSelector('#pdf-block-training.is-active');
      await page.waitForFunction(() => document.querySelector('[aria-label="PDF 页码"]').value === "2");
      assert(await page.locator("#pdf-block-training").isVisible());
      assert(await page.locator("#pdf-block-training").evaluate((target) => {
        const rect = target.getBoundingClientRect();
        const view = target.closest(".pdf-canvas-scroll").getBoundingClientRect();
        return rect.top >= view.top && rect.bottom <= view.bottom;
      }), "Outline target is inside the PDF scroll viewport");
      await page.getByRole("button", { name: "放大 PDF", exact: true }).click();
      await page.waitForSelector('.pdf-page-stage[data-page-number="2"][data-rendered="true"]');
      await page.locator(".outline-heading").getByText("1 Introduction", { exact: true }).click();
      await page.bringToFront();
      await page.waitForSelector('#pdf-block-introduction.is-active');
      await page.getByRole("button", { name: "适应宽度", exact: true }).click();
      await page.waitForSelector('.pdf-page-stage[data-page-number="1"][data-rendered="true"]');
      for (const id of ["table", "equation"]) {
        const target = page.locator(`#pdf-block-${id}`);
        await target.scrollIntoViewIfNeeded();
        const alignment = await target.evaluate((hit, bbox) => {
          const canvas = hit.closest(".pdf-page-stage").querySelector("canvas").getBoundingClientRect();
          const rect = hit.getBoundingClientRect();
          return [Math.abs(rect.left - (canvas.left + bbox[0] * canvas.width)),
            Math.abs(rect.top - (canvas.top + bbox[1] * canvas.height)),
            Math.abs(rect.width - (bbox[2] - bbox[0]) * canvas.width),
            Math.abs(rect.height - (bbox[3] - bbox[1]) * canvas.height)];
        }, fixture.blockData.find((item) => item.id === id).bbox);
        assert(alignment.every((difference) => difference < 1), `${id}: normalized bbox stays aligned with canvas`);
        const rect = await target.boundingBox();
        await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
        await page.waitForSelector(`#pdf-block-${id}.is-active`);
      }
      await page.locator(".outline-heading").getByText("1 Introduction", { exact: true }).click();
      const selectedRange = await page.locator('.pdf-page-stage[data-page-number="1"] .pdf-text-layer span').filter({ hasText: "The model uses evidence" }).evaluate((span) => {
        const range = document.createRange();
        range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 28);
        const rect = range.getBoundingClientRect();
        return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 };
      });
      await page.mouse.move(selectedRange.left + .2, selectedRange.y);
      await page.mouse.down();
      for (let step = 1; step <= 10; step++) {
        await page.evaluate(() => new Promise(requestAnimationFrame));
        await page.mouse.move(selectedRange.left + (selectedRange.right - selectedRange.left - .2) * step / 10, selectedRange.y);
      }
      await page.mouse.up();
      const selection = await page.evaluate(() => window.getSelection().toString());
      if (selection !== "The model uses evidence to a") report.failures.push({
        name: "Real mouse text selection", expected: "The model uses evidence to a", actual: selection,
        beforeAnyResize: report.mouseSelectionBeforeResize,
      });
      const programmaticSelection = await page.locator('.pdf-page-stage[data-page-number="1"] .pdf-text-layer span').filter({ hasText: "The model uses evidence" }).evaluate((span) => {
        const range = document.createRange(); range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 28);
        window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
        const text = window.getSelection().toString();
        span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return text;
      });
      assert.equal(programmaticSelection, "The model uses evidence to a");
      await page.waitForSelector('#pdf-block-paragraph.is-active');
      await page.getByRole("heading", { name: "选中句子", exact: true }).waitFor();
      await page.evaluate(() => window.getSelection().removeAllRanges());
      report.checks.push("Heading targets enter the viewport; zoom and actual table/equation coordinate clicks stay aligned");
      report.checks.push("Programmatic text-layer range reaches the selected-sentence UI; real mouse result recorded separately");

      await left.focus(); await page.keyboard.press("End");
      await right.focus(); await page.keyboard.press("End");
      for (const width of [1120, 980, 900, 841]) {
        await page.setViewportSize({ width, height: 920 });
        report.checks.push({ name: "Window resize retains readable original and visible assistant", width, bounds: await expectFit(width) });
      }
      await page.screenshot({ path: path.join(output, "03-narrow-desktop.png") });
      await page.getByRole("button", { name: "收起目录", exact: true }).click();
      assert.equal(await page.getByRole("separator").count(), 1);
      await right.focus(); await page.keyboard.press("End");
      await page.getByRole("button", { name: "展开目录", exact: true }).click();
      await expectFit(841);
      await page.getByRole("button", { name: "收起助手", exact: true }).click();
      assert.equal(await page.getByRole("separator").count(), 1);
      await left.focus(); await page.keyboard.press("ArrowRight");
      await page.getByRole("button", { name: "展开助手", exact: true }).click();
      await expectFit(841);
      await page.setViewportSize({ width: 1440, height: 920 });
      const restored = await expectFit(1440);
      assert.equal(Math.round(restored.outline.width), 360);
      assert.equal(Math.round(restored.assistant.width), 521);
      report.checks.push("Keyboard resizing and collapse/reopen respect panel and original width limits");

      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await left.isVisible(), false);
      assert.equal(await right.isVisible(), false);
      assert.equal(await page.locator(".reader-document").evaluate((item) => item.inert), true);
      await page.getByRole("button", { name: "收起助手", exact: true }).click();
      assert.equal(await page.locator(".reader-document").evaluate((item) => item.inert), false);
      report.checks.push("Mobile PDF/assistant drawer behavior retained; desktop separators hidden");
      assert.deepEqual(report.errors, []);
      assert.equal(await electron.evaluate(() => globalThis.layoutExternalRequests), 0);
      report.status = report.failures.length ? "failed" : "passed";
      if (report.failures.length) process.exitCode = 1;
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      report.status = "failed"; report.error = error.message;
      await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => undefined);
      console.error(error); process.exitCode = 1;
    } finally {
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
      await electron.close();
    }
  })().catch((error) => { console.error(error); process.exitCode = 1; });
}
