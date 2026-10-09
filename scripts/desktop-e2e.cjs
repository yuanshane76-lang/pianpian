const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (process.versions.electron) {
  const { app } = require("electron");
  app.setPath("userData", process.env.ZHIYAN_SMOKE_USER_DATA);
  app.setPath("sessionData", path.join(process.env.ZHIYAN_SMOKE_USER_DATA, "session"));
  globalThis.smokeRemoteRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (/^https?:/i.test(String(url)) && !/^http:\/\/127\.0\.0\.1:4173\//.test(String(url))) {
      globalThis.smokeRemoteRequests++;
      throw new Error("Desktop smoke checks must not call external services");
    }
    return originalFetch(url, options);
  };
  require("../electron/main.cjs");
} else {
  const { _electron } = require("playwright");
  const assert = require("node:assert/strict");
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "out", "desktop-smoke-checks");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "zhiyan-smoke-"));
  const report = { checks: [], errors: [], profile: "isolated, empty library, no credentials" };
  fs.mkdirSync(path.join(userData, "session"));
  fs.mkdirSync(output, { recursive: true });

  (async () => {
    const electron = await _electron.launch({
      executablePath: require("electron"), args: [__filename], cwd: root,
      env: { ...process.env, ZHIYAN_SMOKE_USER_DATA: userData },
    });
    try {
      const page = await electron.firstWindow();
      page.setDefaultTimeout(20000);
      page.on("pageerror", (error) => report.errors.push(error.message));
      await page.waitForSelector(".workspace-shell");
      const ping = await page.evaluate(() => window.zhiyan.invoke("zhiyan:ping"));
      assert.equal(ping.ok, true, "Secure IPC is available");
      const settings = await page.evaluate(() => window.zhiyan.invoke("zhiyan:settings:get"));
      assert.equal(settings.deepseek.configured, false);
      assert.equal(settings.mineru.configured, false);
      assert.equal(await page.locator(".paper-row").count(), 0);
      assert(await page.getByText("导入论文", { exact: true }).isVisible());
      report.checks.push("Chinese empty library and secure IPC");
      const worker = await page.evaluate(async () => {
        const response = await fetch("/pdf.worker.min.mjs");
        return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
      });
      assert.equal(worker.status, 200);
      assert(worker.bytes > 100000);
      report.checks.push("PDF worker served from the current workspace");
      await page.getByRole("button", { name: "服务配置" }).click();
      await page.getByRole("dialog").waitFor();
      assert(await page.locator("#mineru-key").isVisible());
      report.checks.push("Service configuration opens without saved credentials");
      await page.screenshot({ path: path.join(output, "01-settings.png") });
      report.remoteRequests = await electron.evaluate(() => globalThis.smokeRemoteRequests);
      assert.equal(report.remoteRequests, 0);
      assert.deepEqual(report.errors, []);
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
