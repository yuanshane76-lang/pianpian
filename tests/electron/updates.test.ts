import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { createUpdateController } = require("../../electron/update-controller.cjs");

const info = { version: "0.4.1", files: [{ url: "Pianpian-Setup-0.4.1-x64.exe", sha512: "hash", size: 12 }], releaseNotes: "修复阅读问题" };
function setup(overrides: Record<string, unknown> = {}) {
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => ({ isUpdateAvailable: true, updateInfo: info })),
    downloadUpdate: vi.fn(async () => ["installer.exe"]),
    quitAndInstall: vi.fn(),
  });
  const verify = vi.fn(async () => undefined);
  const prepare = vi.fn(async () => undefined);
  const controller = createUpdateController({ updater, version: "0.4.0", supported: true, verify, prepare, ...overrides });
  return { updater, verify, prepare, controller };
}

describe("explicit safe desktop updates", () => {
  it("checks without downloading and downloads without installing", async () => {
    const { updater, controller, verify } = setup();
    expect(updater).toMatchObject({ autoDownload: false, autoInstallOnAppQuit: false, allowDowngrade: false, allowPrerelease: false });
    expect((await controller.check()).phase).toBe("available");
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    await controller.download();
    expect(verify).toHaveBeenCalledWith(info, "installer.exe");
    expect(controller.getState().phase).toBe("downloaded");
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it("deduplicates checks and ignores downgrades", async () => {
    const { updater, controller } = setup();
    await Promise.all([controller.check(), controller.check()]);
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    updater.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: true, updateInfo: { ...info, version: "0.3.0" } });
    expect((await controller.check()).phase).toBe("current");
  });
  it("requires a verified download, then completes preparation before installing", async () => {
    const { controller, prepare, updater } = setup();
    await expect(controller.install({})).rejects.toThrow("下载");
    await controller.check(); await controller.download();
    await controller.install({ marker: "saved" });
    expect(prepare).toHaveBeenCalledWith({ marker: "saved" }, "0.4.1");
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(updater.quitAndInstall.mock.invocationCallOrder[0]);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });
  it("blocks a tampered installer and sanitizes raw network errors", async () => {
    const { controller, updater } = setup({ verify: async (_info: unknown, installer: string | null) => { if (installer) throw new Error("签名校验失败"); } });
    await controller.check(); await controller.download();
    expect(controller.getState()).toMatchObject({ phase: "error", message: expect.stringContaining("校验") });
    await expect(controller.install({})).rejects.toThrow();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    updater.emit("error", new Error("Bearer secret https://private.example"));
    expect(JSON.stringify(controller.getState())).not.toContain("secret");
  });
  it("keeps the app open if preparation fails and supports a retry", async () => {
    const { controller, updater, prepare } = setup();
    await controller.check(); await controller.download();
    prepare.mockRejectedValueOnce(new Error("备份失败"));
    await expect(controller.install({})).rejects.toThrow("备份失败");
    expect(controller.getState().phase).toBe("downloaded");
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    await controller.install({});
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });
  it("does not use updater or network in development/portable builds", async () => {
    const { controller, updater } = setup({ supported: false });
    expect((await controller.check()).phase).toBe("unsupported");
    await expect(controller.download()).rejects.toThrow();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
});
