/**
 * Analytics module — public API (module-pub boundary).
 *
 * Read-model for the staff dashboards. Every export gates on can(actor,
 * 'metrics','view') and only reads (aggregation in Postgres). The admin RSC
 * composes getAdminOverview with other module-pub reads (e.g. billing) in
 * parallel. Sales/Legal/Finance dashboards land in their respective etapas.
 */
export { getAdminOverview, getSalesToday, getLegalDashboard, getFinanceDashboard } from "./service";

export type {
  AdminOverview,
  SalesToday,
  LegalDashboard,
  FinanceDashboard,
  DashboardInput,
  ScalarKpi,
  Breakdown,
  TimeSeriesPoint,
  LeadFunnel,
  HandoffCell,
} from "./types";
