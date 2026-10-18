import { describe, expect, it } from "vitest";
import { addLiteraturePaper, upgradeLiteraturePaperWithPdf } from "../../src/domain/literature";

describe("literature library entries", () => {
  it("stores a reference without pretending it has a local PDF and deduplicates DOI", () => {
    const first = addLiteraturePaper([], { title: "Paper", authors: [], year: 2025, doi: "10.1234/PAPER" });
    expect(first.papers[0]).toMatchObject({ recordType: "reference", blocks: 0, doi: "10.1234/paper" });
    const repeated = addLiteraturePaper(first.papers, { title: "Renamed", authors: [], year: 2025, doi: "https://doi.org/10.1234/paper" });
    expect(repeated.duplicate).toBe(true);
    expect(repeated.papers).toHaveLength(1);
    expect(addLiteraturePaper(first.papers, { title: "Another title", authors: [], year: 2025, landingUrl: "https://doi.org/10.1234/paper" }).duplicate).toBe(true);
  });

  it("upgrades a matching reference in place and preserves its user-owned fields", () => {
    const reference = addLiteraturePaper([], {
      title: "Attention Is All You Need", authors: ["Ashish Vaswani"], year: 2017,
      arxivId: "1706.03762v7", landingUrl: "https://arxiv.org/abs/1706.03762v7",
    }).papers[0];
    const existing = { ...reference, groupId: "group-reading", favorite: true, readingPosition: { mode: "pdf" as const, page: 3 } };
    const prepared = {
      ...existing, id: "document-hash", originalId: "document-hash", sourcePath: "local://document-hash",
      recordType: undefined, parseStatus: "pending" as const, blocks: 0, blockData: [], pageCount: 11,
    };

    const result = upgradeLiteraturePaperWithPdf([existing], {
      title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer"],
      year: 2017, arxivId: "1706.03762v7", landingUrl: "https://arxiv.org/abs/1706.03762v7",
      abstract: "A verified abstract.", source: "arXiv",
    }, prepared);

    expect(result.papers).toHaveLength(1);
    expect(result.id).toBe(reference.id);
    expect(result.duplicate).toBe(false);
    expect(result.papers[0]).toMatchObject({
      id: reference.id,
      originalId: "document-hash",
      groupId: "group-reading",
      favorite: true,
      readingPosition: { mode: "pdf", page: 3 },
      arxivId: "1706.03762v7",
      abstract: "A verified abstract.",
    });
    expect(result.papers[0].recordType).toBeUndefined();
  });

  it("reuses an already imported matching PDF and attaches verified arXiv metadata", () => {
    const existingPdf = {
      id: "existing-id", originalId: "existing-document", title: "Old title", authors: [], year: null,
      sourcePath: "local://existing-document", importedAt: "2026-01-01", groupId: "group-reading",
      favorite: true, blocks: 2, blockData: [], parseStatus: "pending" as const,
    };
    const result = upgradeLiteraturePaperWithPdf([existingPdf], {
      title: "Verified title", authors: ["Author"], year: 2024, arxivId: "2401.01234v2",
      landingUrl: "https://arxiv.org/abs/2401.01234v2", abstract: "Verified abstract.",
    }, existingPdf);

    expect(result).toMatchObject({ id: "existing-id", duplicate: true });
    expect(result.papers).toHaveLength(1);
    expect(result.papers[0]).toMatchObject({
      originalId: "existing-document", title: "Verified title", authors: ["Author"], year: 2024,
      arxivId: "2401.01234v2", abstract: "Verified abstract.", groupId: "group-reading", favorite: true,
    });
  });

  it("keeps different PDF versions without relabeling the old original", () => {
    const old = {
      id: "old-paper", originalId: "hash-v1", title: "Attention Is All You Need", arxivId: "1706.03762v1",
      authors: [], year: 2017, sourcePath: "local://hash-v1", importedAt: "2026-01-01",
      groupId: "group-reading", favorite: true, blocks: 0, blockData: [],
    };
    const prepared = { ...old, id: "hash-v7", originalId: "hash-v7", sourcePath: "local://hash-v7", arxivId: undefined };
    const result = upgradeLiteraturePaperWithPdf([old], {
      title: old.title, authors: [], year: 2017, arxivId: "1706.03762v7",
    }, prepared);
    expect(result).toMatchObject({ id: "hash-v7", duplicate: false });
    expect(result.papers).toHaveLength(2);
    expect(result.papers.find((item) => item.id === old.id)).toEqual(old);
    expect(result.papers.find((item) => item.id === "hash-v7")).toMatchObject({ originalId: "hash-v7", arxivId: "1706.03762v7" });
  });

  it("preserves the existing PDF identity and user fields when a matching reference also exists", () => {
    const reference = addLiteraturePaper([], { title: "Paper", authors: [], year: 2024 }).papers[0];
    const existing = {
      id: "stable-pdf-id", originalId: "document-hash", title: "Paper", authors: [], year: 2024,
      sourcePath: "local://document-hash", importedAt: "2026-01-01", groupId: "custom-group",
      favorite: true, blocks: 1, blockData: [],
    };
    const result = upgradeLiteraturePaperWithPdf([reference, existing], {
      title: "Paper", authors: ["Verified"], year: 2024, arxivId: "2401.01234v1",
    }, existing);
    expect(result).toMatchObject({ id: "stable-pdf-id", duplicate: true });
    expect(result.papers).toHaveLength(1);
    expect(result.papers[0]).toMatchObject({
      id: "stable-pdf-id", originalId: "document-hash", groupId: "custom-group", favorite: true, authors: ["Verified"],
    });
  });
});
