const fs = require("node:fs");
const path = require("node:path");

function isUpdateSupported({ isPackaged, platform, resourcesPath, executablePath, existsSync = fs.existsSync }) {
  if (!isPackaged || platform !== "win32") return false;
  const uninstallName = `Uninstall ${path.parse(executablePath).name}.exe`;
  return existsSync(path.join(resourcesPath, "app-update.yml")) &&
    existsSync(path.join(path.dirname(executablePath), uninstallName));
}

module.exports = { isUpdateSupported };
