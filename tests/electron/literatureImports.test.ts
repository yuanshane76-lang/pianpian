// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

describe("literature import ownership", () => {
  it("finishes cancellation cleanup before retry or manual document writes can reuse the original", async () => {
    const { createLiteratureImports } = require("../../electron/literature-imports.cjs");
    const files = new Set<string>();
    let finishRemove!: () => void;
    const deleting = new Promise<void>((resolve) => { finishRemove = resolve; });
    const documents = {
      remove: vi.fn(async (id: string) => { await deleting; files.delete(id); }),
    };
    const download = vi.fn(async () => {
      const duplicate = files.has("same-document");
      files.add("same-document");
      return { id: "same-document", name: "paper.pdf", duplicate };
    });
    const imports = createLiteratureImports({ documents, download });
    const first = await imports.start("1706.03762v7");
    const cancel = imports.finish({ importId: first.importId, retained: false });
    const retry = imports.start("1706.03762v7");
    const manualWrite = vi.fn(async () => files.add("manual-document"));
    const manual = imports.run(manualWrite);
    await Promise.resolve();
    expect(download).toHaveBeenCalledOnce();
    expect(manualWrite).not.toHaveBeenCalled();

    finishRemove();
    await cancel;
    const second = await retry;
    expect(second.duplicate).toBe(false);
    expect(files.has("same-document")).toBe(true);
    await imports.finish({ importId: second.importId, retained: true });
    await manual;
    expect(files.has("same-document")).toBe(true);
    expect(manualWrite).toHaveBeenCalledOnce();
  });

  it.each([true, false])("never removes an existing or committed original (duplicate=%s)", async (duplicate) => {
    const { createLiteratureImports } = require("../../electron/literature-imports.cjs");
    const documents = { remove: vi.fn() };
    const imports = createLiteratureImports({
      documents, download: async () => ({ id: "document", name: "paper.pdf", duplicate }),
    });
    const saved = await imports.start("1706.03762v7");
    await imports.finish({ importId: saved.importId, retained: !duplicate });
    expect(documents.remove).not.toHaveBeenCalled();
  });

  it("releases the queue if downloading fails", async () => {
    const { createLiteratureImports } = require("../../electron/literature-imports.cjs");
    const imports = createLiteratureImports({ documents: {}, download: async () => { throw new Error("网络失败"); } });
    await expect(imports.start("1706.03762v7")).rejects.toThrow("网络失败");
    await expect(imports.run(async () => "saved")).resolves.toBe("saved");
  });
});
