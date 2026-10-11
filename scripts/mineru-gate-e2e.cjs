const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Real Electron, IPC, document store and task orchestration, with only the
// remote MinerU responses replaced. No user library or real service is used.
if (process.versions.electron) {
  const { app } = require("electron");
  app.setPath("userData", process.env.ZHIYAN_GATE_USER_DATA);
  app.setPath("sessionData", path.join(process.env.ZHIYAN_GATE_USER_DATA, "session"));
  globalThis.gate = { stage: "pending", uploads: 0, batches: 0, polls: 0, remoteRequests: 0 };
  globalThis.fetch = async () => {
    globalThis.gate.remoteRequests++;
    throw new Error("Gate checks must not call external services");
  };
  const mineru = require("../electron/mineru.cjs");
  mineru.requestUpload = async () => ({ batchId: `gate-${++globalThis.gate.batches}`, uploadUrl: "https://mineru.net/synthetic" });
  mineru.uploadPdf = async () => {
    globalThis.gate.uploads++;
    await new Promise((resolve) => { globalThis.gate.releaseUpload = resolve; });
  };
  mineru.getBatch = async () => {
    globalThis.gate.polls++;
    const state = globalThis.gate.stage;
    return { state, progress: state === "running" ? .4 : 0,
      ...(state === "done" ? { zipUrl: "https://mineru.net/synthetic.zip" } : {}) };
  };
  mineru.downloadResultZip = async () => Uint8Array.from([1]);
  mineru.extractResultZip = () => ({
    result: {
      title: "MinerU 强制解析验证", pageCount: 1, layoutVersion: 1, layoutStatus: "available",
      blocks: [
        { id: "heading", kind: "heading", text: "1 Introduction", headingLevel: 1, pageNumber: 1, order: 0, bbox: [.1, .06, .9, .13] },
        { id: "body", kind: "paragraph", text: "The model uses attention to select relevant features.", pageNumber: 1, order: 1, bbox: [.1, .18, .9, .27] },
      ],
    }, assets: [],
  });
  require("../electron/main.cjs");
} else {
  const assert = require("node:assert/strict");
  const { _electron } = require("playwright");
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "out", "mineru-gate-checks");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "zhiyan-gate-"));
  const report = { checks: [], errors: [], profile: "isolated synthetic PDF; mocked MinerU; no user data or real credentials" };
  fs.mkdirSync(path.join(userData, "session"));
  fs.mkdirSync(output, { recursive: true });

  function syntheticPdf() {
    const content = "BT /F1 18 Tf 60 730 Td (1 Introduction) Tj /F1 12 Tf 0 -90 Td (The model uses attention to select relevant features.) Tj ET";
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
    return Buffer.from(`${data}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  }

  (async () => {
    const electron = await _electron.launch({
      executablePath: require("electron"), args: [__filename, "--disable-backgrounding-occluded-windows"], cwd: root,
      env: { ...process.env, ZHIYAN_GATE_USER_DATA: userData },
    });
    try {
      const page = await electron.firstWindow();
      page.setDefaultTimeout(20000);
      page.on("pageerror", (error) => report.errors.push(error.message));
      async function screenshot(name) {
        await page.bringToFront();
        await page.screenshot({ path: path.join(output, name), animations: "disabled" });
      }
      await page.waitForSelector(".workspace-shell");
      await page.evaluate(async () => window.zhiyan.invoke("zhiyan:settings:save", {
        aiProvider: "local",
        mineru: { apiKey: "synthetic-gate-token" },
      }));
      await page.reload();
      await page.waitForSelector(".workspace-shell");
      await page.locator(".import-button input").setInputFiles({
        name: "mandatory-mineru-fixture.pdf", mimeType: "application/pdf", buffer: syntheticPdf(),
      });
      await page.waitForSelector(".paper-row-progress");
      const open = page.getByRole("button", { name: "打开阅读", exact: true });
      assert(await open.isDisabled());
      assert.equal(await page.locator(".reader-shell").count(), 0);
      await page.waitForFunction(() => document.querySelector(".paper-row-progress")?.textContent.includes("上传"));
      await screenshot("01-uploading.png");
      report.checks.push("Import stays in library; reading locked during upload");

      await electron.evaluate(() => { globalThis.gate.stage = "waiting-file"; globalThis.gate.releaseUpload(); });
      await page.waitForFunction(() => document.querySelector(".paper-row-progress")?.textContent.includes("确认文件"));
      assert(await open.isDisabled());
      assert.equal(await electron.evaluate(() => globalThis.gate.uploads), 1);
      report.checks.push("Accepted upload tolerates waiting-file propagation without retrying");

      await electron.evaluate(() => { globalThis.gate.stage = "running"; });
      await page.waitForSelector('.paper-row [role="progressbar"][aria-valuenow="40"]');
      assert(await open.isDisabled());
      await screenshot("02-parsing.png");
      report.checks.push("Library row and detail show actual page progress");
      await page.reload();
      await page.waitForSelector('.paper-row [role="progressbar"][aria-valuenow="40"]');
      assert(await open.isDisabled());
      assert.equal(await electron.evaluate(() => globalThis.gate.uploads), 1);
      report.checks.push("Reload resumes the existing durable task without upload");

      await electron.evaluate(() => { globalThis.gate.stage = "converting"; });
      await page.waitForFunction(() => document.querySelector(".paper-row-progress")?.textContent.includes("整理段落"));
      assert.equal(await page.locator(".paper-row [role=progressbar]").getAttribute("aria-valuenow"), null);
      assert(await open.isDisabled());

      await electron.evaluate(() => { globalThis.gate.stage = "done"; });
      await page.waitForFunction(() => document.querySelector(".paper-row-progress")?.textContent.includes("下载"));
      assert(await open.isDisabled());
      await screenshot("03-downloading.png");
      await page.waitForFunction(() => !document.querySelector('[aria-label="打开阅读"]').disabled);
      await screenshot("04-ready.png");
      const stored = await page.evaluate(async () => {
        const paper = JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1"))[0];
        const state = await window.zhiyan.invoke("zhiyan:documents:state", paper.originalId);
        return { status: state.task.state, current: state.task.batchId === state.task.resultBatchId, blocks: state.result.blocks.length };
      });
      assert.deepEqual(stored, { status: "done", current: true, blocks: 2 });
      report.checks.push("Conversion/download stay locked; persisted current coordinates unlock reading");
      await open.click();
      await page.waitForSelector('.pdf-page-stage[data-rendered="true"]');
      assert.equal(await page.locator(".pdf-block-hit-area").count(), 2);
      assert(await page.getByText("1 Introduction", { exact: true }).first().isVisible());
      await screenshot("05-reader.png");
      await page.locator(".back-button").click();
      await page.reload();
      await page.waitForFunction(() => !document.querySelector('[aria-label="打开阅读"]').disabled);
      assert.equal(await electron.evaluate(() => globalThis.gate.uploads), 1);
      report.checks.push("Original PDF, outline and positioned blocks render; completed result survives restart");
      report.remoteRequests = await electron.evaluate(() => globalThis.gate.remoteRequests);
      assert.equal(report.remoteRequests, 0);
      assert.deepEqual(report.errors, []);
      report.passed = true;
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      report.failure = error.message;
      const page = (await electron.windows())[0];
      if (page) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
      throw error;
    } finally {
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
      await electron.close();
      // Only the exact isolated directory created by mkdtemp is removed.
      fs.rmSync(userData, { recursive: true, force: true });
    }
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
