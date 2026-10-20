import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createClient, MAX_RECOMMENDATIONS } = require("../../electron/semantic-scholar.cjs") as {
  createClient: (options?: {
    fetchImpl?: unknown;
    now?: () => number;
    sleepImpl?: (ms: number) => Promise<void>;
    readApiKey?: () => string;
  }) => {
    findRelatedPapers: (input: {
      seed: { title: string; doi?: string };
      limit?: number;
      signal?: AbortSignal;
    }) => Promise<{ seed: { paperId?: string; doi?: string }; candidates: unknown[]; cached: boolean }>;
  };
  MAX_RECOMMENDATIONS: number;
};

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  };
}

function harness(responses: Array<{ status: number; body: unknown }>, options: { apiKey?: string } = {}) {
  const urls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  let index = 0;
  const fetchImpl = vi.fn(async (url: string, init: { headers?: Record<string, string> } = {}) => {
    urls.push(String(url));
    headers.push(init.headers ?? {});
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return jsonResponse(next.status, next.body);
  });
  const client = createClient({
    fetchImpl,
    sleepImpl: async () => undefined,
    readApiKey: () => options.apiKey ?? "",
  });
  return { client, urls, headers, fetchImpl };
}

const RECOMMENDATION = {
  recommendedPapers: [
    {
      title: "SteadySplats: Resampling of Low-Variance Gaussians",
      year: 2026,
      venue: "CVPR",
      abstract: "A stochastic rendering method.",
      citationCount: 0,
      url: "https://www.semanticscholar.org/paper/abc",
      authors: [{ name: "A. Author" }, { name: "B. Author" }],
      externalIds: { DOI: "10.1/steady", ArXiv: "2610.05576" },
    },
  ],
};

describe("Semantic Scholar radar adapter", () => {
  it("queries recommendations directly when the seed carries a DOI", async () => {
    const { client, urls } = harness([{ status: 200, body: RECOMMENDATION }]);
    const result = await client.findRelatedPapers({
      seed: { title: "3D Gaussian Splatting", doi: "https://doi.org/10.1145/3592433" },
      limit: 20,
    });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/recommendations/v1/papers/forpaper/");
    expect(urls[0]).toContain("3592433");
    expect(urls[0]).toContain("limit=20");
    expect(result.candidates).toHaveLength(1);
    expect(result.cached).toBe(false);
  });

  it("never sends a non-allowlisted host", async () => {
    const { client, urls } = harness([{ status: 200, body: RECOMMENDATION }]);
    await client.findRelatedPapers({ seed: { title: "Anything", doi: "10.1/x" } });
    for (const url of urls) expect(new URL(url).hostname).toBe("api.semanticscholar.org");
  });

  it("falls back to a title search when the DOI has no external record", async () => {
    const { client, urls } = harness([
      { status: 404, body: {} },
      {
        status: 200,
        body: {
          data: [
            { paperId: "s2-123", title: "A Distinctive Radar Seed Paper", year: 2024, externalIds: { DOI: "10.1/seed" } },
            { paperId: "s2-999", title: "Something Unrelated Entirely", year: 2020, externalIds: {} },
          ],
        },
      },
      { status: 200, body: RECOMMENDATION },
    ]);
    const result = await client.findRelatedPapers({ seed: { title: "A Distinctive Radar Seed Paper", doi: "10.1/missing" } });
    expect(urls[1]).toContain("/graph/v1/paper/search");
    expect(urls[2]).toContain("s2-123");
    expect(result.seed.paperId).toBe("s2-123");
    expect(result.candidates).toHaveLength(1);
  });

  it("refuses a weak title match instead of guessing the wrong paper", async () => {
    const { client } = harness([
      {
        status: 200,
        body: { data: [{ paperId: "s2-000", title: "Completely Different Subject Matter", year: 2001 }] },
      },
    ]);
    await expect(client.findRelatedPapers({ seed: { title: "A Distinctive Radar Seed Paper" } }))
      .rejects.toThrow(/无法确认/);
  });

  it("retries rate limiting and then succeeds", async () => {
    const { client, fetchImpl } = harness([
      { status: 429, body: {} },
      { status: 200, body: RECOMMENDATION },
    ]);
    const result = await client.findRelatedPapers({ seed: { title: "Seed", doi: "10.1/y" } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.candidates).toHaveLength(1);
  });

  it("reports throttling in Chinese once retries are exhausted", async () => {
    const { client, fetchImpl } = harness([{ status: 429, body: {} }]);
    await expect(client.findRelatedPapers({ seed: { title: "Seed", doi: "10.1/z" } }))
      .rejects.toThrow(/限流/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("serves a repeated lookup from cache", async () => {
    const { client, fetchImpl } = harness([{ status: 200, body: RECOMMENDATION }]);
    const seed = { title: "Cached Seed", doi: "10.1/cached" };
    await client.findRelatedPapers({ seed });
    const second = await client.findRelatedPapers({ seed });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second.cached).toBe(true);
  });

  it("clamps an oversized limit and rejects an empty seed", async () => {
    const { client, urls } = harness([{ status: 200, body: RECOMMENDATION }]);
    await client.findRelatedPapers({ seed: { title: "Seed", doi: "10.1/big" }, limit: 5000 });
    expect(urls[0]).toContain(`limit=${MAX_RECOMMENDATIONS}`);
    await expect(client.findRelatedPapers({ seed: { title: "   " } })).rejects.toThrow(/无法检索相似工作/);
  });

  it("sends an API key only when one is configured", async () => {
    const anonymous = harness([{ status: 200, body: RECOMMENDATION }]);
    await anonymous.client.findRelatedPapers({ seed: { title: "Seed", doi: "10.1/anon" } });
    expect(anonymous.headers[0]["x-api-key"]).toBeUndefined();

    const keyed = harness([{ status: 200, body: RECOMMENDATION }], { apiKey: "s2-key" });
    await keyed.client.findRelatedPapers({ seed: { title: "Seed", doi: "10.1/keyed" } });
    expect(keyed.headers[0]["x-api-key"]).toBe("s2-key");
    expect(keyed.headers[0].Accept).toBe("application/json");
  });

  it("names an invalid key instead of reporting a generic failure", async () => {
    const { client, fetchImpl } = harness([{ status: 403, body: {} }], { apiKey: "bad-key" });
    await expect(client.findRelatedPapers({ seed: { title: "Seed", doi: "10.1/bad" } }))
      .rejects.toThrow(/密钥无效/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
