/**
 * Dashboard primitives — shared KPI/chart building blocks for every staff
 * dashboard (admin, ventas, legal, finanzas). shadcn Charts (Recharts) for
 * time-series/bars; Tremor-style CSS lists for the cheap above-the-fold pieces.
 */
export { KpiCard, type KpiCardProps } from "./kpi-card";
export { DeltaBadge } from "./delta-badge";
export { DateRangeFilter, type DateRangeLabels } from "./date-range-filter";
export { BarBreakdown } from "./bar-breakdown";
export { AreaTrend } from "./area-trend";
export { Funnel } from "./funnel";
export { BarList } from "./bar-list";

export {
  EM_DASH,
  fmtMoneyCents,
  fmtUsd,
  fmtNum,
  fmtPct,
  chartColor,
  CHART_COLORS,
  delta,
  type Delta,
} from "./format";

export type { BreakdownItem, SeriesRow, SeriesSpec, FunnelStageVM } from "./types";
