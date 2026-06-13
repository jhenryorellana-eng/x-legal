/**
 * Billing module domain events.
 *
 * F2 events emitted:
 * - downpayment.confirmed — emitted by applyPaymentSuccess when is_downpayment=true
 * - installment.paid      — emitted by applyPaymentSuccess for regular installments
 *
 * Consumers:
 * - downpayment.confirmed → cases.onDownpaymentConfirmed (activates case)
 * - downpayment.confirmed → notifications.notifyFromEvent
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

export type BillingEvent = DownpaymentConfirmedEvent | InstallmentPaidEvent;
