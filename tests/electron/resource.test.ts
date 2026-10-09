import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveAppAsset } = require("../../electron/resource.cjs") as {
  resolveAppAsset: (distDirectory: string, requestUrl: string) => string | null;
};

const distDirectory = path.resolve("D:/paper-app/dist");

describe("packaged desktop resources", () => {
  it("maps app URLs to bundled files", () => {
    expect(resolveAppAsset(distDirectory, "zhiyan://app/index.html")).toBe(
      path.join(distDirectory, "index.html"),
    );
    expect(resolveAppAsset(distDirectory, "zhiyan://app/assets/index.js")).toBe(
      path.join(distDirectory, "assets", "index.js"),
    );
  });

  it("rejects other hosts and paths outside the bundle", () => {
    expect(resolveAppAsset(distDirectory, "zhiyan://other/index.html")).toBeNull();
    expect(resolveAppAsset(distDirectory, "zhiyan://app/%2e%2e%5cprivate.txt")).toBeNull();
    expect(resolveAppAsset(distDirectory, "https://example.com/index.html")).toBeNull();
  });
});
