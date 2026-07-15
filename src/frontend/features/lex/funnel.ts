/**
 * Biggest funnel leak — shared pure helper.
 *
 * The largest drop between consecutive funnel stages, computed from real counts.
 * Used by both the admin Lex rule (3-stage lead funnel) and the sales métricas
 * page (6-stage funnel) so the "where do we leak?" logic lives in ONE place
 * instead of drifting between two implementations. Returns null when there is
 * no top-of-funnel volume or no stage actually loses volume.
 */

export interface FunnelStageCount {
  label: string;
  count: number;
}

export interface FunnelLeak {
  from: string;
  to: string;
  /** Percentage drop from `from` to `to` (positive integer). */
  drop: number;
}

export function biggestFunnelLeak(stages: FunnelStageCount[]): FunnelLeak | null {
  if (stages.length < 2 || stages[0].count <= 0) return null;
  let best: FunnelLeak | null = null;
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].count;
    const cur = stages[i].count;
    const drop = prev > 0 ? Math.round(((prev - cur) / prev) * 100) : 0;
    if (drop > 0 && (!best || drop > best.drop)) {
      best = { from: stages[i - 1].label, to: stages[i].label, drop };
    }
  }
  return best;
}
