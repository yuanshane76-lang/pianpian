import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isAllowedExternalUrl } = require("../../electron/external-links.cjs") as {
  isAllowedExternalUrl: (value: string) => boolean;
};

describe("external link allowlist", () => {
  it("allows the DOI and Semantic Scholar destinations used by paper radar", () => {
    expect(isAllowedExternalUrl("https://doi.org/10.1234/example")).toBe(true);
    expect(isAllowedExternalUrl("https://www.semanticscholar.org/paper/example")).toBe(true);
    expect(isAllowedExternalUrl("https://semanticscholar.org/paper/example")).toBe(true);
  });

  it("rejects lookalike hosts, credentials and non-HTTPS URLs", () => {
    expect(isAllowedExternalUrl("https://doi.org.attacker.example/paper")).toBe(false);
    expect(isAllowedExternalUrl("https://doi.org@attacker.example/paper")).toBe(false);
    expect(isAllowedExternalUrl("http://doi.org/10.1234/example")).toBe(false);
    expect(isAllowedExternalUrl("https://user:pass@doi.org/10.1234/example")).toBe(false);
    expect(isAllowedExternalUrl("not a URL")).toBe(false);
  });
});
