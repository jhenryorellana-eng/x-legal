/**
 * Dashboard ViewModel shapes — what the chart/list primitives consume.
 * Pages map backend DTOs → these (formatting + colour assignment) before render.
 */

/** One labelled slice (cases by status, leads by source, etc.). */
export interface BreakdownItem {
  name: string;
  value: number;
  /** Optional brand-token colour; defaults to the palette cycle. */
  color?: string;
  /** Optional drill-down link. */
  href?: string;
}

/** One row of a multi-series time-series chart. xKey + arbitrary series keys. */
export type SeriesRow = Record<string, string | number>;

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
}

export interface FunnelStageVM {
  label: string;
  count: number;
  /** % of the funnel's first stage (0–100). */
  pct: number;
  /** Drop from the previous stage, e.g. "-29%" — null for the first stage. */
  drop: string | null;
}
