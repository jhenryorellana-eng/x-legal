/**
 * Resolve a catalog service colour to a CSS value.
 *
 * `services.color` is stored as a design token ("accent" | "navy" | "gold" |
 * "green" | "red" | "purple"), not raw CSS. Kanban cards use the value inside
 * `color-mix()`, so a bare token would produce invalid CSS — map it to its CSS
 * var here. Anything that already looks like a colour (hex / var() / rgb / hsl)
 * passes through untouched.
 */
const SERVICE_COLOR_VAR: Record<string, string> = {
  accent: "var(--accent)",
  navy: "var(--brand-navy, #1B2B5E)",
  gold: "var(--brand-gold, #FFC629)",
  green: "var(--green)",
  red: "var(--red)",
  purple: "var(--brand-purple, #7C3AED)",
};

export function resolveServiceColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("#") || raw.startsWith("var(") || raw.startsWith("rgb") || raw.startsWith("hsl")) {
    return raw;
  }
  return SERVICE_COLOR_VAR[raw] ?? null;
}
