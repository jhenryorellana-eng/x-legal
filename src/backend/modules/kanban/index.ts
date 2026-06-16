/**
 * Kanban module — public API (module-pub boundary).
 *
 * Other modules MUST import from here, never from service.ts / repository.ts directly.
 * Rule R3: no cross-module imports except via index.ts.
 *
 * DOC-47 §1 (module responsibilities), DOC-48 §3.11 (API-KAN-* and API-LEAD-*).
 *
 * TODO(API-LEAD-08 / C-2): When the "Expresar interés" CTA is enabled from behind
 * the feature flag, the server action that calls expressServiceInterest() MUST apply
 * platform/ratelimit.limitExpressInterestIp(ip) as the FIRST check (60/min per IP,
 * fail-closed). The limiter is already defined and exported from platform/ratelimit.ts.
 * Do NOT call expressServiceInterest() from any public route without it.
 */

// Kanban use cases (API-KAN-01..12)
export {
  getBoard,
  moveCard,
  createColumn,
  updateColumn,
  reorderColumns,
  deleteColumn,
  updateCardNote,
  createTask,
  toggleTaskDone,
  updateTask,
  deleteTask,
  reorderTasks,
  listMyTasks,
  // Error class
  KanbanError,
} from "./service";

// Leads sub-module use cases (API-LEAD-01..08)
export {
  createLead,
  updateLead,
  markLeadWon,
  markLeadLost,
  createCaseFromLead,
  createLeadCategory,
  expressServiceInterest,
  listLeads,
} from "./service";

// Automatic card listener handlers (§3.8 — called from register-consumers.ts)
export {
  onCaseAssigned,
  onContractSigned,
  onDownpaymentConfirmedKanban,
  onExpedienteSentToFinance,
  // F6-Ola2
  onInstallmentOverdue,
  onExpedientePrinted,
} from "./service";

// GAP-2 — board backfill for paralegal kanban page (F5-Ola3)
export { backfillCasesBoard } from "./service";

// Sales metrics aggregations (DOC-52 §6.2, API-MET-01)
export { getSalesMetrics } from "./service";

// Input / output types
export type {
  GetBoardInput,
  BoardDto,
  MoveCardInput,
  CreateColumnInput,
  UpdateColumnInput,
  CreateLeadInput,
  CreateLeadResult,
  UpdateLeadInput,
  CreateLeadCategoryInput,
  CreateCaseFromLeadInput,
  ExpressServiceInterestInput,
  CreateTaskInput,
  UpdateTaskInput,
  // Metrics
  SalesMetricsInput,
  SalesMetricsResult,
  MetricsPeriod,
  FunnelCounts,
  WeekActivityBar,
  SourceMetric,
} from "./service";

// Domain types
export type {
  BoardKind,
  LeadStatus,
  ColumnColor,
  SeedColumn,
  LeadDuplicateCandidate,
  DuplicateCheckResult,
} from "./domain";

export {
  seedColumnsFor,
  findLeadDuplicates,
  isLeadPhoneShapeValid,
  validRefTypeForKind,
  moduleKeyForKind,
  COLOR_TOKENS,
} from "./domain";

// Repository row types (for cross-module reads)
export type {
  BoardRow,
  ColumnRow,
  CardRow,
  LeadRow,
  CategoryRow,
  TaskRow,
} from "./repository";

// Event types
export type {
  KanbanEvent,
  CardMovedEvent,
  LeadCreatedEvent,
  LeadWonEvent,
  LeadLostEvent,
} from "./events";
