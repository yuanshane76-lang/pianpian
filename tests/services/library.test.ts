import { afterEach, describe, expect, it, vi } from "vitest";
import { importPdfFile, loadPapers, savePapers } from "../../src/services/library";
import { removePaper, updatePaperMetadata, type PaperRecord } from "../../src/domain/library";

const basePaper: PaperRecord = {
  id: "base",
  title: "Same name",
  authors: [],
  year: null,
  sourcePath: "local://paper.pdf:100:1",
  importedAt: "2026-09-29T08:00:00.000Z",
  tags: [],
  favorite: false,
  blocks: 1,
};

function createTestPdf(bytes: number[]): File {
  const data = new Uint8Array(bytes);
  return {
    name: "论文.pdf",
    size: data.byteLength,
    lastModified: 1,
    arrayBuffer: async () => data.buffer,
  } as unknown as File;
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("paper persistence", () => {
  it("keeps same-name files when their fingerprints differ", () => {
    savePapers([
      basePaper,
      {
        ...basePaper,
        id: "different-file",
        sourcePath: "local://paper.pdf:200:2",
        importedAt: "2026-09-29T09:00:00.000Z",
      },
    ]);

    expect(loadPapers().map((paper) => paper.id)).toEqual(["different-file", "base"]);
  });

  it("keeps the newest import for the same fingerprint", () => {
    savePapers([
      basePaper,
      {
        ...basePaper,
        id: "newer-import",
        importedAt: "2026-09-29T10:00:00.000Z",
      },
    ]);

    expect(loadPapers().map((paper) => paper.id)).toEqual(["newer-import"]);
  });

  it("only removes the known legacy storage key", () => {
    window.localStorage.setItem("paperquay-rebuild.papers.v5", "[]");
    window.localStorage.setItem("paperquay-rebuild.other-feature", "keep");

    expect(loadPapers()).toEqual([]);
    expect(window.localStorage.getItem("paperquay-rebuild.papers.v5")).toBeNull();
    expect(window.localStorage.getItem("paperquay-rebuild.other-feature")).toBe("keep");
  });

  it("creates different ids for same-metadata files with different contents", async () => {
    const first = createTestPdf([1, 2, 3, 4]);
    const second = createTestPdf([1, 2, 3, 5]);

    const [firstPaper, secondPaper] = await Promise.all([
      importPdfFile(first),
      importPdfFile(second),
    ]);

    expect(firstPaper.id).not.toBe(secondPaper.id);
    expect(firstPaper.sourcePath).not.toBe(secondPaper.sourcePath);
  });

  it("reports when papers cannot be persisted", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage full");
    });

    expect(savePapers([basePaper])).toBe(false);
  });
});

describe("paper library management", () => {
  it("updates editable metadata without changing the document identity", () => {
    const updated = updatePaperMetadata([basePaper], basePaper.id, {
      title: "  Attention Is All You Need  ",
      authors: [" Ashish Vaswani ", "", "Ashish Vaswani"],
      year: 2017,
      tags: ["transformer", " transformer ", "NLP"],
    })[0];

    expect(updated).toMatchObject({
      id: basePaper.id,
      sourcePath: basePaper.sourcePath,
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani"],
      year: 2017,
      tags: ["transformer", "NLP"],
    });
  });

  it("removes exactly one paper from the library", () => {
    const second = { ...basePaper, id: "second" };
    expect(removePaper([basePaper, second], basePaper.id)).toEqual([second]);
  });
});
