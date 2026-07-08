/**
 * Cases module — public API (module-pub boundary).
 *
 * Other modules MUST import from here, never from service.ts / repository.ts directly.
 * Rule R3: no cross-module imports except via index.ts.
 */

// Use cases
export {
  createCaseFromContract,
  listCaseSummariesForClient,
  updateCaseParty,
  onDownpaymentConfirmed,
  startDocumentUpload,
  confirmDocumentUpload,
  deleteCaseDocument,
  renameCaseDocument,
  reviewDocument,
  setRequirementVisibility,
  changeCaseStatus,
  advanceCasePhase,
  advanceCaseMilestone,
  getCaseProgressTimeline,
  getCasesForClient,
  getCaseOverview,
  getCaseRequirements,
  getCaseDocuments,
  getCaseDocumentDownloadUrl,
  getCaseDocumentBytes,
  getDocumentExtractionStatus,
  listCasesAdmin,
  searchBookableCases,
  getTimeline,
  // Client-surface enriched reads (F2 — read-only DTOs, DOC-51)
  getCaseWorkspace,
  getCaseTimeline,
  getDocumentsMatrix,
  getCaseMilestones,
  getClientDisplayName,
  // F4-Ola3: form runtime (API-CASE-16 through API-CASE-19)
  getFormForClient,
  getClientFormsForCase,
  saveFormDraft,
  staffUpdateFormAnswers,
  submitFormResponse,
  approveFormResponse,
  rejectFormResponse,
  generateFilledPdf,
  getFormResponsePdfUrl,
  resolveBySource,
  // Staff reads
  getCaseExtractions,
  getCaseFormResponsesForStaff,
  getPriorPhaseMaterials,
  // GAP reads — kanban board support (F5-Ola3)
  listCasesByOwner,
  getCaseBoardAlerts,
  // Case ownership stage — responsable / etapa (eje propio)
  getCaseStageInfo,
  transferCase,
  assignCaseOwner,
  getCaseStageHistory,
  setDocumentTranslationNotRequired,
  // Event consumers (service-role — no actor session)
  transitionCaseSystem,
  onExpedienteSentToFinanceCase,
  onExpedientePrintedCase,
  // Timeline projection for scheduling events (DOC-41 §3.14)
  appendAppointmentTimeline,
} from "./service";

// Timeline projection types
export type { AppointmentTimelineEventType } from "./service";

// Bookable-case search (staff "Nueva cita")
export type { BookableCaseResult } from "./service";

// createCaseFromContract types
export type {
  CreateCaseFromContractInput,
  CreateCaseFromContractResult,
  // RF-VAN-019 duplicate-service notice ("Nuevo caso" modal)
  ClientCaseSummary,
  CasePartyInput,
  UpdateCasePartyInput,
  SetRequirementVisibilityInput,
  AdvanceCasePhaseInput,
  AdvanceCasePhaseResult,
  AdvanceCaseMilestoneInput,
  AdvanceCaseMilestoneResult,
  CaseProgressTimelineDto,
  ProgressTimelineItem,
  // F4-Ola3 form types
  SaveFormDraftInput,
  SubmitFormResponseInput,
  ApproveFormResponseInput,
  GenerateFilledPdfInput,
  FormForClientDto,
  FormGroupDto,
  FormQuestionDto,
  ClientFormListItem,
  StaffFormResponseItem,
  DocumentExtractionSummary,
  // Prior-phase materials (Etapa C)
  PriorPhaseGroup,
  PriorPhaseDoc,
  PriorPhaseForm,
} from "./service";

// Client-surface read DTO types
export type {
  CaseWorkspaceDto,
  CaseWorkspaceParty,
  CaseTimelineDto,
  CaseTimelineCita,
  DocumentsMatrixDto,
  DocumentMatrixItem,
  CaseMilestonesDto,
  CaseMilestoneItem,
  I18nValue,
  AdminCaseListItem,
  AdminCasesPage,
  // GAP-3 — kanban board alert shape
  CaseBoardAlert,
  // Case ownership stage DTOs
  CaseStageInfoDto,
  StageChecklistItemDto,
  StageOwnerOption,
  TransferCaseInput,
  AssignCaseOwnerInput,
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
  CaseStage,
  StageChecklist,
  StageChecklistItem,
  StageChecklistSignals,
} from "./domain";

export {
  canTransitionCase,
  canTransitionDocument,
  canTransitionContract,
  computePhaseProgress,
  buildPartiesSnapshot,
  PRODUCTION_STATUSES,
  CASE_TRANSITIONS,
  computeStageChecklist,
  canTransferStage,
  nextStage,
  STAGE_ORDER,
  STAGE_MODULE,
} from "./domain";

export type { SnapshotParty, PartiesSnapshotShape } from "./domain";

// Event types
export type {
  CaseEvent,
  CaseCreatedEvent,
  CaseOwnerChangedEvent,
  DocumentUploadedEvent,
  DocumentApprovedEvent,
  DocumentRejectedEvent,
  DownpaymentConfirmedEvent,
} from "./events";

// Repository types (for cross-module reads e.g. billing → cases)
export type { CaseRow, CaseDocumentRow, CaseFormResponseRow, CasesPage } from "./repository";

// Domain types for form state machine
export type { FormResponseStatus, QuestionValidationRule, AnswerValidationError } from "./domain";
export { canTransitionFormResponse, validateAnswerTypes } from "./domain";
