const { createUpdateController } = require("./update-controller.cjs");
const { verifyReleaseSignature } = require("./update-signature.cjs");
const { createUpdateBackup, STORAGE_KEYS } = require("./update-backup.cjs");
const { assertAppSender } = require("./ipc-security.cjs");
const { isUpdateSupported } = require("./update-support.cjs");
const config = require("../update-config.json");
const { randomUUID } = require("node:crypto");
const EVENT = "zhiyan:update:event";

function registerUpdateService({ app, ipcMain, BrowserWindow, shell, net, prepareWrites, resumeWrites, isBusy, flushHistory, finalizeExit }) {
  const supported = isUpdateSupported({
    isPackaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    executablePath: app.getPath("exe"),
  });
  const { autoUpdater } = require("electron-updater");
  // Use a fixed public repository; renderer input can never select an update URL or token.
  if (supported) autoUpdater.setFeedURL({ provider: "github", owner: config.owner, repo: config.repo, private: false, releaseType: "release" });
  autoUpdater.logger = { info() {}, warn() {}, error() {}, debug() {} };
  let signed = null;
  let pendingSave = null;
  ipcMain.handle("zhiyan:update:saved", (event, input) => {
    assertAppSender(event, !app.isPackaged);
    if (!pendingSave || pendingSave.senderId !== event.sender.id || input?.requestId !== pendingSave.requestId) throw new Error("无效的保存确认。");
    const pending = pendingSave; pendingSave = null; clearTimeout(pending.timer);
    if (input.saved === true) pending.resolve(); else pending.reject(new Error("当前记录未能保存，更新已停止。"));
  });
  async function saveRenderer(window) {
    await new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => { pendingSave = null; reject(new Error("记录保存超时，更新已停止。")); }, 20000);
      pendingSave = { requestId, senderId: window.webContents.id, resolve, reject, timer };
      window.webContents.send("zhiyan:update:prepare", { requestId });
    });
  }
  const broadcast = (state) => {
    if (state.phase === "error") resumeWrites();
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(EVENT, state);
  };
  async function signature(info, installer) {
    if (!installer || !signed || signed.version !== info.version) {
      const url = `https://github.com/${config.owner}/${config.repo}/releases/download/v${info.version}/update-signature.json`;
      const response = await net.fetch(url, { signal: AbortSignal.timeout(20000), cache: "no-store" });
      if (!response.ok) throw new Error("无法读取更新签名");
      const reader = response.body.getReader(); let text = "";
      try {
        const decoder = new TextDecoder();
        for (;;) { const { done, value } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); if (text.length > 8192) throw new Error("更新签名过大"); }
      } finally { await reader.cancel(); }
      signed = { version: info.version, envelope: JSON.parse(text) };
    }
    try { await verifyReleaseSignature({ info, installer, envelope: signed.envelope, publicKey: config.publicKey }); }
    catch (error) { signed = null; throw error; }
  }
  const controller = createUpdateController({ updater: autoUpdater, version: app.getVersion(), supported,
    verify: signature, emit: broadcast,
    prepare: async (_snapshot, targetVersion) => {
      prepareWrites();
      try {
        if (isBusy()) throw new Error("仍有导入、解析或回答正在进行，请完成后再更新。");
        await flushHistory();
        const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
        if (windows.length !== 1) throw new Error("请关闭额外窗口后再更新。");
        const window = windows[0];
        await saveRenderer(window);
        const storage = await window.webContents.executeJavaScript(`(() => {
          const result = {};
          for (const key of ${JSON.stringify(STORAGE_KEYS)}) { const value = localStorage.getItem(key); if (value !== null) result[key] = value; }
          return result;
        })()`);
        await window.webContents.session.flushStorageData();
        await createUpdateBackup({ userData: app.getPath("userData"), storage, fromVersion: app.getVersion(), toVersion: targetVersion });
        await finalizeExit();
      } catch (error) { resumeWrites(); throw error; }
    },
  });
  for (const [action, handler] of Object.entries({ state: () => controller.getState(), check: () => controller.check(),
    download: () => controller.download(), install: () => controller.install(),
    releases: () => shell.openExternal(`https://github.com/${config.owner}/${config.repo}/releases/latest`),
  })) {
    ipcMain.handle(`zhiyan:update:${action}`, (event) => { assertAppSender(event, !app.isPackaged); return handler(); });
  }
  return { controller, open: () => broadcast({ ...controller.getState(), open: true }) };
}
module.exports = { registerUpdateService };
