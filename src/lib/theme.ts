import type { Theme } from "./prefs";

const dark = () => window.matchMedia?.("(prefers-color-scheme: dark)");
export const resolveTheme = (theme: Theme): "light" | "dark" => (theme === "system" ? (dark()?.matches ? "dark" : "light") : theme);

/** Applied before first paint (main.tsx) and whenever the preference or OS appearance changes. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = resolveTheme(theme);
}

export function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem("tokenlens-theme");
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}
