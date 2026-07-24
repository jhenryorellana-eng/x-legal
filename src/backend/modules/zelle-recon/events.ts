/**
 * Zelle reconciliation — domain events.
 *
 * Emitted:
 * - zelle.match_suggested — a bank alert needs human eyes (tier B suggestion,
 *   tier-A degradation, or unmatched). Finance gets a push with a deep link
 *   to the reconciliation inbox.
 *
 * Note: successful settlements do NOT emit a recon-specific event — the
 * atomic settlement path re-emits the canonical billing events
 * (installment.paid / downpayment.confirmed) via
 * billing.applyBankVerifiedZellePayment, so receipts/notifications/timeline
 * behave exactly like every other confirmation.
 *
 * Consumers (register-consumers.ts):
 * - zelle.match_suggested → notifications.notifyFromEvent (finance push)
 */

export interface ZelleMatchSuggestedEvent {
  type: "zelle.match_suggested";
  payload: {
    orgId: string;
    notificationId: string;
    amountCents: number;
    /** Best-candidate case (null for the "unidentified" tray). */
    caseId: string | null;
    /** Decision tier that produced the suggestion (null = pre-tier gate). */
    tier: "A" | "B" | null;
    /** Reason code (unknown_reference, amount_mismatch, tier_b, …). */
    reason: string;
  };
  occurredAt: Date;
}

export type ZelleReconEvent = ZelleMatchSuggestedEvent;
