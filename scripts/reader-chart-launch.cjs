const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

app.setName("纸研工作台");
app.setPath("userData", path.join(app.getPath("appData"), "纸研工作台"));
const sessionDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "zhiyan-reader-e2e-"));
const localState = path.join(app.getPath("userData"), "Local State");
if (fs.existsSync(localState)) fs.copyFileSync(localState, path.join(sessionDirectory, "Local State"));
app.setPath("sessionData", sessionDirectory);
// Install before the application restores any document tasks.
if (process.env.ZHIYAN_E2E_LIVE_AI !== "1") {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (/^https?:/i.test(String(url)) && !String(url).startsWith("http://127.0.0.1:4173/")) {
      throw new Error("Local desktop checks block external requests; explicitly opt in to live AI");
    }
    return originalFetch(url, options);
  };
}
require("../electron/main.cjs");
