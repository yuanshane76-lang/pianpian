const { app, BrowserWindow, ipcMain, net, protocol, safeStorage, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { resolveAppAsset } = require("./resource.cjs");
const { createEncryptedSecretStore } = require("./secret-store.cjs");
const { DEFAULT, normalize, summary, update } = require("./settings.cjs");
const { assertAppSender } = require("./ipc-security.cjs");
const { streamModel } = require("./ai.cjs");
const { registerAiStreamHandlers } = require("./ai-stream-ipc.cjs");
const { createDocumentStore } = require("./document-store.cjs");
const { createDocumentTasks } = require("./document-tasks.cjs");

const isDev = !app.isPackaged;
const distDirectory = path.join(__dirname, "..", "dist");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "zhiyan",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

function registerAppProtocol() {
  protocol.handle("zhiyan", (request) => {
    const filePath = resolveAppAsset(distDirectory, request.url);
    if (!filePath) return new Response("资源不存在", { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#f4f7f7",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // 先隐藏窗口，等首帧画好再显示，避免深色主题启动时闪白；加载失败时兜底显示。
  window.once("ready-to-show", () => window.show());
  window.webContents.once("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    const allowed = ["https://mineru.net/", "https://help.aliyun.com/", "https://bailian.console.aliyun.com/", "https://platform.deepseek.com/"];
    if (allowed.some((prefix) => url.startsWith(prefix))) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  if (isDev) {
    window.loadURL("http://127.0.0.1:4173/");
  } else {
    window.loadURL("zhiyan://app/index.html");
  }
}

app.whenReady().then(() => {
  if (!isDev) registerAppProtocol();
  const secureHandle = (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
    assertAppSender(event, isDev);
    return handler(...args);
  });
  secureHandle("zhiyan:ping", () => ({ ok: true, at: new Date().toISOString() }));
  const store = createEncryptedSecretStore({
    filePath: path.join(app.getPath("userData"), "service-settings.enc.json"),
    safeStorage,
  });
  const readSettings = () => normalize(store.read());
  const disposeAiStreams = registerAiStreamHandlers({ ipcMain, isDev, readSettings, streamModel });
  app.once("before-quit", disposeAiStreams);
  const documents = createDocumentStore({ rootDirectory: path.join(app.getPath("userData"), "documents") });
  const documentTasks = createDocumentTasks({ documents, readSettings });
  secureHandle("zhiyan:documents:save", (input) => documents.save(input));
  secureHandle("zhiyan:documents:read", (id) => documents.read(id));
  secureHandle("zhiyan:documents:delete", (id) => documents.remove(id));
  secureHandle("zhiyan:documents:asset", (input) => documents.readAsset(input?.id, input?.path));
  secureHandle("zhiyan:documents:state", (id) => documentTasks.snapshot(id));
  secureHandle("zhiyan:documents:states", async (items) => {
    if (!Array.isArray(items) || items.length > 200) throw new Error("文档任务列表无效");
    return Promise.all(items.map(async (item) => ({
      paperId: typeof item?.paperId === "string" ? item.paperId : "",
      ...(await documentTasks.snapshot(item?.documentId)),
    })));
  });
  secureHandle("zhiyan:mineru:start", (id) => documentTasks.start(id));
  secureHandle("zhiyan:mineru:status", (id) => documentTasks.status(id));
  secureHandle("zhiyan:settings:get", () => summary(readSettings()));
  secureHandle("zhiyan:settings:save", (input) => {
    const next = update(readSettings(), input);
    store.write(next);
    return summary(next);
  });
  secureHandle("zhiyan:settings:test", async (provider) => {
    if (provider === "mineru") {
      const settings = readSettings();
      if (!settings.mineru.apiKey) throw new Error("请先保存 MinerU Token");
      return { ok: true, message: "MinerU Token 已保存。请在阅读器点击“增强解析”，通过实际 PDF 上传和解析验证权限与额度。" };
    }
    if (!["aliyun", "deepseek"].includes(provider)) throw new Error("请选择模型服务");
    const settings = readSettings();
    const service = settings[provider];
    if (!service.apiKey) throw new Error("请先保存对应服务的密钥");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${service.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${service.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: service.model,
          messages: [{ role: "user", content: "只回复：好" }],
          max_tokens: 8,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`连通性检查失败（HTTP ${response.status}）`);
      return { ok: true, message: "当前模型可调用。此测试可能产生少量费用。" };
    } finally {
      clearTimeout(timeout);
    }
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
