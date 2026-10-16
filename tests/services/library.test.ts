import { afterEach, describe, expect, it, vi } from "vitest";
import { importPdfFile, loadGroups, loadPapers, saveGroups, savePapers } from "../../src/services/library";
import { DEFAULT_GROUP_ID, removePaper, updatePaperMetadata, type PaperRecord } from "../../src/domain/library";

const basePaper: PaperRecord = {
  id: "base",
  title: "Same name",
  authors: [],
  year: null,
  sourcePath: "local://paper.pdf:100:1",
  importedAt: "2026-09-29T08:00:00.000Z",
  groupId: DEFAULT_GROUP_ID,
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
  it("migrates legacy tags into one group and writes the new schema", () => {
    window.localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([{
      ...basePaper,
      groupId: undefined,
      tags: ["  研究方法  ", "不再作为第二归属"],
    }]));

    expect(loadGroups().map((group) => group.name)).toEqual(["待整理", "研究方法"]);
    expect(loadPapers()[0]).toMatchObject({ groupId: "group-研究方法" });
    expect(loadPapers()[0]).not.toHaveProperty("tags");
  });

  it("puts papers without a legacy group into the default group", () => {
    window.localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([{
      ...basePaper,
      groupId: undefined,
    }]));

    expect(loadPapers()[0].groupId).toBe(DEFAULT_GROUP_ID);
  });

  it("persists user-created groups independently from papers", () => {
    saveGroups([{ id: DEFAULT_GROUP_ID, name: "待整理", createdAt: "" }, { id: "group-ai", name: "AI 论文", createdAt: "2026-10-16" }]);
    expect(loadGroups()).toEqual([
      { id: DEFAULT_GROUP_ID, name: "待整理", createdAt: "" },
      { id: "group-ai", name: "AI 论文", createdAt: "2026-10-16" },
    ]);
  });

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
      groupId: "group-transformer",
    })[0];

    expect(updated).toMatchObject({
      id: basePaper.id,
      sourcePath: basePaper.sourcePath,
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani"],
      year: 2017,
      groupId: "group-transformer",
    });
  });

  it("removes exactly one paper from the library", () => {
    const second = { ...basePaper, id: "second" };
    expect(removePaper([basePaper, second], basePaper.id)).toEqual([second]);
  });
});
