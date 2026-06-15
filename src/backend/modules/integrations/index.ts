/**
 * Integrations module — public API (module-pub boundary).
 *
 * Other modules MUST import from here, never from service.ts / repository.ts directly.
 * Rule R3: no cross-module imports except via index.ts.
 *
 * @module integrations
 */

// ---------------------------------------------------------------------------
// Use cases (service layer)
// ---------------------------------------------------------------------------

export {
  sendToLawyer,
  processVerdictWebhook,
  applyVerdict,
  reconcileFromPolling,
  getValidationsForCase,
  listValidationsAdmin,
  // Error class
  IntegrationsError,
} from "./service";

// Polling candidate list (used by retry-abogados-polling cron — boundary R3)
export { listPollingCandidates } from "./repository";

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export type {
  SendToLawyerInput,
  LegalValidationRow,
  LegalValidationWithOrg,
  ListValidationsFilters,
} from "./service";

// ---------------------------------------------------------------------------
// Domain types (Zod schemas, pure functions)
// ---------------------------------------------------------------------------

export {
  buildClientLabel,
  serializeAutomatedForm,
  buildAnnexIndex,
  LEGAL_VALIDATION_ACTIVE_STATUSES,
  LEGAL_VALIDATION_STATUSES,
  AbogadosPostPayloadSchema,
  AbogadosPostResponseSchema,
  AbogadosVerdictWebhookSchema,
  AbogadosPollingResponseSchema,
  AbogadosDocumentSchema,
} from "./domain";

export type {
  LegalValidationStatus,
  LegalValidationActiveStatus,
  AbogadosPostPayload,
  AbogadosPostResponse,
  AbogadosVerdictWebhook,
  AbogadosPollingResponse,
  AbogadosDocument,
  AbogadosFinding,
  SerializeFormInput,
  SerializeFormGroup,
  SerializeFormQuestion,
  AnnexIndexItem,
} from "./domain";

// ---------------------------------------------------------------------------
// Event types and emitters
// ---------------------------------------------------------------------------

export type {
  IntegrationsEvent,
  ValidationSentPayload,
  ValidationVerdictReceivedPayload,
} from "./events";

export {
  emitValidationSent,
  emitVerdictReceived,
  registerIntegrationsConsumers,
} from "./events";
