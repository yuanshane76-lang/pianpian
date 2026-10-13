const { app, BrowserWindow, ipcMain, net, protocol, safeStorage, shell, dialog, screen } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { resolveAppAsset } = require("./resource.cjs");
const { createEncryptedSecretStore } = require("./secret-store.cjs");
const { DEFAULT, normalize, resolveTestService, summary, update } = require("./settings.cjs");
const { assertAppSender } = require("./ipc-security.cjs");
const { streamModel } = require("./ai.cjs");
const { registerAiStreamHandlers } = require("./ai-stream-ipc.cjs");
const { createDocumentStore } = require("./document-store.cjs");
const { createDocumentTasks } = require("./document-tasks.cjs");
const { registerResearchAgentHandlers } = require("./research-agent-ipc.cjs");

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
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = Math.min(workArea.width, 1440, Math.max(980, Math.floor(workArea.width * 0.92)));
  const height = Math.min(workArea.height, 920, Math.max(680, Math.floor(workArea.height * 0.9)));
  const window = new BrowserWindow({
    width,
    height,
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + Math.floor((workArea.height - height) / 2),
    minWidth: Math.min(980, workArea.width),
    minHeight: Math.min(680, workArea.height),
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
  secureHandle("zhiyan:agent:save-document", async (input) => {
    if (typeof input?.title !== "string" || input.title.length > 200 ||
        typeof input?.markdown !== "string" || !input.markdown || input.markdown.length > 60000) {
      throw new Error("文档内容无效");
    }
    const result = await dialog.showSaveDialog({
      title: "保存研究笔记",
      defaultPath: `${input.title.replace(/[\\/:*?"<>|]/g, "_")}.md`,
      filters: [{ name: "Markdown 文档", extensions: ["md"] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    await fs.writeFile(result.filePath, input.markdown, "utf8");
    return { saved: true };
  });
  const store = createEncryptedSecretStore({
    filePath: path.join(app.getPath("userData"), "service-settings.enc.json"),
    safeStorage,
  });
  const readSettings = () => normalize(store.read());
  const disposeAiStreams = registerAiStreamHandlers({ ipcMain, isDev, readSettings, streamModel });
  const disposeResearchAgent = registerResearchAgentHandlers({ ipcMain, isDev, readSettings });
  app.once("before-quit", () => {
    disposeAiStreams();
    disposeResearchAgent();
  });
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
  secureHandle("zhiyan:settings:test", async (input) => {
    const provider = typeof input === "string" ? input : input?.provider;
    const draft = typeof input === "object" && input ? input : {};
    const settings = readSettings();
    if (provider === "mineru") {
      resolveTestService(settings, provider, draft);
      return { ok: true, message: "当前 MinerU Token 可用。请在阅读器点击“增强解析”，通过实际 PDF 上传和解析验证权限与额度。" };
    }
    if (!["aliyun", "deepseek"].includes(provider)) throw new Error("请选择模型服务");
    const serviceDraft = resolveTestService(settings, provider, draft);
    const service = settings[provider];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${service.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceDraft.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: serviceDraft.model,
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
