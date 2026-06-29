/**
 * Dashboard formatters + chart palette.
 *
 * Rule (DOC-50 §5): a genuinely-unknown value renders as "—" (em-dash), never
 * a false 0. Money is stored in cents; charts use the brand palette tokens
 * (theme-aware via tokens.css) so every chart matches the product identity.
 */

export const EM_DASH = "—";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const NUM = new Intl.NumberFormat("es-US");

export function fmtMoneyCents(cents: number | null | undefined): string {
  return cents == null ? EM_DASH : USD.format(Math.round(cents / 100));
}

const USD2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/** Format a USD amount already in dollars (e.g. AI cost), 2 decimals. */
export function fmtUsd(n: number | null | undefined): string {
  return n == null ? EM_DASH : USD2.format(n);
}

export function fmtNum(n: number | null | undefined): string {
  return n == null ? EM_DASH : NUM.format(n);
}

export function fmtPct(n: number | null | undefined): string {
  return n == null ? EM_DASH : `${n}%`;
}

/** Brand chart palette (theme-aware tokens). Cycle for multi-series/breakdowns. */
export const CHART_COLORS = [
  "var(--accent)",
  "var(--brand-green)",
  "var(--gold)",
  "var(--purple)",
  "var(--brand-navy)",
  "var(--red)",
  "var(--ink-2)",
] as const;

export function chartColor(i: number): string {
  return CHART_COLORS[i % CHART_COLORS.length];
}

export interface Delta {
  dir: "up" | "down";
  label: string;
}

/**
 * Period-over-period delta. `null` when there's no baseline (prev null/0) or no
 * change. `fmt` formats the absolute magnitude (e.g. fmtNum, fmtMoneyCents).
 * `invert` flips the semantic colour for KPIs where lower is better (overdue).
 */
export function delta(
  value: number | null | undefined,
  prev: number | null | undefined,
  fmt: (n: number) => string = fmtNum,
  invert = false,
): Delta | undefined {
  if (value == null || prev == null || prev === 0) return undefined;
  const diff = value - prev;
  if (diff === 0) return undefined;
  const up = invert ? diff < 0 : diff > 0;
  return { dir: up ? "up" : "down", label: `${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))}` };
}
