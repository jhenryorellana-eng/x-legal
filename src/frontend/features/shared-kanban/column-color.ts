/**
 * Kanban column color tokens (DOC-47 §2.2).
 *
 * Single source of truth for the design-system color tokens a kanban column can
 * use, and the token→CSS-var mapping. Shared by every board (leads / cases /
 * collections) so the swatch palette and the rendered dot never drift.
 */

/** Maps a color token to a CSS value. Unknown tokens (e.g. a raw hex from a
 *  mock) pass through unchanged so callers can also hand it a literal color. */
export const COLOR_TOKEN: Record<string, string> = {
  accent: "var(--accent)",
  navy: "var(--brand-navy, #1B2B5E)",
  gold: "var(--brand-gold, #FFC629)",
  purple: "#7C3AED",
  green: "var(--green)",
  red: "var(--red)",
};

export function tokenToVar(token: string): string {
  return COLOR_TOKEN[token] ?? token;
}

/** The tokens offered in the column create/edit color picker. */
export const COLOR_SWATCHES = ["accent", "navy", "gold", "green", "red", "purple"] as const;
