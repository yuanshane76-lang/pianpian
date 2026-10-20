import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRelatedPapers } from "../../src/services/paperRadar";

afterEach(() => {
  delete window.zhiyan;
  vi.restoreAllMocks();
});

describe("paper radar service", () => {
  it("shares simultaneous desktop lookups for the same paper", async () => {
    let resolve: (value: unknown) => void = () => {};
    const invoke = vi.fn(() => new Promise((finish) => { resolve = finish; }));
    window.zhiyan = { invoke: invoke as never };

    const options = { paper: { title: "Seed Paper", doi: "10.1234/seed" } };
    const first = loadRelatedPapers(options);
    const second = loadRelatedPapers(options);

    expect(invoke).toHaveBeenCalledTimes(1);
    resolve({
      candidates: [{ title: "Related Paper", doi: "10.1234/related" }],
      source: "Semantic Scholar",
      fetchedAt: "2026-10-20T00:00:00.000Z",
    });

    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { candidates: [{ title: "Related Paper" }] },
      { candidates: [{ title: "Related Paper" }] },
    ]);
  });

  it("filters candidates already present in the supplied library", async () => {
    const invoke = vi.fn(async () => ({
      candidates: [
        { title: "Already Owned", doi: "10.1234/owned" },
        { title: "New Related Work", doi: "10.1234/new" },
      ],
      source: "Semantic Scholar",
      fetchedAt: "2026-10-20T00:00:00.000Z",
    }));
    window.zhiyan = { invoke: invoke as never };

    const result = await loadRelatedPapers({
      paper: { title: "Seed Paper", doi: "10.1234/seed" },
      library: [{ title: "Already Owned", doi: "10.1234/owned" }],
    });

    expect(result.candidates.map((candidate) => candidate.title)).toEqual(["New Related Work"]);
  });
});
