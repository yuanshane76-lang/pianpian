const defaultFs = require("node:fs");
const path = require("node:path");

function createEncryptedSecretStore({ filePath, safeStorage, fs = defaultFs }) {
  function read() {
    if (!fs.existsSync(filePath)) return {};
    try {
      const payload = JSON.parse(String(fs.readFileSync(filePath, "utf8")));
      if (!payload || payload.encrypted !== true || typeof payload.data !== "string") return {};
      const plaintext = safeStorage.decryptString(Buffer.from(payload.data, "base64"));
      const parsed = JSON.parse(plaintext);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function write(value) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("当前系统不支持安全密钥存储");
    }
    const payload = {
      version: 1,
      encrypted: true,
      data: safeStorage.encryptString(JSON.stringify(value)).toString("base64"),
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
  }

  return { read, write };
}

module.exports = { createEncryptedSecretStore };
