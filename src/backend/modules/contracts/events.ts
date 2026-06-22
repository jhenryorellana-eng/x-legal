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
