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
  getCaseRequirements,
  getPublicCatalog,
  getServiceDetailBySlug,
  getPublishedAutomationVersion,
  getAutomationVersionById,
  listContractableServices,
  isServiceContractable,
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
} from "./domain";
