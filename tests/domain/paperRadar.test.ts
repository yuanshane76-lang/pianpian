import { describe, expect, it } from "vitest";
import {
  buildRadarCacheKey,
  candidateIdentity,
  formatRadarAuthors,
  libraryIdentities,
  normalizeDoi,
  normalizeRadarCandidate,
  normalizeTitle,
  seedIdentities,
  selectRadarCandidates,
} from "../../src/domain/paperRadar";

const seed = { title: "3D Gaussian Splatting for Real-Time Radiance Field Rendering", doi: "10.1145/3592433" };

function candidate(title: string, extra: Record<string, unknown> = {}) {
  return { title, authors: ["A. Author"], year: 2026, source: "Semantic Scholar", ...extra };
}

describe("paper radar domain rules", () => {
  it("normalizes DOI prefixes and case", () => {
    expect(normalizeDoi("https://doi.org/10.1145/3592433")).toBe("10.1145/3592433");
    expect(normalizeDoi("http://dx.doi.org/10.1145/3592433")).toBe("10.1145/3592433");
    expect(normalizeDoi("DOI: 10.1145/3592433")).toBe("10.1145/3592433");
    expect(normalizeDoi("10.1145/ABC")).toBe("10.1145/abc");
    expect(normalizeDoi(undefined)).toBe("");
  });

  it("normalizes titles for identity comparison", () => {
    expect(normalizeTitle("3D Gaussian Splatting!")).toBe("3d gaussian splatting");
    expect(normalizeTitle("  3D   Gaussian   Splatting  ")).toBe("3d gaussian splatting");
  });

  it("prefers DOI over title when building an identity", () => {
    expect(candidateIdentity("10.1/x", "Anything")).toBe("doi:10.1/x");
    expect(candidateIdentity(undefined, "Some Paper")).toBe("title:some paper");
  });

  it("rejects candidates without a usable title", () => {
    expect(normalizeRadarCandidate(null)).toBeNull();
    expect(normalizeRadarCandidate({ title: "   " })).toBeNull();
    expect(normalizeRadarCandidate({ title: "Valid", citationCount: -3 })?.citationCount).toBeUndefined();
    expect(normalizeRadarCandidate({ title: "Valid", url: "javascript:alert(1)" })?.url).toBeUndefined();
  });

  it("keeps only the first year that is a plausible publication year", () => {
    expect(normalizeRadarCandidate(candidate("P", { year: "2026" }))?.year).toBe(2026);
    expect(normalizeRadarCandidate(candidate("P", { year: 12 }))?.year).toBeNull();
    expect(normalizeRadarCandidate(candidate("P", { year: 9000 }))?.year).toBeNull();
  });

  it("excludes the seed paper and papers already in the library", () => {
    const result = selectRadarCandidates({
      candidates: [
        candidate("3D Gaussian Splatting for Real-Time Radiance Field Rendering", { doi: "10.1145/3592433" }),
        candidate("Already Owned"),
        candidate("Brand New Work", { doi: "10.1/new" }),
      ],
      seed,
      known: [{ title: "Already Owned" }],
    });
    expect(result.map((item) => item.title)).toEqual(["Brand New Work"]);
  });

  it("merges duplicates and keeps the entry with more evidence", () => {
    const result = selectRadarCandidates({
      candidates: [
        candidate("Same Paper", { doi: "10.1/dup" }),
        candidate("Same Paper", { doi: "10.1/dup", abstract: "has abstract" }),
      ],
      seed,
    });
    expect(result).toHaveLength(1);
    expect(result[0].abstract).toBe("has abstract");
  });

  it("preserves the source relevance order and honors the limit", () => {
    const result = selectRadarCandidates({
      candidates: [candidate("First"), candidate("Second"), candidate("Third")],
      seed,
      limit: 2,
    });
    expect(result.map((item) => item.title)).toEqual(["First", "Second"]);
  });

  it("builds a stable cache key anchored on the DOI", () => {
    const key = buildRadarCacheKey("Semantic Scholar", seed);
    expect(key).toContain("10.1145/3592433");
    expect(key).toBe(buildRadarCacheKey("Semantic Scholar", { ...seed, title: "different title" }));
    expect(buildRadarCacheKey("Semantic Scholar", { title: "No DOI Here" })).toContain("title:no doi here");
  });

  it("collects identities from both papers and seeds", () => {
    expect(seedIdentities(seed).sort()).toEqual([
      "doi:10.1145/3592433",
      "title:3d gaussian splatting for real time radiance field rendering",
    ]);
    expect(libraryIdentities([{ title: "Owned", doi: "https://doi.org/10.9/own" }]).sort()).toEqual([
      "doi:10.9/own",
      "title:owned",
    ]);
  });

  it("formats author lists without overflowing the panel", () => {
    expect(formatRadarAuthors([])).toBe("作者未知");
    expect(formatRadarAuthors(["A", "B"])).toBe("A、B");
    expect(formatRadarAuthors(["A", "B", "C", "D", "E"])).toBe("A、B、C 等 5 人");
  });
});
