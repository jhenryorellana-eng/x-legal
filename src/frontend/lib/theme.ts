/**
 * Theme + text-scale helpers (DOC-01 §4, §8.5).
 *
 * The active theme lives on <html data-theme> and the text scale on
 * <html data-text-scale>. Both are rendered SERVER-SIDE from the user's
 * `users.theme` / `users.text_scale` (per-user, independent per role), so a
 * logged-in user always sees their own appearance with no flash. Changing a
 * value applies it to the DOM instantly and persists it via POST /api/ui-prefs;
 * localStorage is kept only as a same-device hint.
 */

export type Theme = "light" | "dark";
export type TextScale = "sm" | "md" | "lg";

export const THEME_STORAGE_KEY = "ulp-theme";
export const TEXT_SCALE_STORAGE_KEY = "ulp-text-scale";

export const DEFAULT_THEME: Theme = "light";
export const DEFAULT_TEXT_SCALE: TextScale = "md";

/** Root multipliers per scale — must match tokens.css. */
export const TEXT_SCALE_VALUES: Record<TextScale, number> = {
  sm: 0.92,
  md: 1,
  lg: 1.12,
};

/**
 * Reads the active theme — prefers the SSR-applied `<html data-theme>` (the
 * user's DB value) over localStorage so controls reflect the real per-user state.
 */
export function getStoredTheme(): Theme {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
    const ls = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (ls === "dark" || ls === "light") return ls;
  }
  return DEFAULT_THEME;
}

export function getStoredTextScale(): TextScale {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-text-scale");
    if (attr === "sm" || attr === "md" || attr === "lg") return attr;
    const ls = window.localStorage.getItem(TEXT_SCALE_STORAGE_KEY);
    if (ls === "sm" || ls === "md" || ls === "lg") return ls;
  }
  return DEFAULT_TEXT_SCALE;
}

/** Fire-and-forget persistence of the appearance to the current user's row. */
function persistUiPrefs(prefs: { theme?: Theme; textScale?: TextScale }): void {
  if (typeof fetch === "undefined") return;
  void fetch("/api/ui-prefs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
    keepalive: true,
  }).catch(() => {
    /* best-effort — the DOM already updated; the next load reconciles from DB */
  });
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode / storage disabled */
  }
  persistUiPrefs({ theme });
}

export function applyTextScale(scale: TextScale): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-text-scale", scale);
  try {
    window.localStorage.setItem(TEXT_SCALE_STORAGE_KEY, scale);
  } catch {
    /* private mode / storage disabled */
  }
  persistUiPrefs({ textScale: scale });
}

export function toggleTheme(): Theme {
  const next: Theme = getStoredTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}
