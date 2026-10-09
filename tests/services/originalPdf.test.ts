import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteOriginalPdf } from "../../src/services/originalPdf";

afterEach(() => {
  delete window.zhiyan;
});

describe("original PDF lifecycle", () => {
  it("routes desktop document deletion through the protected bridge", async () => {
    const invoke = vi.fn(async () => undefined);
    window.zhiyan = { invoke: invoke as never };

    await deleteOriginalPdf("document-id");

    expect(invoke).toHaveBeenCalledWith("zhiyan:documents:delete", "document-id");
  });
});
