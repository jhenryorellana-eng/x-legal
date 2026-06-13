/**
 * Kanban module — public API (module-pub boundary).
 *
 * Other modules MUST import from here, never from service.ts / repository.ts directly.
 * Rule R3: no cross-module imports except via index.ts.
 *
 * DOC-47 §1 (module responsibilities), DOC-48 §3.11 (API-KAN-* and API-LEAD-*).
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
} from "./service";

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
