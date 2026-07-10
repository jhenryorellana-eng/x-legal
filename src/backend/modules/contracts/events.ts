/**
 * Contracts module domain events.
 *
 * F2 events emitted:
 * - contract.sent   (contractId, caseId?) — notifications send signing link SMS/email
 * - contract.signed (contractId, caseId?) — creates case / notifies finance+sales
 *
 * The contract.signed consumer (cases.createCaseFromContract) is handled via
 * register-consumers.ts, not here.
 */

export interface ContractSentEvent {
  type: "contract.sent";
  payload: {
    contractId: string;
    caseId: string | null;
    /** Single-use signing token → /firma/{signingToken} (client's signing link). */
    signingToken: string;
    // Presentation fields for the enriched contract-ready email (from the
    // contract's frozen plan_snapshot). Optional — absent on legacy emits.
    /** Service label i18n object ({ es, en }) frozen at contract creation. */
    serviceLabelI18n?: unknown;
    planTotalCents?: number;
    planDownpaymentCents?: number;
    planInstallmentCount?: number;
    planFrequency?: string;
  };
  occurredAt: Date;
}

export interface ContractSignedEvent {
  type: "contract.signed";
  payload: {
    contractId: string;
    caseId: string | null;
  };
  occurredAt: Date;
}

export type ContractEvent = ContractSentEvent | ContractSignedEvent;
