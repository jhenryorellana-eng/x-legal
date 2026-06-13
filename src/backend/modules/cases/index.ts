/**
 * Cases module — public API (module-pub boundary).
 *
 * Other modules MUST import from here, never from service.ts / repository.ts directly.
 * Rule R3: no cross-module imports except via index.ts.
 */

// Use cases
export {
  createCaseFromContract,
  onDownpaymentConfirmed,
  startDocumentUpload,
  confirmDocumentUpload,
  reviewDocument,
  changeCaseStatus,
  getCasesForClient,
  getCaseOverview,
  getCaseRequirements,
  getCaseDocuments,
  getCaseDocumentDownloadUrl,
  listCasesAdmin,
  getTimeline,
  // Client-surface enriched reads (F2 — read-only DTOs, DOC-51)
  getCaseWorkspace,
  getDocumentsMatrix,
  getCaseMilestones,
  getClientDisplayName,
} from "./service";

// createCaseFromContract types
export type {
  CreateCaseFromContractInput,
  CreateCaseFromContractResult,
  CasePartyInput,
} from "./service";

// Client-surface read DTO types
export type {
  CaseWorkspaceDto,
  CaseWorkspaceParty,
  DocumentsMatrixDto,
  DocumentMatrixItem,
  CaseMilestonesDto,
  CaseMilestoneItem,
  I18nValue,
  AdminCaseListItem,
  AdminCasesPage,
} from "./service";

// Error class (used by route handlers / actions for HTTP mapping)
export { CaseError } from "./service";

// Domain types (consumed by catalog, billing, notifications for type narrowing)
export type {
  CaseStatus,
  CaseDocumentStatus,
  ContractStatus,
  StaffRole,
  TimelineEntryInput,
  I18nText,
} from "./domain";

export {
  canTransitionCase,
  canTransitionDocument,
  canTransitionContract,
  computePhaseProgress,
  PRODUCTION_STATUSES,
  CASE_TRANSITIONS,
} from "./domain";

// Event types
export type {
  CaseEvent,
  CaseCreatedEvent,
  CaseAssignedEvent,
  DocumentUploadedEvent,
  DocumentApprovedEvent,
  DocumentRejectedEvent,
  DownpaymentConfirmedEvent,
} from "./events";

// Repository types (for cross-module reads e.g. billing → cases)
export type { CaseRow, CaseDocumentRow, CasesPage } from "./repository";
