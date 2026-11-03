import { useState } from "react";

/** Light, Dark, or follow the device ("system"). Remembered on this device only. */
export type Theme = "system" | "light" | "dark";
const KEY = "ss.theme";

export function getTheme(): Theme {
  try { const t = localStorage.getItem(KEY); return t === "light" || t === "dark" ? t : "system"; } catch { return "system"; }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme; else root.dataset.theme = t;
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const setTheme = (t: Theme) => {
    setThemeState(t);
    try { if (t === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* private mode */ }
    applyTheme(t);
  };
  return [theme, setTheme];
}
