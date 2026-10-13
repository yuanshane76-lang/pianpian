// Launch the built desktop with its normal encrypted settings and real services.
// Optional isolated userData is useful for paid acceptance without user library changes.
const { app } = require("electron");
const path = require("node:path");
app.setName(require("../package.json").productName);
app.setPath("userData", path.join(app.getPath("appData"), app.getName()));
if (process.env.ZHIYAN_LIVE_USER_DATA) {
  app.setPath("userData", process.env.ZHIYAN_LIVE_USER_DATA);
  app.setPath("sessionData", path.join(process.env.ZHIYAN_LIVE_USER_DATA, "session"));
}
Object.defineProperty(app, "isPackaged", { value: true });
require("../electron/main.cjs");
