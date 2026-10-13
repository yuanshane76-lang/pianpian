const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const asar = require("@electron/asar");
const { _electron } = require("playwright");

async function main() {
  const executable = path.resolve(process.argv[2] || "");
  assert(fs.existsSync(executable) && path.basename(executable) === "Zhiyan.exe", "Pass the extracted Zhiyan.exe path");
  const archive = path.join(path.dirname(executable), "resources", "app.asar");
  const output = path.resolve(__dirname, "..", "out", "packaged-skills-checks");
  fs.mkdirSync(output, { recursive: true });
  const report = { profile: "Extracted Windows ZIP, isolated empty user data, bundled resources and synthetic Pi model; zero external calls", checks: [] };
  const manifest = JSON.parse(asar.extractFile(archive, path.join("skills", "research", "manifest.json")).toString("utf8"));
  assert.equal(manifest.skills.length, 3);
  for (const skill of manifest.skills) {
    const body = asar.extractFile(archive, path.join("skills", "research", skill.name, "SKILL.md")).toString("utf8");
    assert(body.includes(`name: ${skill.name}`));
    assert(body.length > 200);
  }
  const entries = asar.listPackage(archive).map((entry) => entry.replaceAll("\\", "/"));
  assert(!entries.some((entry) => /^\/(?:tests|scripts|docs|data|documents)\//.test(entry)));
  assert(!entries.includes("/service-settings.enc.json"));
  report.checks.push("Archive contains the registry and all three complete SKILL.md files, with no product user data or test scripts");

  const smoke = spawnSync(executable, [path.join(__dirname, "pi-agent-smoke.cjs")], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ZHIYAN_SMOKE_APP_ROOT: archive },
    encoding: "utf8", timeout: 60000, windowsHide: true,
  });
  assert.equal(smoke.status, 0, smoke.stderr || smoke.error?.message || smoke.stdout);
  const result = JSON.parse(smoke.stdout);
  assert.equal(result.passed, true);
  report.checks.push("Shipped Electron and app.asar run the real Pi SDK and load a bundled skill through the six product tools");

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "zhiyan-packaged-skills-"));
  const electron = await _electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${userData}`, "--force-device-scale-factor=1",
      "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"],
  });
  try {
    const actualUserData = await electron.evaluate(({ app }) => app.getPath("userData"));
    assert.equal(path.resolve(actualUserData).toLowerCase(), path.resolve(userData).toLowerCase(),
      "Packaged acceptance must use its isolated user data");
    await electron.evaluate(() => {
      globalThis.packagedExternalCalls = 0;
      globalThis.fetch = async () => {
        globalThis.packagedExternalCalls++;
        throw new Error("External calls disabled during packaged acceptance");
      };
    });
    const page = await electron.firstWindow();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForSelector(".workspace-shell");
    assert.equal(await page.locator(".paper-row").count(), 0);
    const configured = await page.evaluate(() => window.zhiyan.invoke("zhiyan:settings:get"));
    assert.equal(configured.deepseek.configured, false);
    assert.equal(configured.mineru.configured, false);
    await page.getByRole("button", { name: "打开研究助手", exact: true }).click();
    await page.locator(".research-skills summary").click();
    assert.equal(await page.locator(".research-skills-list button").count(), 3);
    await page.getByRole("button", { name: "论文精读", exact: true }).click();
    assert((await page.getByLabel("向研究 Agent 提问").inputValue()).includes("精读当前论文"));
    const image = await electron.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
    fs.writeFileSync(path.join(output, "bundled-skills.png"), Buffer.from(image, "base64"));
    assert.equal(await electron.evaluate(() => globalThis.packagedExternalCalls), 0);
    assert.deepEqual(errors, []);
    report.checks.push("Extracted Zhiyan.exe opens its Chinese shell and three preset skill entries without model credentials");
    report.status = "passed";
  } finally {
    await electron.close();
  }
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
