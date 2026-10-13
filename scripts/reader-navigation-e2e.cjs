const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (process.versions.electron) {
  const { app } = require("electron");
  app.setPath("userData", process.env.ZHIYAN_NAVIGATION_USER_DATA);
  app.setPath("sessionData", path.join(process.env.ZHIYAN_NAVIGATION_USER_DATA, "session"));
  Object.defineProperty(app, "isPackaged", { value: true });
  globalThis.navigationRemoteRequests = 0;
  globalThis.fetch = async () => {
    globalThis.navigationRemoteRequests++;
    throw new Error("Navigation checks must not call external services");
  };
  const { createDocumentStore } = require("../electron/document-store.cjs");
  const documents = createDocumentStore({ rootDirectory: path.join(app.getPath("userData"), "documents") });
  globalThis.publishNavigationFixture = async (paper) => {
    await documents.saveParse(paper.originalId, {
      resultBatchId: "navigation-batch", layoutVersion: 1,
      title: paper.title, blocks: paper.blockData, pageCount: 2,
    });
    await documents.saveTask(paper.originalId, {
      state: "done", batchId: "navigation-batch", resultBatchId: "navigation-batch",
    });
  };
  require("../electron/main.cjs");
} else {
  const assert = require("node:assert/strict");
  const { _electron } = require("playwright");
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "out", "reader-navigation-checks");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "zhiyan-navigation-"));
  const report = { checks: [], errors: [], profile: "isolated synthetic PDF; no user files, credentials or external services" };
  fs.mkdirSync(path.join(userData, "session"));
  fs.mkdirSync(output, { recursive: true });

  function syntheticPdf() {
    const content = "BT /F1 18 Tf 60 730 Td (Navigation Regression Fixture) Tj /F1 12 Tf 0 -70 Td " +
      "(The model uses attention to select relevant features.) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    ];
    let data = "%PDF-1.4\n";
    const offsets = [];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(data));
      data += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(data);
    data += `xref\n0 7\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
    data += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return [...Buffer.from(data)];
  }

  (async () => {
    const electron = await _electron.launch({
      executablePath: require("electron"), args: [__filename], cwd: root,
      env: { ...process.env, ZHIYAN_NAVIGATION_USER_DATA: userData },
    });
    try {
      const page = await electron.firstWindow();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => report.errors.push(error.message));
      await page.waitForSelector(".workspace-shell");
      const paper = await page.evaluate(async (bytes) => {
        const saved = await window.zhiyan.invoke("zhiyan:documents:save", {
          name: "navigation-fixture.pdf", data: new Uint8Array(bytes),
        });
        return {
          id: saved.id, originalId: saved.id, title: "返回阅读回归论文",
          authors: [], year: null, sourcePath: `local://${saved.id}`,
          importedAt: "2026-10-10T00:00:00.000Z", tags: ["导航测试"], favorite: true,
          parseStatus: "ready", parseVersion: 2, pageCount: 2, blocks: 1,
          readingPosition: { mode: "pdf", page: 2 },
          blockData: [{
            id: "navigation-paragraph", kind: "paragraph", pageNumber: 2, order: 0,
            text: "The model uses attention to select relevant features.", bbox: [.1, .15, .9, .2],
          }],
        };
      }, syntheticPdf());
      await electron.evaluate(async (_electron, fixture) => globalThis.publishNavigationFixture(fixture), paper);
      await page.evaluate((fixture) => localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([fixture])), paper);
      await page.reload();
      await page.waitForSelector(".paper-row.is-selected");
      for (let cycle = 0; cycle < 5; cycle++) {
        await page.getByRole("button", { name: "打开阅读", exact: true }).click();
        await page.waitForSelector('.pdf-page-stage[data-page-number="2"][data-rendered="true"]');
        await page.waitForSelector(".pdf-block-hit-area");
        assert.equal(await page.getByRole("spinbutton", { name: "PDF 页码" }).inputValue(), "2");
        const closeNotice = page.getByRole("button", { name: "关闭定位提示", exact: true });
        if (await closeNotice.count()) await closeNotice.click();
        const stage = page.locator('.pdf-page-stage[data-page-number="2"]');
        const frame = await stage.boundingBox();
        assert(frame);
        await stage.click({ position: { x: frame.width * .5, y: frame.height * .175 } });
        assert.equal(await page.locator(".pdf-block-hit-area").getAttribute("aria-pressed"), "true");
        if (cycle === 0) await page.screenshot({ path: path.join(output, "01-reader.png") });
        await page.getByRole("button", { name: "返回文献库", exact: true }).click();
        await page.waitForSelector(".workspace-shell");
        assert.equal(await page.locator(".reader-shell").count(), 0);
        assert.equal(await page.locator(".paper-row.is-selected h2").textContent(), paper.title);
        assert.equal(await page.locator(".detail-content h2").textContent(), paper.title);
        assert.equal(await page.getByRole("button", { name: "打开阅读", exact: true }).isEnabled(), true);
        if (cycle === 0) await page.screenshot({ path: path.join(output, "02-returned-library.png") });
      }
      report.checks.push("Five reader/back/reopen cycles preserve the selected paper and PDF page 2");
      await page.reload();
      await page.getByRole("button", { name: "打开阅读", exact: true }).click();
      await page.waitForSelector('.pdf-page-stage[data-page-number="2"][data-rendered="true"]');
      assert.equal(await page.getByRole("spinbutton", { name: "PDF 页码" }).inputValue(), "2");
      await page.getByRole("button", { name: "返回文献库", exact: true }).click();
      await page.waitForSelector(".workspace-shell");
      report.checks.push("Reload recovers the saved page and still returns to the library");
      assert.deepEqual(report.errors, []);
      report.remoteRequests = await electron.evaluate(() => globalThis.navigationRemoteRequests);
      assert.equal(report.remoteRequests, 0);
      report.status = "passed";
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      report.status = "failed";
      report.error = error.message;
      console.error(error.message);
      process.exitCode = 1;
    } finally {
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
      await electron.close();
    }
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
