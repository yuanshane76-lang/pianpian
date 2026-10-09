import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { assertAppSender } = require("../../electron/ipc-security.cjs") as {
  assertAppSender: (event: unknown, isDev: boolean) => void;
};

describe("desktop IPC sender", () => {
  const sender = (url: string, childFrame = false) => {
    const mainFrame = { url };
    return { sender: { mainFrame }, senderFrame: childFrame ? { url } : mainFrame };
  };

  it("allows only the main application frame", () => {
    expect(() => assertAppSender(sender("zhiyan://app/index.html"), false)).not.toThrow();
    expect(() => assertAppSender(sender("http://127.0.0.1:4173/"), true)).not.toThrow();
    expect(() => assertAppSender(sender("zhiyan://app/index.html", true), false)).toThrow();
    expect(() => assertAppSender(sender("https://example.com/"), false)).toThrow();
    expect(() => assertAppSender(sender("http://localhost:4173/"), true)).toThrow();
  });
});
