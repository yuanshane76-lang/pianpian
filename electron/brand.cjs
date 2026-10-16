const path = require("node:path");
const brand = require("../brand.json");

function configureBrand(app) {
  const currentDirectory = app.getPath("userData");
  const appDataDirectory = app.getPath("appData");
  const defaultDirectories = new Set(
    [app.getName(), brand.name, brand.legacyDataDirectory, "zhiyan-workbench"]
      .filter(Boolean)
      .map((name) => path.resolve(appDataDirectory, name)),
  );
  // Keep existing PDFs, history and encrypted settings in their established
  // directory. Explicit --user-data-dir and test profiles must stay isolated.
  if (!app.commandLine?.hasSwitch("user-data-dir") &&
      [...defaultDirectories].some((directory) => path.resolve(currentDirectory).toLowerCase() === directory.toLowerCase())) {
    app.setPath("userData", path.join(appDataDirectory, brand.legacyDataDirectory));
  }
  app.setName(brand.name);
}

module.exports = { brand, configureBrand };
