import { beforeEach, describe, expect, it } from "vitest";
import { nextTheme, normalizeTheme } from "../../src/domain/appearance";
import { applyTheme, loadTheme, saveTheme } from "../../src/services/appearance";

const STORAGE_KEY = "zhiyan-workbench.appearance.v1";

describe("appearance theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("normalizes unknown values to light", () => {
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("sepia")).toBe("light");
    expect(normalizeTheme(undefined)).toBe("light");
  });

  it("toggles between light and dark", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
  });

  it("persists and reloads the dark theme", () => {
    expect(loadTheme()).toBe("light");
    expect(saveTheme("dark")).toBe(true);
    expect(loadTheme()).toBe("dark");
  });

  it("falls back to light when stored data is corrupt", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadTheme()).toBe("light");
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "neon" }));
    expect(loadTheme()).toBe("light");
  });

  it("applies the theme to the document root", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
