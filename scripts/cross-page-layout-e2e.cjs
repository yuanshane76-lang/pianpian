const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (process.versions.electron) {
  const { app } = require("electron");
  app.setPath("userData", process.env.ZHIYAN_CROSS_PAGE_USER_DATA);
  app.setPath("sessionData", path.join(process.env.ZHIYAN_CROSS_PAGE_USER_DATA, "session"));
  Object.defineProperty(app, "isPackaged", { value: true });
  globalThis.crossPageE2e = { requests: [], externalRequests: 0 };
  globalThis.fetch = async () => {
    globalThis.crossPageE2e.externalRequests++;
    throw new Error("Cross-page checks cannot call external services");
  };
  const ai = require("../electron/ai.cjs");
  ai.streamModel = async (_settings, request, onDelta) => {
    globalThis.crossPageE2e.requests.push({ operation: request.operation, block: request.block });
    const value = request.operation === "insight" ? '{"summary":"跨页段落摘要","role":"衔接正文"}'
      : request.operation === "vocabulary" ? '{"overview":"跨页段落学习","terms":[]}'
      : request.operation === "translate" ? "跨页段落的完整中文译文。" : "跨页段落的完整解释。";
    onDelta(value);
    return value;
  };
  const store = require("../electron/document-store.cjs").createDocumentStore({
    rootDirectory: path.join(app.getPath("userData"), "documents"),
  });
  globalThis.publishCrossPageFixture = async (paper) => {
    await store.saveParse(paper.originalId, { layoutVersion: 3, layoutStatus: "available",
      title: paper.title, blocks: paper.blockData, pageCount: 2 });
    await store.saveTask(paper.originalId, { state: "done", batchId: "cross-page-fixture", resultBatchId: "cross-page-fixture" });
  };
  require("../electron/main.cjs");
} else {
  const assert = require("node:assert/strict");
  const { _electron } = require("playwright");
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "out", "cross-page-layout-checks");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "zhiyan-cross-page-e2e-"));
  const report = { checks: [], errors: [], profile: "synthetic PDF, isolated library, mocked model; no external requests" };
  fs.mkdirSync(path.join(userData, "session"));
  fs.mkdirSync(output, { recursive: true });
  const paragraph = {
    id: "merged-paragraph", kind: "paragraph", pageNumber: 1, order: 0,
    text: "Recent results derive answers from questions in arithmetic and symbolic reasoning. The paragraph continues across pages as a single unit.",
    bbox: [.115, .899, .91, .928],
    pageBounds: [
      { pageNumber: 1, bbox: [.115, .899, .91, .928] },
      { pageNumber: 2, bbox: [.115, .36, .93, .408] },
    ],
  };
  function syntheticPdf() {
    const streams = [
      "BT /F1 24 Tf 72 720 Td (Cross-page fixture) Tj /F1 12 Tf 0 -650 Td (Recent results derive) Tj ET",
      "BT /F1 12 Tf 72 500 Td (answers from questions in arithmetic and symbolic reasoning.) Tj " +
        "0 -20 Td (The paragraph continues across pages as a single unit.) Tj 0 -100 Td (E = m c^2) Tj ET\n72 610 400 100 re S",
    ];
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 2 /Kids [4 0 R 6 0 R] >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
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
      env: { ...process.env, ZHIYAN_CROSS_PAGE_USER_DATA: userData },
    });
    const page = await electron.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => report.errors.push(error.message));
    const target = () => page.locator('.pdf-page-stage[data-page-number="2"] [data-block-id="merged-paragraph"]');
    async function verifyGeometry(name) {
      await target().scrollIntoViewIfNeeded();
      const errors = await target().evaluate((element, bbox) => {
        const canvas = element.closest(".pdf-page-stage").querySelector("canvas").getBoundingClientRect();
        const hit = element.getBoundingClientRect();
        return [Math.abs(hit.left - canvas.left - bbox[0] * canvas.width),
          Math.abs(hit.top - canvas.top - bbox[1] * canvas.height),
          Math.abs(hit.width - (bbox[2] - bbox[0]) * canvas.width),
          Math.abs(hit.height - (bbox[3] - bbox[1]) * canvas.height)];
      }, paragraph.pageBounds[1].bbox);
      assert(errors.every((error) => error < 1), `${name}: continuation box aligns with the canvas`);
      report.checks.push(name);
    }
    try {
      await page.waitForSelector(".workspace-shell");
      const fixture = await page.evaluate(async ({ bytes, paragraph }) => {
        const saved = await window.zhiyan.invoke("zhiyan:documents:save", { name: "cross-page-fixture.pdf", data: new Uint8Array(bytes) });
        const paper = { id: saved.id, originalId: saved.id, title: "Cross-page fixture", authors: [], year: null,
          sourcePath: `local://${saved.id}`, importedAt: "2026-10-11", tags: [], favorite: false,
          blocks: 3, blockData: [paragraph,
            { id: "formula", kind: "equation", text: "E = m c^2", pageNumber: 2, order: 1, bbox: [.115, .51, .6, .55] },
            { id: "figure", kind: "image", text: "Synthetic figure", pageNumber: 2, order: 2, bbox: [.12, .11, .79, .24] }],
          parseVersion: 2, parseStatus: "ready", pageCount: 2 };
        localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([paper]));
        await window.zhiyan.invoke("zhiyan:settings:save", { aiProvider: "deepseek", deepseek: { apiKey: "synthetic-test-placeholder" } });
        return paper;
      }, { bytes: syntheticPdf(), paragraph });
      await electron.evaluate(async (_electron, paper) => globalThis.publishCrossPageFixture(paper), fixture);
      await page.reload();
      await page.getByRole("button", { name: "打开阅读", exact: true }).click();
      await page.getByRole("spinbutton", { name: "PDF 页码" }).fill("2");
      await verifyGeometry("Continuation at fit width");
      await target().click();
      assert.equal(await page.getByRole("spinbutton", { name: "PDF 页码" }).inputValue(), "2");
      await target().dblclick();
      await page.waitForFunction(() => document.querySelector(".assistant-translation")?.textContent.includes("跨页段落"));
      const requests = await electron.evaluate(() => globalThis.crossPageE2e.requests);
      assert(requests.length >= 2);
      assert(requests.every((request) => request.block.pageNumber === 1 && request.block.text === paragraph.text));
      assert.equal(await page.getByRole("spinbutton", { name: "PDF 页码" }).inputValue(), "2");
      report.checks.push("Continuation double-click analyzes the canonical full paragraph and keeps page 2");
      await page.screenshot({ path: path.join(output, "01-continuation.png") });
      await page.getByRole("button", { name: "缩小 PDF", exact: true }).click();
      await verifyGeometry("Continuation after zoom");
      await page.getByRole("button", { name: "收起目录", exact: true }).click();
      await page.getByRole("button", { name: "适应宽度", exact: true }).click();
      await verifyGeometry("Continuation after collapsing outline");
      for (const id of ["formula", "figure"]) {
        await page.locator(`#pdf-block-${id}`).click();
        await page.waitForSelector(`#pdf-block-${id}.is-active`);
      }
      report.checks.push("Figure and formula retain their own hit regions");
      await target().click();
      const selected = await page.locator('.pdf-page-stage[data-page-number="2"] .pdf-text-layer span')
        .filter({ hasText: "answers from questions" }).evaluate((span) => {
          const range = document.createRange(); range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 22);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
          span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          return selection.toString();
        });
      await page.getByRole("heading", { name: "选中句子", exact: true }).waitFor();
      await page.getByRole("button", { name: "翻译选中句子", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".assistant-translation")?.textContent.includes("跨页段落"));
      const last = await electron.evaluate(() => globalThis.crossPageE2e.requests.at(-1));
      assert.equal(last.block.text, selected);
      assert.equal(last.block.pageNumber, 1);
      report.checks.push("Sentence analysis receives exactly the selected text");
      await page.evaluate(() => window.getSelection().removeAllRanges());
      await target().click();
      await page.reload();
      await page.getByRole("button", { name: "打开阅读", exact: true }).click();
      await target().waitFor();
      assert.equal(await page.getByRole("spinbutton", { name: "PDF 页码" }).inputValue(), "2");
      await target().dblclick();
      await page.waitForFunction(() => document.querySelector(".assistant-translation")?.textContent.includes("跨页段落"));
      const afterReload = await electron.evaluate(() => globalThis.crossPageE2e.requests.length);
      assert.equal(afterReload, requests.length + 1, "Reload reuses paragraph cache; only sentence translation added a call");
      report.checks.push("Reload restores continuation position and reuses canonical paragraph caches");
      assert.equal(await electron.evaluate(() => globalThis.crossPageE2e.externalRequests), 0);
      assert.deepEqual(report.errors, []);
      report.status = "passed";
      console.log(JSON.stringify(report));
    } catch (error) {
      report.status = "failed"; report.error = error.message; process.exitCode = 1;
      await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
      console.error(error.message);
    } finally {
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
      await electron.close();
    }
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
