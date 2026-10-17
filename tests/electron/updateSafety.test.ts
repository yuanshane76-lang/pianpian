import { createRequire } from "node:module";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { verifyReleaseSignature } = require("../../electron/update-signature.cjs");
const { createUpdateBackup, validateStorageSnapshot } = require("../../electron/update-backup.cjs");
const { isUpdateSupported } = require("../../electron/update-support.cjs");
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
async function temporary() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pianpian-update-test-")); directories.push(directory); return directory; }
describe("update integrity and data preservation", () => {
  it("enables automatic updates only for installed Windows builds", () => {
    const paths = new Set(["C:\\app\\resources\\app-update.yml", "C:\\app\\Uninstall Pianpian.exe"]);
    const options = {
      isPackaged: true, platform: "win32", resourcesPath: "C:\\app\\resources", executablePath: "C:\\app\\Pianpian.exe",
      existsSync: (file: string) => paths.has(file),
    };
    expect(isUpdateSupported(options)).toBe(true);
    paths.delete("C:\\app\\Uninstall Pianpian.exe");
    expect(isUpdateSupported(options)).toBe(false);
    expect(isUpdateSupported({ ...options, platform: "darwin" })).toBe(false);
    expect(isUpdateSupported({ ...options, isPackaged: false })).toBe(false);
  });
  it("validates release version, signed SHA512 and the downloaded bytes", async () => {
    const directory = await temporary();
    const installer = path.join(directory, "installer.exe");
    await fs.writeFile(installer, "synthetic-executable");
    const hash = createHash("sha512").update("synthetic-executable").digest("base64");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const payload = JSON.stringify({ schema: 1, version: "0.4.1", file: "Pianpian-Setup-0.4.1-x64.exe", sha512: hash, size: 20 });
    const envelope = { payload, signature: sign(null, Buffer.from(payload), privateKey).toString("base64") };
    const options = { envelope, info: { version: "0.4.1", files: [{ url: "Pianpian-Setup-0.4.1-x64.exe", sha512: hash, size: 20 }] }, installer, publicKey: publicKey.export({ type: "spki", format: "pem" }) };
    await expect(verifyReleaseSignature(options)).resolves.toBeUndefined();
    await fs.writeFile(installer, "tampered-executable");
    await expect(verifyReleaseSignature(options)).rejects.toThrow("校验");
    await expect(verifyReleaseSignature({ ...options, envelope: { ...envelope, payload: payload.replace("0.4.1", "0.4.2") } })).rejects.toThrow("签名");
    await expect(verifyReleaseSignature({ ...options, info: { ...options.info, version: "0.4.2" } })).rejects.toThrow("版本");
  });
  it("rejects undeclared storage, invalid JSON and oversized snapshots", () => {
    expect(() => validateStorageSnapshot({ "authorization": "secret" })).toThrow();
    expect(() => validateStorageSnapshot({ "zhiyan-workbench.papers.v1": "broken" })).toThrow();
    expect(() => validateStorageSnapshot({ "zhiyan-workbench.papers.v1": JSON.stringify("x".repeat(32 * 1024 * 1024)) })).toThrow();
  });
  it("backs up logical browser state, encrypted settings, history and parse metadata without changing originals", async () => {
    const userData = await temporary();
    const id = "a".repeat(64);
    await fs.mkdir(path.join(userData, "research-history"));
    await fs.mkdir(path.join(userData, "documents", id), { recursive: true });
    await fs.writeFile(path.join(userData, "service-settings.enc.json"), "encrypted-by-os");
    await fs.writeFile(path.join(userData, "research-history", "conversations.json"), '{"history":[]}');
    await fs.writeFile(path.join(userData, "documents", id, "parse.json"), '{"blocks":[]}');
    await fs.writeFile(path.join(userData, "documents", id, "original.pdf"), "%PDF-synthetic");
    const storage = {
      "zhiyan-workbench.papers.v1": "[]",
      "zhiyan-workbench.groups.v1": "[]",
      "zhiyan-workbench.wordbook.v1": "[]",
      "zhiyan-workbench.analysis.v1": "[]",
      "zhiyan-workbench.appearance.v1": "{\"theme\":\"light\"}",
    };
    const result = await createUpdateBackup({ userData, storage, fromVersion: "0.4.0", toVersion: "0.4.1" });
    expect(JSON.parse(await fs.readFile(path.join(result.directory, "local-storage.json"), "utf8"))).toEqual(storage);
    expect(await fs.readFile(path.join(result.directory, "service-settings.enc.json"), "utf8")).toBe("encrypted-by-os");
    expect(await fs.readFile(path.join(result.directory, "documents", id, "parse.json"), "utf8")).toContain("blocks");
    expect(await fs.readFile(path.join(userData, "documents", id, "original.pdf"), "utf8")).toBe("%PDF-synthetic");
    await expect(fs.stat(path.join(result.directory, "documents", id, "original.pdf"))).rejects.toThrow();
    const manifest = JSON.parse(await fs.readFile(path.join(result.directory, "backup.json"), "utf8"));
    expect(manifest).toMatchObject({ complete: true, fromVersion: "0.4.0", toVersion: "0.4.1" });
    expect(manifest.files.some((file: { path: string }) => file.path === "local-storage.json")).toBe(true);
  });
  it("refuses to back up through a linked user-data subtree", async () => {
    const userData = await temporary(); const elsewhere = await temporary();
    await fs.symlink(elsewhere, path.join(userData, "research-history"), "junction");
    await expect(createUpdateBackup({ userData, storage: {}, fromVersion: "0.4.0", toVersion: "0.4.1" })).rejects.toThrow();
    expect(await fs.readdir(path.join(userData, "update-backups"))).toEqual([]);
  });
  it("removes only its incomplete backup after a later source copy fails", async () => {
    const userData = await temporary();
    const elsewhere = await temporary();
    await fs.writeFile(path.join(userData, "service-settings.enc.json"), "encrypted-settings");
    await fs.mkdir(path.join(userData, "research-history"));
    await fs.symlink(elsewhere, path.join(userData, "documents"), "junction");
    await expect(createUpdateBackup({ userData, storage: {}, fromVersion: "0.4.0", toVersion: "0.4.1" })).rejects.toThrow();
    expect(await fs.readdir(path.join(userData, "update-backups"))).toEqual([]);
    expect(await fs.readFile(path.join(userData, "service-settings.enc.json"), "utf8")).toBe("encrypted-settings");
  });
});
