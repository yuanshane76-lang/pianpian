const path = require("node:path");

function resolveAppAsset(distDirectory, requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "zhiyan:" || url.hostname !== "app") return null;

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname).replaceAll("\\", "/");
  } catch {
    return null;
  }
  if (pathname.includes("\0")) return null;

  const root = path.resolve(distDirectory);
  const target = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return target;
}

module.exports = { resolveAppAsset };
