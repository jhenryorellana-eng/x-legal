/**
 * Theme + text-scale helpers (DOC-01 §4, §8.5).
 * The active theme lives on <html data-theme> and the text scale on
 * <html data-text-scale>, both persisted to localStorage and applied before
 * hydration by an inline script (see THEME_INIT_SCRIPT) so there is no flash.
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

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return value === "dark" || value === "light" ? value : DEFAULT_THEME;
}

export function getStoredTextScale(): TextScale {
  if (typeof window === "undefined") return DEFAULT_TEXT_SCALE;
  const value = window.localStorage.getItem(TEXT_SCALE_STORAGE_KEY);
  return value === "sm" || value === "md" || value === "lg"
    ? value
    : DEFAULT_TEXT_SCALE;
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function applyTextScale(scale: TextScale): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-text-scale", scale);
  window.localStorage.setItem(TEXT_SCALE_STORAGE_KEY, scale);
}

export function toggleTheme(): Theme {
  const next: Theme = getStoredTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}

/**
 * Inline script injected before hydration to set data-theme / data-text-scale
 * from localStorage (with system-preference fallback for theme), preventing a
 * flash of the wrong theme. Kept dependency-free and minified-friendly.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='dark'&&t!=='light'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);var s=localStorage.getItem('${TEXT_SCALE_STORAGE_KEY}');if(s!=='sm'&&s!=='md'&&s!=='lg'){s='md';}document.documentElement.setAttribute('data-text-scale',s);}catch(e){document.documentElement.setAttribute('data-theme','light');document.documentElement.setAttribute('data-text-scale','md');}})();`;
