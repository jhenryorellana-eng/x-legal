/**
 * Billing module domain events.
 *
 * F2 events emitted:
 * - downpayment.confirmed — emitted by applyPaymentSuccess when is_downpayment=true
 * - installment.paid      — emitted by applyPaymentSuccess for regular installments
 *
 * F6-Ola1 additions:
 * - payment.proof_submitted — client uploaded Zelle proof; Andrium notified
 * - payment.refunded        — charge.refunded processed; Andrium + timeline
 *
 * Typed stub for Ola-2:
 * - installment.overdue     — emitted by markOverdues cron (Ola-2)
 *
 * Consumers:
 * - downpayment.confirmed → cases.onDownpaymentConfirmed (activates case)
 * - downpayment.confirmed → notifications.notifyFromEvent
 * - payment.proof_submitted → notifications.notifyFromEvent (Andrium)
 * - payment.refunded       → notifications.notifyFromEvent (Andrium)
 * - installment.overdue    → notifications + kanban (Ola-2)
 */

/**
 * Receipt facts attached to payment-confirmation events so the client email
 * (DOC-73 `installment-paid`/`downpayment-confirmed`) can show amount, method
 * and plan progress without a second data fetch at render time.
 */
export interface PaymentReceiptFacts {
  /** Total installments in the plan (incl. down payment). */
  installmentCount: number;
  /** Installments already paid (this one included). */
  paidCount: number;
  /** Installments still owed (not paid, not waived). */
  remainingCount: number;
  /** Sum of the remaining installments, in cents. */
  remainingAmountCents: number;
  /** Next due installment date (YYYY-MM-DD) or null when fully paid. */
  nextDueDate: string | null;
  nextDueAmountCents: number | null;
  /** Human case number (ULP-YYYY-NNNN). */
  caseNumber: string | null;
  /** True when this payment was an automatic (off-session) card charge. */
  autopay: boolean;
  /** Last 4 of the saved card, when paid by card/autopay. */
  cardLast4: string | null;
}

export interface DownpaymentConfirmedEvent {
  type: "downpayment.confirmed";
  payload: {
    caseId: string;
    installmentId: string;
    paymentId: string;
    amountCents: number;
    method: string;
  } & PaymentReceiptFacts;
  occurredAt: Date;
}

export interface InstallmentPaidEvent {
  type: "installment.paid";
  payload: {
    caseId: string;
    installmentId: string;
    paymentId: string;
    number: number;
    amountCents: number;
    method: string;
  } & PaymentReceiptFacts;
  occurredAt: Date;
}

/** Emitted when a client uploads a Zelle payment proof (DOC-44 §5.1, SOT-4). */
export interface PaymentProofSubmittedEvent {
  type: "payment.proof_submitted";
  payload: {
    caseId: string;
    installmentId: string;
    paymentId: string;
    /** True when the proof belongs to the initial installment (cuota inicial). */
    isDownpayment: boolean;
    amountCents: number;
  };
  occurredAt: Date;
}

/** Emitted when a charge.refunded webhook is processed (DOC-71 P4). */
export interface PaymentRefundedEvent {
  type: "payment.refunded";
  payload: {
    caseId: string;
    installmentId: string;
    paymentId: string;
    amountCents: number;
  };
  occurredAt: Date;
}

/**
 * Type stub for Ola-2 (markOverdues cron emits this).
 * Registered here so the event bus type system is consistent.
 */
export interface InstallmentOverdueEvent {
  type: "installment.overdue";
  payload: {
    caseId: string;
    installmentId: string;
    number: number;
    amountCents: number;
    dueDate: string;
    daysLate: number;
    orgId: string;
  };
  occurredAt: Date;
}

/**
 * Emitted by the charge-due-installments cron when an off-session charge
 * fails but autopay stays enabled (attempt < max, DOC-71 §2.4).
 */
export interface AutopayChargeFailedEvent {
  type: "autopay.charge_failed";
  payload: {
    caseId: string;
    orgId: string;
    planId: string;
    installmentId: string;
    number: number;
    amountCents: number;
    attempt: number;
    maxAttempts: number;
    /** Stripe decline_code / code, or "provider_error" for non-card failures. */
    reason: string;
  };
  occurredAt: Date;
}

/**
 * Emitted when autopay is turned off by the SYSTEM (kill-switch, SCA, refund).
 * Customer/staff-initiated disables only write timeline/audit — no event.
 */
export interface AutopayDisabledEvent {
  type: "autopay.disabled";
  payload: {
    caseId: string;
    orgId: string;
    planId: string;
    installmentId?: string;
    reason: string;
  };
  occurredAt: Date;
}

export type BillingEvent =
  | DownpaymentConfirmedEvent
  | InstallmentPaidEvent
  | PaymentProofSubmittedEvent
  | PaymentRefundedEvent
  | InstallmentOverdueEvent
  | AutopayChargeFailedEvent
  | AutopayDisabledEvent;
