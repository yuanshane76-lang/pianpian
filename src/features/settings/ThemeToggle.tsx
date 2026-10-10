import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { nextTheme, type ThemePreference } from "../../domain/appearance";
import { applyTheme, loadTheme, saveTheme } from "../../services/appearance";

interface Props {
  variant?: "icon" | "nav";
}

export function ThemeToggle({ variant = "nav" }: Props) {
  const [theme, setTheme] = useState<ThemePreference>(() => loadTheme());
  const dark = theme === "dark";
  const label = dark ? "切换为浅色模式" : "切换为深色模式";

  function toggle() {
    const next = nextTheme(theme);
    setTheme(next);
    applyTheme(next);
    saveTheme(next);
  }

  const icon = dark ? <Sun size={17} /> : <Moon size={17} />;

  if (variant === "icon") {
    return (
      <button type="button" className="icon-button" aria-label={label} title={label} onClick={toggle}>
        {icon}
      </button>
    );
  }

  return (
    <button type="button" className="nav-item" aria-label={label} title={label} onClick={toggle}>
      {icon}
      <span>{dark ? "浅色模式" : "深色模式"}</span>
    </button>
  );
}
