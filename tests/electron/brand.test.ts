import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { configureBrand, brand } = require("../../electron/brand.cjs");

function appAt(name: string, directory = path.join("profiles", name), explicit = false) {
  const directories: Record<string, string> = { appData: "profiles", userData: directory };
  return {
    commandLine: { hasSwitch: (key: string) => explicit && key === "user-data-dir" },
    getName: () => name,
    getPath: (key: string) => directories[key],
    setName: vi.fn(),
    setPath: vi.fn((key: string, value: string) => { directories[key] = value; }),
  };
}

describe("Pianpian desktop identity", () => {
  it.each(["篇篇", "纸研工作台", "zhiyan-workbench"])("keeps established user data after renaming %s", (name) => {
    const app = appAt(name);
    configureBrand(app);
    expect(app.getPath("userData")).toBe(path.join("profiles", "纸研工作台"));
    expect(app.setName).toHaveBeenCalledWith("篇篇");
    expect(brand.tagline).toBe("每篇论文，都有个伴。");
  });
  it("respects an explicit user data directory so isolated launches cannot access real credentials", () => {
    const app = appAt("篇篇", path.join("isolated", "acceptance"));
    configureBrand(app);
    expect(app.getPath("userData")).toBe(path.join("isolated", "acceptance"));
    expect(app.setPath).not.toHaveBeenCalled();
    expect(app.setName).toHaveBeenCalledWith("篇篇");
  });
  it("does not override an explicit command-line profile even when it matches the default name", () => {
    const app = appAt("篇篇", path.join("profiles", "篇篇"), true);
    configureBrand(app);
    expect(app.getPath("userData")).toBe(path.join("profiles", "篇篇"));
    expect(app.setPath).not.toHaveBeenCalled();
    expect(app.setName).toHaveBeenCalledWith("篇篇");
  });
  it("recognizes the package name used by older Electron defaults", () => {
    const app = appAt("篇篇", path.join("profiles", "zhiyan-workbench"));
    configureBrand(app);
    expect(app.getPath("userData")).toBe(path.join("profiles", "纸研工作台"));
  });
});
