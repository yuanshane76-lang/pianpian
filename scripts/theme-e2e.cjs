const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (process.versions.electron) {
  const { app } = require("electron");
  app.setPath("userData", process.env.ZHIYAN_THEME_USER_DATA);
  app.setPath("sessionData", path.join(process.env.ZHIYAN_THEME_USER_DATA, "session"));
  Object.defineProperty(app, "isPackaged", { value: true });
  globalThis.themeRemoteRequests = 0;
  globalThis.fetch = async () => {
    globalThis.themeRemoteRequests++;
    throw new Error("Theme checks must not call external services");
  };
  const { createDocumentStore } = require("../electron/document-store.cjs");
  const documents = createDocumentStore({ rootDirectory: path.join(app.getPath("userData"), "documents") });
  globalThis.publishThemeFixture = async (paper) => {
    await documents.saveParse(paper.originalId, {
      resultBatchId: "theme-batch", layoutVersion: 3,
      title: paper.title, blocks: paper.blockData, pageCount: 1,
    });
    await documents.saveTask(paper.originalId, {
      state: "done", batchId: "theme-batch", resultBatchId: "theme-batch",
    });
  };
  require("../electron/main.cjs");
} else {
  const assert = require("node:assert/strict");
  const { _electron } = require("playwright");
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "out", "theme-checks");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "zhiyan-theme-"));
  const report = { checks: [], errors: [], profile: "isolated synthetic PDF; no user files, credentials or external services" };
  fs.mkdirSync(path.join(userData, "session"));
  fs.mkdirSync(output, { recursive: true });
  let electron;

  function syntheticPdf() {
    const content = "BT /F1 22 Tf 60 730 Td (Theme Regression Fixture) Tj /F1 12 Tf 0 -70 Td " +
      "(Original PDF paper stays white in the dark interface.) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
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
    data += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
    data += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return [...Buffer.from(data)];
  }

  async function launch() {
    electron = await _electron.launch({
      executablePath: require("electron"), args: [__filename], cwd: root,
      env: { ...process.env, ZHIYAN_THEME_USER_DATA: userData },
    });
    const page = await electron.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => report.errors.push(error.message));
    await page.waitForSelector(".workspace-shell");
    await electron.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window.isVisible()) await new Promise((resolve) => window.once("show", resolve));
    });
    assert(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()));
    return page;
  }

  async function background(page, selector) {
    return page.locator(selector).evaluate((element) => getComputedStyle(element).backgroundColor);
  }

  async function capture(page, filename) {
    await page.screenshot({ path: path.join(output, filename) });
  }

  (async () => {
    try {
      let page = await launch();
      await page.getByRole("button", { name: "切换为深色模式", exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
      await page.getByRole("button", { name: "服务配置", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      assert.equal(await background(page, ".settings-dialog"), "rgb(27, 32, 36)");
      assert.equal(await background(page, ".settings-provider-option.is-selected"), "rgb(23, 48, 46)");
      await capture(page, "01-dark-settings.png");
      await page.getByRole("tab", { name: /论文解析/ }).click();
      assert(await page.locator("#mineru-key").isVisible());
      await page.getByRole("button", { name: "关闭配置", exact: true }).click();
      await page.getByRole("button", { name: "问问篇篇", exact: true }).click();
      assert.equal(await background(page, ".research-workspace-chat"), "rgb(27, 32, 36)");
      assert.equal(await background(page, ".research-input-wrap"), "rgb(38, 45, 51)");
      await page.getByRole("button", { name: "篇篇的拿手活", exact: true }).click();
      assert.equal(await background(page, ".research-skills-list button:first-child"), "rgb(38, 45, 51)");
      await capture(page, "02-dark-research-workspace.png");
      await page.getByRole("button", { name: "返回文献库", exact: true }).click();
      report.checks.push("Library, parallel model/parser settings, research workspace and skills use dark surfaces");

      const paper = await page.evaluate(async (bytes) => {
        const saved = await window.zhiyan.invoke("zhiyan:documents:save", {
          name: "theme-fixture.pdf", data: new Uint8Array(bytes),
        });
        return {
          id: saved.id, originalId: saved.id, title: "主题回归论文",
          authors: [], year: null, sourcePath: `local://${saved.id}`,
          importedAt: "2026-10-13T00:00:00.000Z", tags: [], favorite: false,
          parseStatus: "ready", parseVersion: 2, pageCount: 1, blocks: 1,
          blockData: [{
            id: "theme-paragraph", kind: "paragraph", pageNumber: 1, order: 0,
            text: "Original PDF paper stays white in the dark interface.", bbox: [.1, .15, .9, .2],
          }],
        };
      }, syntheticPdf());
      await electron.evaluate(async (_electron, fixture) => globalThis.publishThemeFixture(fixture), paper);
      await page.evaluate((fixture) => localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([fixture])), paper);
      assert.equal(await electron.evaluate(() => globalThis.themeRemoteRequests), 0);
      await electron.close();
      electron = null;
      page = await launch();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
      await page.getByRole("button", { name: "打开阅读", exact: true }).click();
      await page.waitForSelector('.pdf-page-stage[data-rendered="true"]');
      assert.equal(await background(page, ".pdf-page-stage canvas"), "rgb(255, 255, 255)");
      const pixel = await page.locator(".pdf-page-stage canvas").evaluate((canvas) =>
        [...canvas.getContext("2d").getImageData(10, 10, 1, 1).data]);
      assert.deepEqual(pixel, [255, 255, 255, 255]);
      await page.getByRole("tab", { name: "聊聊", exact: true }).click();
      assert.equal(await background(page, ".research-agent-composer"), "rgb(27, 32, 36)");
      await capture(page, "03-dark-reader.png");
      report.checks.push("Dark preference survives Electron restart; original PDF canvas stays white");
      await page.getByRole("button", { name: "切换为浅色模式", exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
      assert.equal(await background(page, ".research-agent-composer"), "rgb(255, 255, 255)");
      await page.getByRole("button", { name: "返回文献库", exact: true }).click();
      assert(await page.getByRole("button", { name: "切换为深色模式", exact: true }).isVisible());
      await capture(page, "04-light-library.png");
      report.checks.push("Reader and library theme controls stay consistent across navigation");
      report.remoteRequests = await electron.evaluate(() => globalThis.themeRemoteRequests);
      assert.equal(report.remoteRequests, 0);
      assert.deepEqual(report.errors, []);
      report.status = "passed";
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      report.status = "failed";
      report.error = error.stack;
      if (electron) {
        const page = await electron.firstWindow().catch(() => null);
        if (page) await capture(page, "failure.png").catch(() => {});
      }
      console.error(error.stack);
      process.exitCode = 1;
    } finally {
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
      if (electron) await electron.close();
      const target = fs.realpathSync(userData);
      if (path.dirname(target) !== fs.realpathSync(os.tmpdir()) || !path.basename(target).startsWith("zhiyan-theme-")) {
        throw new Error("隔离用户目录不在预期临时目录内，拒绝清理");
      }
      fs.rmSync(target, { recursive: true, force: true });
    }
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
