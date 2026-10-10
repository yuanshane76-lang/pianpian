export type ThemePreference = "light" | "dark";

export const DEFAULT_THEME: ThemePreference = "light";

export function normalizeTheme(value: unknown): ThemePreference {
  return value === "dark" ? "dark" : "light";
}

export function nextTheme(theme: ThemePreference): ThemePreference {
  return theme === "dark" ? "light" : "dark";
}
