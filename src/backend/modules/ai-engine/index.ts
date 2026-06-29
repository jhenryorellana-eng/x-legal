/**
 * ai-engine module — public API (module-pub boundary).
 *
 * Other modules MUST import from here, never from service.ts / repository.ts directly.
 * Rule R3: no cross-module imports except via index.ts.
 *
 * DOC-42 §3 (service API surface).
 */

// ---------------------------------------------------------------------------
// Use cases (API-AI-01 through API-AI-10 + internal job entrypoints)
// ---------------------------------------------------------------------------

export {
  // User-facing
  startGeneration,
  cancelGeneration,
  regenerate,
  retryRunSameVersion,
  getRunsForCase,
  translateDocument,
  getDocumentTranslation,
  getDocumentTranslationPdf,
  translateText,
  translateAnswerText,
  // ai_field resolution (consumed by cases module — Etapa B)
  interpretDocumentFields,
  synthesizeLetterFields,
  assessDocumentLegibility,
  extractRawTextFromStorage,
  completeI18n,
  reprocessExtraction,
  getCostsSummary,
  // Catalog editor assistance (consumed by catalog module)
  proposeFormSegmentation,
  proposeQuestionnaireQuestions,
  proposeExtractionSchema,
  // Expediente assembly planner (consumed by expediente module)
  proposeExpedienteAssembly,
  // Job entrypoints (consumed by jobs/ layer)
  executeGenerationJob,
  executeExtractionJob,
  executeTranslationJob,
  // job-failed callbacks
  markRunFailedByCallback,
  markExtractionFailed,
  markTranslationFailed,
  // Budget (consumed by ai-budget-aggregation cron)
  sumMonthlyCosts,
  // Error class
  AiEngineError,
} from "./service";

export type {
  StartGenerationResult,
  JobOutcome,
  RunGenerationPayload,
  ExtractDocumentPayload,
  TranslateDocumentJobPayload,
  TranslateDocumentResult,
  // Catalog editor assistance (consumed by catalog module)
  ProposedQuestion,
  ProposedGroup,
  SegmentationProposal,
  AiFieldRequest,
  DocumentLegibilityVerdict,
  // Expediente assembly planner (consumed by expediente module)
  ExpedienteAssemblyInput,
  ExpedienteAssemblyPlan,
  ExpedienteAssemblySection,
  AssemblyPartyInput,
  AssemblyStrongDocInput,
  AssemblyDocInput,
} from "./service";

// ---------------------------------------------------------------------------
// Domain types (consumed by jobs, route handlers, actions)
// ---------------------------------------------------------------------------

export type {
  GenerationRunStatus,
  ConfigSnapshot,
  PromptAssembly,
  GenerationRequest,
  ExtractionResult,
  BudgetCheck,
  ChunkProgress,
} from "./domain";

// ---------------------------------------------------------------------------
// Repository row types (for typed responses in route handlers)
// ---------------------------------------------------------------------------

export type {
  GenerationRunRow,
  DocumentExtractionRow,
  DocumentTranslationRow,
} from "./repository";

// ---------------------------------------------------------------------------
// Event types (consumed by notifications / audit modules)
// ---------------------------------------------------------------------------

export type {
  GenerationCompletedPayload,
  GenerationFailedPayload,
  ExtractionCompletedPayload,
} from "./events";

export { registerAiEngineConsumers } from "./events";
