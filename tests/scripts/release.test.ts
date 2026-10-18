import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { validateReleaseMetadata } = require("../../scripts/release.cjs");
const config = require("../../electron-builder.config.cjs");
const { isUpdateSupported } = require("../../electron/update-support.cjs");
describe("public release packaging", () => {
  it("does not interpolate an untrusted tag into PowerShell holding the signing key", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");
    expect(workflow).not.toContain("${{ github.ref_name }}");
    expect(workflow.indexOf("$env:GITHUB_REF_NAME")).toBeLessThan(workflow.indexOf("secrets.PIANPIAN_UPDATE_SIGNING_KEY"));
  });
  it("fixes identity, keeps user data and builds a real NSIS installer", () => {
    expect(config.appId).toBe("com.pianpian.desktop");
    expect(config.executableName).toBe("Pianpian");
    expect(config.nsis).toMatchObject({
      perMachine: false,
      deleteAppDataOnUninstall: false,
      createStartMenuShortcut: true,
      createDesktopShortcut: true,
      shortcutName: "篇篇",
      runAfterFinish: true,
      include: "assets/installer.nsh",
    });
    expect(config.win.target.map((target: { target: string }) => target.target)).toEqual(["nsis", "zip"]);
    expect(config.files).not.toContain("**/*");
  });
  it("packages a detectable installer marker with the updater configuration", () => {
    expect(config.files).toContain("update-config.json");
    expect(config.win.target.map((target: { target: string }) => target.target)).toContain("nsis");
    const paths = new Set(["C:\\app\\resources\\app-update.yml", "C:\\app\\Uninstall Pianpian.exe"]);
    expect(isUpdateSupported({
      isPackaged: true, platform: "win32", resourcesPath: "C:\\app\\resources", executablePath: "C:\\app\\Pianpian.exe",
      existsSync: (file: string) => paths.has(file),
    })).toBe(true);
  });
  it("rejects mismatched, prerelease and unexpected release files", () => {
    const info = { version: "0.4.0", files: [{ url: "Pianpian-Setup-0.4.0-x64.exe", sha512: "x".repeat(86) + "==", size: 10 }] };
    expect(validateReleaseMetadata(info, "0.4.0")).toBe(info.files[0]);
    expect(() => validateReleaseMetadata(info, "0.4.1")).toThrow();
    expect(() => validateReleaseMetadata({ ...info, version: "0.4.0-beta" }, "0.4.0-beta")).toThrow();
    expect(() => validateReleaseMetadata({ ...info, files: [{ ...info.files[0], url: "../evil.exe" }] }, "0.4.0")).toThrow();
  });
});
