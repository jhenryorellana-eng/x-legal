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

export interface DownpaymentConfirmedEvent {
  type: "downpayment.confirmed";
  payload: {
    caseId: string;
    installmentId: string;
    paymentId: string;
    amountCents: number;
    method: string;
  };
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
  };
  occurredAt: Date;
}

/** Emitted when a client uploads a Zelle payment proof (DOC-44 §5.1, SOT-4). */
export interface PaymentProofSubmittedEvent {
  type: "payment.proof_submitted";
  payload: {
    caseId: string;
    installmentId: string;
    paymentId: string;
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

export type BillingEvent =
  | DownpaymentConfirmedEvent
  | InstallmentPaidEvent
  | PaymentProofSubmittedEvent
  | PaymentRefundedEvent
  | InstallmentOverdueEvent;
