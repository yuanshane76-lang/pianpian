import { DEFAULT_THEME, normalizeTheme, type ThemePreference } from "../domain/appearance";

const STORAGE_KEY = "zhiyan-workbench.appearance.v1";

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadTheme(): ThemePreference {
  const storage = getStorage();
  if (!storage) return DEFAULT_THEME;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw) as { theme?: unknown } | null;
    return normalizeTheme(parsed?.theme);
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme: ThemePreference): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ theme: normalizeTheme(theme) }));
    return true;
  } catch {
    return false;
  }
}

export function applyTheme(theme: ThemePreference): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = normalizeTheme(theme);
}
