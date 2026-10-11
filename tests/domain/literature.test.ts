import { describe, expect, it } from "vitest";
import { addLiteraturePaper } from "../../src/domain/literature";

describe("literature library entries", () => {
  it("stores a reference without pretending it has a local PDF and deduplicates DOI", () => {
    const first = addLiteraturePaper([], { title: "Paper", authors: [], year: 2025, doi: "10.1234/PAPER" });
    expect(first.papers[0]).toMatchObject({ recordType: "reference", blocks: 0, doi: "10.1234/paper" });
    const repeated = addLiteraturePaper(first.papers, { title: "Renamed", authors: [], year: 2025, doi: "https://doi.org/10.1234/paper" });
    expect(repeated.duplicate).toBe(true);
    expect(repeated.papers).toHaveLength(1);
    expect(addLiteraturePaper(first.papers, { title: "Another title", authors: [], year: 2025, landingUrl: "https://doi.org/10.1234/paper" }).duplicate).toBe(true);
  });
});
