import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createEncryptedSecretStore } = require("../../electron/secret-store.cjs") as {
  createEncryptedSecretStore: (options: {
    filePath: string;
    safeStorage: {
      isEncryptionAvailable: () => boolean;
      encryptString: (value: string) => Buffer;
      decryptString: (value: Buffer) => string;
    };
    fs: {
      existsSync: (filePath: string) => boolean;
      mkdirSync: () => void;
      readFileSync: (filePath: string) => string;
      writeFileSync: (filePath: string, content: string) => void;
    };
  }) => {
    read: () => Record<string, unknown>;
    write: (value: Record<string, unknown>) => void;
  };
};

describe("desktop secret store", () => {
  it("encrypts values before writing them and decrypts them on read", () => {
    const files = new Map<string, string>();
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
      decryptString: (value: Buffer) => value.toString("utf8").replace("encrypted:", ""),
    };

    const store = createEncryptedSecretStore({
      filePath: "D:/paper/service-settings.enc.json",
      safeStorage,
      fs: {
        existsSync: (filePath: string) => files.has(filePath),
        mkdirSync: () => undefined,
        readFileSync: (filePath: string) => files.get(filePath) ?? "",
        writeFileSync: (filePath: string, content: string) => files.set(filePath, content),
      },
    });

    store.write({ apiKey: "do-not-leak" });

    expect(files.get("D:/paper/service-settings.enc.json")).not.toContain("do-not-leak");
    expect(store.read()).toEqual({ apiKey: "do-not-leak" });
  });
});
