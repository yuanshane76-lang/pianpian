// Reads only the existing encrypted desktop configuration; never prints secrets.
const { app, safeStorage } = require("electron");
const path = require("node:path");
const { createEncryptedSecretStore } = require("../electron/secret-store.cjs");
const { normalize, summary } = require("../electron/settings.cjs");
const { callModel } = require("../electron/ai.cjs");

app.setName("纸研工作台");
app.setPath("userData", path.join(app.getPath("appData"), "纸研工作台"));
app.whenReady().then(async () => {
  const store = createEncryptedSecretStore({ filePath: path.join(app.getPath("userData"), "service-settings.enc.json"), safeStorage });
  const settings = normalize(store.read());
  console.log(JSON.stringify({ userData: app.getPath("userData"), settings: summary(settings) }));
  if (settings.deepseek.apiKey) {
    const value = await callModel({ ...settings, aiProvider: "deepseek" }, {
      operation: "translate", paper: { blockData: [{ id: "sample", pageNumber: 1, text: "Attention is all you need." }] },
      block: { id: "sample", text: "Attention is all you need." },
    });
    console.log(JSON.stringify({ deepseek: "success", translation: value }));
  }
}).catch((cause) => { console.error(cause.message); process.exitCode = 1; }).finally(() => app.quit());
