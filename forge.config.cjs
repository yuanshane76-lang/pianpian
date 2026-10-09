function ignorePackageFile(file) {
  const relative = file.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!relative) return false;

  const parts = relative.split("/");
  if (relative === "package.json") return false;
  if (parts[0] === "electron") {
    if (parts.length === 1) return false;
    return parts.length !== 2 || !["main.cjs", "preload.cjs", "resource.cjs", "secret-store.cjs", "settings.cjs", "ipc-security.cjs", "ai.cjs", "ai-stream-ipc.cjs", "document-store.cjs", "document-tasks.cjs", "mineru.cjs"].includes(parts[1]);
  }
  if (parts[0] === "dist") {
    if (parts.length === 1 || relative === "dist/index.html") return false;
    if (relative === "dist/pdf.worker.min.mjs") return false;
    if (parts[1] === "assets") {
      return parts.length > 3 || (parts.length === 3 && !/\.(?:js|mjs|css|woff2?|ttf)$/.test(parts[2]));
    }
    if (parts[1] === "standard_fonts") {
      return parts.length > 3 ||
        (parts.length === 3 && !(/^(?:LICENSE_[A-Z_]+|[^/]+\.(?:pfb|ttf))$/.test(parts[2])));
    }
  }
  return true;
}

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "Zhiyan",
    prune: false,
    ignore: ignorePackageFile,
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32"],
    },
  ],
};
