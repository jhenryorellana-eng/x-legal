/**
 * Catalog module — public API (module-pub boundary).
 *
 * Exposes ONLY the runtime read functions that other modules need.
 * Editor mutations live in actions.ts (server actions, admin panel only).
 *
 * DOC-40 §6.3.
 */

// Runtime resolution (consumed by: cases, contracts, ai-engine)
export {
  // Procedural posture (Wave 2 — consumed by cases on extraction.completed)
  resolvePostureForService,
  getPostureBySlug,
  getCaseRequirements,
  getPublicCatalog,
  getServiceDetailBySlug,
  getPublishedAutomationVersion,
  getAutomationVersionById,
  listContractableServices,
  listContractableServicePlans,
  // Expediente assembly guide runtime read (consumed by expediente.autoAssembleWithAi)
  getServiceAssemblyGuidance,
  listServicePartyRoles,
  getCatalogFirstPhase,
  getCatalogFirstMilestone,
  isServiceContractable,
  // Per-service certified-translation signing config (consumed by ai-engine job)
  getServiceTranslationConfig,
  // Form runtime reads (consumed by cases/form-runtime — API-CASE-16 through API-CASE-19)
  listQuestionGroups,
  listQuestions,
  listFormDefinitions,
  // Admin panel reads (DOC-53 §4 — page-initial RSC reads)
  listServicesAdmin,
  getServiceEditorTree,
  // Service party-role config (DOC-41 — admin catalog editor)
  createServicePartyRole,
  updateServicePartyRole,
  deleteServicePartyRole,
  // Appointment schedule / cronograma (admin catalog editor)
  upsertAppointmentSchedule,
  // Cronograma runtime read (client-facing timeline source)
  getServiceCronograma,
  // Stage SLA — plazo por etapa (consumido por cases al activar/traspasar)
  getStageSlaDays,
  // Form editor + datasets reads (DOC-53 §5 / §6 — page-initial RSC reads)
  getFormEditorData,
  getVersionPdfUrl,
  listDatasetsAdmin,
  getDatasetDetail,
} from "./service";

// Admin read types (DOC-53 §4 / §5 / §6)
export type {
  AdminServiceSummary,
  ServiceEditorTree,
  ServiceEditorPhase,
  ServiceCronograma,
  ServiceCronogramaCita,
  FormEditorData,
  EditorVersionTree,
  FormEditorSourceOption,
  FormFillGuideView,
  DatasetSummary,
  DatasetDetail,
} from "./service";

// Types needed by other modules
export type {
  Service,
  ServicePlan,
  ServicePhase,
  Milestone,
  RequiredDocumentType,
  FormDefinition,
  AutomationVersion,
  DetectedField,
  QuestionGroup,
  Question,
  GenerationConfig,
  Dataset,
  DatasetItem,
  PublicationCheck,
  PublicationIssue,
  ExpandedRequirement,
  RequirementOverrideInput,
  ResolvedForm,
  ServicePartyRole,
  UpsertServicePartyRoleDto,
  ServiceAppointmentScheduleItem,
  UpsertAppointmentScheduleDto,
  StageSlaKey,
  StageSlaDays,
  StageSlaItem,
  UpsertStageSlasDto,
} from "./domain";

// Stage SLA — etapas con plazo (value export para el wizard admin)
export { STAGE_SLA_KEYS } from "./domain";

// Requirement visibility predicate (consumed by expediente assembly to drop
// hidden-requirement documents — same match rule as applyRequirementOverrides).
export { isRequirementHiddenFor } from "./domain";
