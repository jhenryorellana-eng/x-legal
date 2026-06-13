/**
 * Billing module — public API (module-pub boundary).
 */

// Use cases
export {
  createPaymentPlan,
  registerZellePayment,
  getPaymentPlanForCase,
} from "./service";

// Error class
export { BillingError } from "./service";

// Types
export type { CreatePaymentPlanInput, RegisterZellePaymentInput } from "./service";

// Domain (pure functions — safe to import widely)
export {
  buildInstallments,
  addMonthsClamped,
  canTransitionInstallment,
} from "./domain";

export type { InstallmentPlan, InstallmentStatus } from "./domain";

// Repository types
export type { PaymentPlanRow, InstallmentRow, PaymentRow } from "./repository";

// Event types
export type {
  BillingEvent,
  DownpaymentConfirmedEvent,
  InstallmentPaidEvent,
} from "./events";
