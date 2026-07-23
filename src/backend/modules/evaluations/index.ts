/**
 * Evaluations module — public border (module-pub).
 *
 * External evaluation tools per service (v1: Juez — asylum evaluation).
 * x-legal is the source of truth: attempts, delivered PDF, client data.
 * Integration contract v1: docs/PROMPT-JUEZ-XLEGAL.md.
 */

export {
  // Client (server components / camino CTA)
  getOrCreateClientEvaluation,
  getClientEvaluationSummary,
  getClientEvaluationPdfUrl,
  // Staff (case workspace tab)
  getStaffEvaluationPanel,
  getStaffEvaluationPdfUrl,
  grantExtraAttempt,
  // Server-to-server API for Juez (routes authenticate by x-api-key)
  verifyJuezApiKey,
  getSessionForJuez,
  consumeAttempt,
  // Webhook / reconciliation
  processJuezWebhook,
  reconcileStaleEvaluations,
} from "./service";

export {
  getClientEvaluationStateAction,
  getClientEvaluationPdfUrlAction,
  grantExtraAttemptAction,
  getStaffEvaluationPdfUrlAction,
  type ActionResult,
} from "./actions";

export { EvaluationsError, projectSessionStatus, ConsumeBodySchema } from "./domain";

export type {
  ClientEvaluationVM,
  ClientEvaluationSummary,
  StaffEvaluationVM,
  StaffEvaluationRunVM,
  JuezSessionDto,
  ConsumeResult,
  EvaluationReportMeta,
} from "./domain";

export type {
  EvaluationCompletedPayload,
  EvaluationFailedPayload,
} from "./events";
