import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteOriginalPdf, readOriginalPdf } from "../../src/services/originalPdf";

afterEach(() => {
  delete window.zhiyan;
});

describe("original PDF lifecycle", () => {
  it("shares only simultaneous reads and retries a failed read", async () => {
    let resolve: (data: Uint8Array) => void = () => {};
    const invoke = vi.fn(() => new Promise<Uint8Array>(finish => { resolve = finish; }));
    window.zhiyan = { invoke: invoke as never };
    const first = readOriginalPdf("document-id"), duplicate = readOriginalPdf("document-id");
    expect(invoke).toHaveBeenCalledTimes(1);
    resolve(new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(await first)).toEqual(new Uint8Array(await duplicate));
    invoke.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(readOriginalPdf("document-id")).rejects.toThrow("disk unavailable");
    invoke.mockResolvedValueOnce(new Uint8Array([4]));
    expect(new Uint8Array(await readOriginalPdf("document-id"))).toEqual(new Uint8Array([4]));
    expect(invoke).toHaveBeenCalledTimes(3);
  });
  it("routes desktop document deletion through the protected bridge", async () => {
    const invoke = vi.fn(async () => undefined);
    window.zhiyan = { invoke: invoke as never };

    await deleteOriginalPdf("document-id");

    expect(invoke).toHaveBeenCalledWith("zhiyan:documents:delete", "document-id");
  });
});
