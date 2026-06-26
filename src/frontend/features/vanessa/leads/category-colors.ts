/**
 * Lead-category color tokens (mirror of the backend design tokens accepted by
 * `lead_categories.color`). The DB stores the TOKEN ("red", "gold", …); the UI
 * renders an actual hex via {@link categoryColorHex}. Legacy/raw CSS values fall
 * back to themselves so old rows keep rendering.
 */

export const CATEGORY_COLOR_TOKENS = [
  "accent",
  "gold",
  "green",
  "red",
  "navy",
  "purple",
] as const;

export type CategoryColorToken = (typeof CATEGORY_COLOR_TOKENS)[number];

const HEX: Record<string, string> = {
  accent: "#5B8CFF",
  gold: "#E0A106",
  green: "#1F9D55",
  red: "#E5484D",
  navy: "#1E3A5F",
  purple: "#8B5CF6",
};

/** Maps a stored color token to a renderable hex; passes through unknown values. */
export function categoryColorHex(token: string): string {
  return HEX[token] ?? token;
}
