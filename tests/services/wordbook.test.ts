import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWordbook, saveWordbook } from "../../src/services/wordbook";

afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); });

describe("wordbook persistence", () => {
  it("starts empty and reports corrupted saved data instead of silently overwriting it", () => {
    expect(loadWordbook()).toEqual({ entries: [], error: null });
    window.localStorage.setItem("zhiyan-workbench.wordbook.v1", "broken");
    expect(loadWordbook().error).toContain("读取");
    expect(window.localStorage.getItem("zhiyan-workbench.wordbook.v1")).toBe("broken");
  });
  it("reports storage failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(saveWordbook([])).toBe(false);
  });
});
