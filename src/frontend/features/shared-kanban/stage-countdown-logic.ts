/**
 * Stage countdown — pure logic (no React), so the tier boundaries are unit-testable.
 * The presentational badge lives in stage-countdown.tsx and imports from here.
 *
 * Tier by días restantes (resuelve el solape 1/7 del pedido):
 *   - rojo   (hot / overdue):  d ≤ 1 o vencido
 *   - ámbar  (warn):           1 < d < 7
 *   - neutro (normal):         d ≥ 7
 */

export type CountdownTier = "normal" | "warn" | "hot" | "overdue";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Días restantes hasta `dueAtMs` (ceil: quedan "N días" hasta cruzar a N-1).
 * Negativo = vencido.
 */
export function daysUntil(dueAtMs: number, nowMs: number): number {
  return Math.ceil((dueAtMs - nowMs) / MS_PER_DAY);
}

/**
 * Tier de color por días restantes. `days <= 0` = vencido (deadline alcanzado o
 * pasado) — el `<= 0` es deliberado: `daysUntil` usa `Math.ceil`, que devuelve `-0`
 * para 0–24h de atraso, y `-0 < 0` es `false` en JS, así que un `< 0` marcaría ese
 * primer día como "hot"/"Vence hoy" en vez de "Vencido".
 */
export function countdownTier(days: number): CountdownTier {
  if (days <= 0) return "overdue";
  if (days <= 1) return "hot";
  if (days < 7) return "warn";
  return "normal";
}

export const TIER_COLOR: Record<CountdownTier, string> = {
  normal: "var(--ink-3)",
  warn: "var(--gold-deep, #b5740b)",
  hot: "var(--red, #dc2626)",
  overdue: "var(--red, #dc2626)",
};

/** Etiqueta localizada de los días restantes (o "Vencido …" al vencerse). */
export function countdownLabel(days: number, tier: CountdownTier, locale: "es" | "en"): string {
  const es = locale === "es";
  if (tier === "overdue") {
    // days <= 0 aquí (Math.abs normaliza -0). late 0/1 → "Vencido"; -N → "hace N d".
    const late = Math.abs(days);
    if (late <= 1) return es ? "Vencido" : "Overdue";
    return es ? `Vencido · hace ${late} d` : `Overdue · ${late}d ago`;
  }
  if (days === 1) return es ? "1 día" : "1 day";
  return es ? `${days} días` : `${days} days`;
}
