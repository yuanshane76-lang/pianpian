const lockfile = require("./package-lock.json");
const skillManifest = require("./skills/research/manifest.json");
const skillFiles = ["skills/research/manifest.json", ...skillManifest.skills.map((skill) => `skills/research/${skill.name}/SKILL.md`)];
const runtimePackages = Object.entries(lockfile.packages || {}).filter(([root, item]) => root.startsWith("node_modules/") && item.dev !== true)
  .map(([root]) => root);

function ignorePackageFile(file) {
  const relative = file.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!relative) return false;

  const parts = relative.split("/");
  if (["package.json", "brand.json", "update-config.json"].includes(relative)) return false;
  if (relative === "assets" || relative === "assets/brand" || relative === "assets/brand/pianpian.ico") return false;
  if (parts[0] === "skills") {
    return !skillFiles.some((file) => file === relative || file.startsWith(`${relative}/`));
  }
  if (parts[0] === "node_modules") {
    if (parts.some((part) => [".cache", ".vite", ".bin", ".git"].includes(part))) return true;
    return !runtimePackages.some((root) => relative === root || relative.startsWith(`${root}/`) || root.startsWith(`${relative}/`));
  }
  if (parts[0] === "electron") {
    if (parts.length === 1) return false;
    return parts.length !== 2 || !["main.cjs", "brand.cjs", "preload.cjs", "resource.cjs", "secret-store.cjs", "settings.cjs", "ipc-security.cjs", "ai.cjs", "ai-stream-ipc.cjs", "document-store.cjs", "document-tasks.cjs", "mineru.cjs", "arxiv.cjs", "arxiv-pdf-download.cjs", "literature-imports.cjs", "research-agent-runtime.cjs", "research-agent-tools.cjs", "research-agent-ipc.cjs", "research-citations.cjs", "literature-search.cjs", "pi-agent.cjs", "pi-worker-session.cjs", "pi-agent-worker.cjs", "research-skills.cjs", "research-conversations.cjs", "research-library.cjs", "update-controller.cjs", "update-signature.cjs", "update-backup.cjs", "update-service.cjs", "update-support.cjs"].includes(parts[1]);
  }
  if (parts[0] === "dist") {
    if (parts.length === 1 || relative === "dist/index.html") return false;
    if (relative === "dist/pdf.worker.min.mjs") return false;
    if (parts[1] === "brand") return parts.length > 3 || (parts.length === 3 && !["pianpian-avatar.webp", "pianpian-reading.webp"].includes(parts[2]));
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
    executableName: "Pianpian",
    icon: "assets/brand/pianpian.ico",
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
