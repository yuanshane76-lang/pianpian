const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

if (process.versions.electron) {
  const { app, net } = require("electron");
  app.setPath("userData", process.env.PIANPIAN_UPDATE_TEST_PROFILE);
  app.setPath("sessionData", path.join(process.env.PIANPIAN_UPDATE_TEST_PROFILE, "session"));
  Object.defineProperty(app, "isPackaged", { value: true });
  app.getVersion = () => "0.4.0";
  const exists = fs.existsSync;
  const uninstallMarker = path.join(path.dirname(app.getPath("exe")), `Uninstall ${path.parse(app.getPath("exe")).name}.exe`);
  fs.existsSync = (file) => [path.join(process.resourcesPath, "app-update.yml"), uninstallMarker].includes(String(file)) || exists(file);
  require("../update-config.json").publicKey = process.env.PIANPIAN_UPDATE_TEST_PUBLIC_KEY;
  const nativeFetch = net.fetch;
  net.fetch = (url, options) => {
    if (String(url).startsWith("https://github.com/")) return nativeFetch(`${process.env.PIANPIAN_UPDATE_TEST_URL}/update-signature.json`, options);
    return nativeFetch(url, options);
  };
  const { createDocumentStore } = require("../electron/document-store.cjs");
  const documents = createDocumentStore({ rootDirectory: path.join(app.getPath("userData"), "documents") });
  globalThis.seedUpdateFixture = async () => {
    const pdf = Buffer.from("%PDF-1.4\n%synthetic update fixture\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<<>>/Contents 4 0 R>>endobj\n4 0 obj<</Length 0>>stream\n\nendstream endobj\ntrailer<</Root 1 0 R/Size 5>>\n%%EOF\n");
    const saved = await documents.save({ name: "update-e2e-fixture.pdf", data: pdf });
    const blockData = [{ id: "p001-b001", pageNumber: 1, order: 0, kind: "paragraph", text: "Synthetic paper for the update preservation test.", bbox: [0.1, 0.1, 0.9, 0.2], pageWidth: 612, pageHeight: 792 }];
    await documents.saveParse(saved.id, { schema: 1, layoutVersion: 3, pages: 1, blocks: blockData });
    await documents.saveTask(saved.id, { batchId: "synthetic-update-e2e", resultBatchId: "synthetic-update-e2e", state: "done", progress: 1 });
    return { ...saved, blockData };
  };
  require("../electron/main.cjs");
  app.whenReady().then(() => {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.setFeedURL({ provider: "generic", url: process.env.PIANPIAN_UPDATE_TEST_URL, useMultipleRangeRequest: false });
    // Isolate the download cache; this test never runs its synthetic executable.
    autoUpdater.configOnDisk = { value: Promise.resolve({ updaterCacheDirName: `pianpian-test-${path.basename(app.getPath("userData"))}` }) };
    globalThis.installRequested = false;
    autoUpdater.quitAndInstall = () => { globalThis.installRequested = true; };
  });
} else {
  const { _electron } = require("playwright");
  const crypto = require("node:crypto");
  const assert = require("node:assert/strict");
  const yaml = require("js-yaml");
  const http = require("node:http");
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "out", "update-e2e");
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pianpian-update-e2e-"));
  const pair = crypto.generateKeyPairSync("ed25519");
  const bytes = Buffer.alloc(512 * 1024, 42);
  let mode = "current";
  const next = "0.4.1", file = `Pianpian-Setup-${next}-x64.exe`;
  const info = { version: next, files: [{ url: file, sha512: crypto.createHash("sha512").update(bytes).digest("base64"), size: bytes.length }],
    releaseDate: new Date().toISOString(), releaseNotes: "<h1>篇篇 0.4.1</h1><ul><li>改进长论文阅读体验</li><li>更新后继续上次的阅读</li></ul>" };
  const payload = JSON.stringify({ schema: 1, version: next, file, sha512: info.files[0].sha512, size: bytes.length });
  const envelope = { payload, signature: crypto.sign(null, Buffer.from(payload), pair.privateKey).toString("base64") };
  const server = http.createServer((request, response) => {
    if (mode === "offline") { response.writeHead(503); response.end("offline"); return; }
    if (request.url.startsWith("/latest.yml")) {
      response.end(yaml.dump({ ...info, version: mode === "current" ? "0.4.0" : next })); return;
    }
    if (request.url.startsWith("/update-signature.json")) { response.end(JSON.stringify(mode === "tampered" ? { ...envelope, payload: payload.replace(next, "0.4.2") } : envelope)); return; }
    if (request.url.startsWith(`/${file}`)) {
      response.writeHead(200, { "Content-Length": bytes.length }); let offset = 0;
      const timer = setInterval(() => { if (offset >= bytes.length) { clearInterval(timer); response.end(); return; } response.write(bytes.subarray(offset, offset += 8192)); }, 20);
      response.on("close", () => clearInterval(timer)); return;
    }
    response.writeHead(404); response.end();
  });
  (async () => {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const electron = await _electron.launch({ executablePath: require("electron"), args: [__filename, "--force-device-scale-factor=1"], cwd: root,
      env: { ...process.env, PIANPIAN_UPDATE_TEST_PROFILE: profile, PIANPIAN_UPDATE_TEST_URL: `http://127.0.0.1:${server.address().port}`,
        PIANPIAN_UPDATE_TEST_PUBLIC_KEY: pair.publicKey.export({ format: "pem", type: "spki" }) } });
    const checks = [], errors = [];
    try {
      const page = await electron.firstWindow(); page.setDefaultTimeout(30000); page.on("pageerror", error => errors.push(error.message));
      await page.waitForSelector(".workspace-shell");
      await page.evaluate(() => window.zhiyan.invoke("zhiyan:settings:save", { aiProvider: "deepseek", deepseek: { apiKey: "synthetic-model" }, mineru: { apiKey: "synthetic-parser" } }));
      const fixture = await electron.evaluate(() => globalThis.seedUpdateFixture());
      const groups = [{ id: "group-inbox", name: "待整理", createdAt: "" }];
      const paper = {
        id: "update-e2e-paper", title: "更新验收合成论文", authors: ["测试作者"], year: 2026,
        sourcePath: `local://${fixture.id}/original.pdf`, importedAt: new Date().toISOString(), groupId: "group-inbox",
        favorite: false, blocks: fixture.blockData.length, blockData: fixture.blockData, parseStatus: "ready",
        originalId: fixture.id, pageCount: 1, parseVersion: 2,
      };
      await page.evaluate(({ paper, groups }) => {
        localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([paper]));
        localStorage.setItem("zhiyan-workbench.groups.v1", JSON.stringify(groups));
        localStorage.setItem("zhiyan-workbench.wordbook.v1", "[]");
        localStorage.setItem("zhiyan-workbench.analysis.v1", "[]");
        localStorage.setItem("zhiyan-workbench.appearance.v1", JSON.stringify({ theme: "light" }));
      }, { paper, groups });
      await page.reload(); await page.getByRole("button", { name: "检查更新", exact: true }).waitFor();
      await page.getByRole("heading", { name: "更新验收合成论文", exact: true }).first().waitFor();
      const conversation = await page.evaluate(() => window.zhiyan.invoke("zhiyan:agent:conversations:create", { scope: "library" }));
      await page.getByRole("button", { name: "检查更新", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "篇篇更新" });
      await dialog.getByRole("button", { name: "检查更新", exact: true }).click();
      await page.getByText("篇篇已经是最新版本", { exact: true }).waitFor();
      checks.push("Explicit check reports current version without a download");
      await page.screenshot({ path: path.join(output, "01-current.png") });
      mode = "offline";
      await dialog.getByRole("button", { name: "检查更新", exact: true }).click();
      await page.getByText("这次没能完成更新", { exact: true }).waitFor();
      checks.push("Offline check remains a recoverable in-app error");
      mode = "tampered";
      await dialog.getByRole("button", { name: "重新检查", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.update-status')?.textContent?.includes("校验"));
      assert.equal(await dialog.getByRole("button", { name: "下载更新", exact: true }).count(), 0);
      checks.push("Altered signed metadata cannot enable downloads");
      mode = "available";
      await dialog.getByRole("button", { name: "重新检查", exact: true }).click();
      await page.getByText("有新的篇篇，等你更新", { exact: true }).waitFor();
      const notes = await dialog.locator(".update-notes").innerText();
      assert(notes.includes("篇篇 0.4.1") && notes.includes("• 改进长论文阅读体验") && !notes.includes("<li>"));
      await page.screenshot({ path: path.join(output, "02-available.png") });
      await dialog.getByRole("button", { name: "下载更新", exact: true }).click();
      await page.getByRole("progressbar", { name: "更新下载进度" }).waitFor();
      await page.waitForFunction(() => Number(document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")) > 0);
      await page.screenshot({ path: path.join(output, "03-downloading.png") });
      await page.getByText("新版本准备好了", { exact: true }).waitFor();
      assert.equal(await electron.evaluate(() => globalThis.installRequested), false);
      checks.push("Real electron-updater streams download progress and waits for explicit installation");
      await page.screenshot({ path: path.join(output, "04-downloaded.png") });
      await page.evaluate(() => { window.__originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error("Synthetic quota failure"); }; });
      await dialog.getByRole("button", { name: "重启并更新", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "暂时无法完成" }).waitFor();
      assert.equal(await electron.evaluate(() => globalThis.installRequested), false);
      await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem; });
      checks.push("Renderer storage failure prevents backup/install; no silent loss of unsaved state");
      await dialog.getByRole("button", { name: "重启并更新", exact: true }).click();
      await page.getByText("我们马上再见", { exact: true }).waitFor();
      assert.equal(await electron.evaluate(() => globalThis.installRequested), true);
      const backups = fs.readdirSync(path.join(profile, "update-backups")); assert.equal(backups.length, 1);
      const backup = path.join(profile, "update-backups", backups[0]);
      assert.equal(JSON.parse(fs.readFileSync(path.join(backup, "backup.json"))).complete, true);
      assert(JSON.parse(fs.readFileSync(path.join(backup, "research-history", "conversations.json"))).conversations.some(item => item.id === conversation.id));
      const backedUpStorage = JSON.parse(fs.readFileSync(path.join(backup, "local-storage.json"), "utf8"));
      assert(JSON.parse(backedUpStorage["zhiyan-workbench.papers.v1"]).some(item => item.id === paper.id));
      assert(JSON.parse(backedUpStorage["zhiyan-workbench.groups.v1"]).some(item => item.id === "group-inbox"));
      assert.deepEqual(JSON.parse(backedUpStorage["zhiyan-workbench.appearance.v1"]), { theme: "light" });
      assert(JSON.parse(fs.readFileSync(path.join(backup, "documents", fixture.id, "parse.json"), "utf8")).blocks.length);
      assert(fs.existsSync(path.join(profile, "documents", fixture.id, "original.pdf")));
      assert.equal(fs.existsSync(path.join(backup, "documents", fixture.id, "original.pdf")), false);
      checks.push("Explicit install completes renderer handshake, browser flush, paper/group and parse metadata backup, retains the original PDF in place, flushes history and prepares app exit before requesting installation");
      assert.deepEqual(errors, []);
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify({ status: "passed", profile: "Isolated Electron, real electron-updater, localhost signed synthetic download. Installer launch intercepted; no real external calls or installation.", checks, errors }, null, 2));
      console.log(JSON.stringify({ status: "passed", checks }, null, 2));
    } finally { await electron.close(); server.close(); fs.rmSync(profile, { recursive: true, force: true }); }
  })().catch(error => { console.error(error.stack); server.close(); process.exitCode = 1; });
}
