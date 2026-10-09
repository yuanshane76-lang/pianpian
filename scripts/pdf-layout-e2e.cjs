const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "out", "layout-checks");
const report = { checks: [], errors: [] };
const liveAi = process.argv.includes("--live-ai");

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
      const parsed = JSON.parse(fs.readFileSync(path.join(documents, id, "parse.json"), "utf8"));
      return { id, originalId: id, title: parsed.title, authors: [], year: null, tags: [], favorite: false,
        sourcePath: `local://layout-e2e/${id}`, pageCount: parsed.pageCount, blocks: parsed.blocks.length,
        blockData: parsed.blocks, importedAt: "2026-10-09", overview: null, parseVersion: 2, parseStatus: "ready" };
    });
    await page.evaluate((papers) => localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify(papers)), fixtures);
    await page.reload();
    await page.waitForSelector(".workspace-shell");
    if (!liveAi) await electron.evaluate(() => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        if (/^https?:/i.test(String(url)) && !String(url).startsWith("http://127.0.0.1:4173/")) {
          throw new Error("Layout-only checks must not call external services; opt in with --live-ai");
        }
        return originalFetch(url, options);
      };
    });
    await page.locator(".paper-row").filter({ hasText: "Attention" }).first().click();
    await page.getByRole("button", { name: "打开阅读", exact: true }).click();
    await page.waitForSelector(".pdf-block-hit-area");
    const paper = await page.evaluate(() => JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1") || "[]").find((item) => /Attention/.test(item.title)));
    assert(paper?.blockData?.every((block) => block.bbox), "Real paper must contain recovered MinerU coordinates");

    async function ready(targetPage) {
      await page.waitForFunction((number) => {
        const stage = document.querySelector(`.pdf-page-stage[data-page-number="${number}"]`);
        return stage?.getAttribute("data-rendered") === "true" && stage.querySelector("canvas")?.width > 0
          && !stage.querySelector(".pdf-feedback") && stage.querySelector(".pdf-structure-overlay");
      }, targetPage);
    }

    async function verify(block, name) {
      await page.getByRole("spinbutton", { name: "PDF 页码" }).fill(String(block.pageNumber));
      await ready(block.pageNumber);
      const target = page.locator(`[id="pdf-block-${block.id}"]`);
      await target.scrollIntoViewIfNeeded();
      const geometry = await target.evaluate((element, bbox) => {
        const rectangle = (value) => ({ x: value.x, y: value.y, width: value.width, height: value.height });
        const pageStage = element.closest(".pdf-page-stage");
        const canvas = pageStage.querySelector("canvas").getBoundingClientRect();
        const stage = pageStage.getBoundingClientRect();
        const overlay = pageStage.querySelector(".pdf-structure-overlay").getBoundingClientRect();
        const hit = element.getBoundingClientRect();
        return {
          canvas: rectangle(canvas), stage: rectangle(stage), overlay: rectangle(overlay), hit: rectangle(hit),
          expected: { x: canvas.x + bbox[0] * canvas.width, y: canvas.y + bbox[1] * canvas.height,
            width: (bbox[2] - bbox[0]) * canvas.width, height: (bbox[3] - bbox[1]) * canvas.height },
        };
      }, block.bbox);
      for (const key of ["x", "y", "width", "height"]) {
        assert(Math.abs(geometry.stage[key] - geometry.canvas[key]) < 0.75, `${name}: stage ${key}`);
        assert(Math.abs(geometry.overlay[key] - geometry.canvas[key]) < 0.75, `${name}: overlay ${key}`);
        assert(Math.abs(geometry.hit[key] - geometry.expected[key]) < 0.75, `${name}: hit ${key}`);
      }
      const x = geometry.hit.x + geometry.hit.width / 2;
      const y = geometry.hit.y + Math.min(geometry.hit.height / 2, 9);
      await page.mouse.move(x, y);
      await page.mouse.click(x, y);
      await page.waitForFunction((id) => document.getElementById(`pdf-block-${id}`)?.getAttribute("aria-pressed") === "true", block.id);
      await page.screenshot({ path: path.join(output, `${name}.png`) });
      report.checks.push({ name, page: block.pageNumber, blockId: block.id, geometry });
      console.log(`PASS ${name}`);
    }

    const paragraph = paper.blockData.find((block) => block.pageNumber === 5 && block.text.startsWith("• Similarly, self-attention"));
    assert(paragraph, "Screenshot paragraph exists");
    await verify(paragraph, "01-paragraph-fit");
    await page.getByRole("button", { name: "缩小 PDF" }).click();
    await verify(paragraph, "02-paragraph-zoom");
    await page.getByRole("button", { name: "收起目录" }).click();
    await page.getByRole("button", { name: "适应宽度", exact: true }).click();
    await verify(paragraph, "03-paragraph-resize");
    const equation = paper.blockData.find((block) => block.pageNumber === 5 && block.kind === "equation");
    await verify(equation, "04-equation");
    const image = paper.blockData.find((block) => block.kind === "image");
    await verify(image, "05-figure");
    const table = paper.blockData.find((block) => block.kind === "table");
    await verify(table, "06-table");

    await page.getByRole("spinbutton", { name: "PDF 页码" }).fill("5");
    await ready(5);
    await page.waitForFunction(() => document.querySelectorAll('.pdf-page-stage[data-page-number="5"] .pdf-text-layer span').length > 20);
    const sentence = await page.evaluate((block) => {
      const pageStage = document.querySelector(`.pdf-page-stage[data-page-number="${block.pageNumber}"]`);
      const stage = pageStage.getBoundingClientRect();
      const spans = [...pageStage.querySelectorAll(".pdf-text-layer span")].filter((element) => {
        const rect = element.getBoundingClientRect();
        const x = (rect.x + rect.width / 2 - stage.x) / stage.width;
        const y = (rect.y + rect.height / 2 - stage.y) / stage.height;
        return rect.width && rect.height && x > block.bbox[0] && x < block.bbox[2] && y > block.bbox[1] && y < block.bbox[3];
      });
      const firstIndex = spans.findIndex((element) => (element.textContent || "").trim().length > 35);
      const span = spans[firstIndex];
      const node = span?.firstChild;
      if (!node?.textContent) throw new Error("PDF text layer not found for selected paragraph");
      span.scrollIntoView({ block: "center" });
      const range = document.createRange();
      let endNode = node;
      let end = node.textContent.length;
      for (const element of spans.slice(firstIndex)) {
        if (!element.firstChild?.textContent) continue;
        endNode = element.firstChild;
        const period = endNode.textContent.indexOf(".");
        end = period >= 0 ? period + 1 : endNode.textContent.length;
        if (period >= 0) break;
      }
      range.setStart(node, 0); range.setEnd(endNode, end);
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      pageStage.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return selection.toString().trim();
    }, paragraph);
    assert(sentence.length > 35 && /[a-z]{4}/i.test(sentence), "Selection must contain meaningful English, not a bullet or whitespace");
    await page.getByRole("button", { name: "翻译选中句子", exact: true }).waitFor();
    assert.equal(await page.locator(".selected-block-text").count(), 0);
    report.checks.push({ name: "07-original-pdf-text-selection", selected: sentence });
    await page.screenshot({ path: path.join(output, "07-sentence.png") });
    if (liveAi) {
      await electron.evaluate(({ ipcMain }) => {
        globalThis.paperquayLayoutRequests = [];
        ipcMain.on("zhiyan:ai:stream:start", (_event, payload) => {
          if (payload?.request?.operation === "translate") globalThis.paperquayLayoutRequests.push(payload.request.block?.text);
        });
      });
      await page.getByRole("button", { name: "翻译选中句子", exact: true }).click();
      await page.waitForFunction(() => /[\u3400-\u9fff]/.test(document.querySelector(".assistant-translation p")?.textContent || ""), null, { timeout: 120000 });
      await page.waitForFunction(() => !document.querySelector(".selected-context button:disabled"), null, { timeout: 120000 });
      const requests = await electron.evaluate(() => globalThis.paperquayLayoutRequests);
      if (requests.length) assert.equal(requests[requests.length - 1], sentence, "AI receives precisely the PDF selection, not the whole paragraph");
      report.checks.push({ name: "08-sentence-translation", source: sentence, chinese: await page.locator(".assistant-translation p").textContent(), networkRequest: requests.length > 0 });
      await page.screenshot({ path: path.join(output, "08-sentence-translation.png") });
      console.log("PASS 08-sentence-translation");
    }
    await page.getByRole("button", { name: "展开目录" }).click();
    const heading = paper.blockData.find((block) => block.kind === "heading" && block.pageNumber !== 5 && block.bbox[1] > 0.35);
    assert(heading, "Cross-page heading exists");
    await page.locator(".outline-sections button").filter({ hasText: heading.text }).first().click();
    await ready(heading.pageNumber);
    await page.waitForFunction((id) => {
      const target = document.getElementById(`pdf-block-${id}`);
      const frame = document.querySelector(".pdf-canvas-scroll")?.getBoundingClientRect();
      const rect = target?.getBoundingClientRect();
      return rect && frame && rect.top >= frame.top && rect.bottom <= frame.bottom;
    }, heading.id);
    report.checks.push({ name: "09-cross-page-outline-position" });
    await page.screenshot({ path: path.join(output, "09-outline.png") });
    assert.equal(await page.locator(".is-flow-target").count(), 0, "No fake flow-positioned rectangles");
    const overflow = await page.evaluate(() => ({ content: document.documentElement.scrollHeight, viewport: window.innerHeight }));
    assert(overflow.content <= overflow.viewport + 1, "The PDF reader must not create an outer page scrollbar");
    assert.deepEqual(report.errors, [], "No renderer errors");
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
    process.exitCode = 1;
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    console.error(error.message);
  } finally {
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    await electron.close();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
