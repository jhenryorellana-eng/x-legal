/**
 * Billing module — public API (module-pub boundary).
 *
 * F2: createPaymentPlan, registerZellePayment, getPaymentPlanForCase
 * F6-Ola1: createCheckoutSessionForInstallment, handleStripeEvent,
 *   submitZelleProof, confirmZellePayment, rejectZelleProof,
 *   getAccountStatement, getInstallmentPaymentStatus, onContractSigned
 *
 * Server actions (API-BIL-01, API-BIL-06, API-BIL-07, API-BIL-08, API-BIL-13):
 *   See ./actions.ts — exported separately so Next.js can tree-shake them.
 */

// Use cases
export {
  createPaymentPlan,
  registerZellePayment,
  getPaymentPlanForCase,
  // F6-Ola1
  createCheckoutSessionForInstallment,
  handleStripeEvent,
  submitZelleProof,
  confirmZellePayment,
  rejectZelleProof,
  getAccountStatement,
  getInstallmentPaymentStatus,
  getZelleProofUploadUrl,
  onContractSigned,
} from "./service";

// Error class
export { BillingError } from "./service";

// Types
export type {
  CreatePaymentPlanInput,
  RegisterZellePaymentInput,
  SubmitZelleProofInput,
  RejectZelleProofInput,
  GetZelleProofUploadUrlInput,
  AccountStatementDto,
} from "./service";

// Domain (pure functions — safe to import widely)
export {
  buildInstallments,
  reanchorDueDates,
  addMonthsClamped,
  canTransitionInstallment,
  isOverdue,
  daysLate,
  PAYABLE_STATUSES,
} from "./domain";

export type {
  InstallmentDraft,
  InstallmentPlan,
  InstallmentStatus,
  InstallmentTransitionActor,
} from "./domain";

// STRONG-4: findInstallmentById / findInstallmentCaseId are NOT exported from
// the module-pub boundary. Route handlers must go through service functions
// (getZelleProofUploadUrl, submitZelleProof, getInstallmentPaymentStatus, etc.)
// which already call them internally. Exporting raw repo functions across the
// module boundary violates the module-int rule.

// Repository types
export type {
  PaymentPlanRow,
  InstallmentRow,
  PaymentRow,
  AccountStatementDto as AccountStatementDtoFromRepo,
} from "./repository";

// Event types
export type {
  BillingEvent,
  DownpaymentConfirmedEvent,
  InstallmentPaidEvent,
  PaymentProofSubmittedEvent,
  PaymentRefundedEvent,
  InstallmentOverdueEvent,
} from "./events";
