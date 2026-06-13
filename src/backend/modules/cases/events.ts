/**
 * Cases module domain events.
 *
 * F2 events emitted by cases/service.ts:
 * - document.uploaded    (case_id, document_id)
 * - document.approved    (case_id, document_id)
 * - document.rejected    (case_id, document_id)
 *
 * F2 events consumed by cases:
 * - downpayment.confirmed → onDownpaymentConfirmed (activates case)
 *
 * Consumer registration is done at module startup via register-consumers.ts.
 * Do NOT call appEvents.on() here directly — consumers are registered centrally.
 */

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

export interface DocumentUploadedEvent {
  type: "document.uploaded";
  payload: {
    caseId: string;
    documentId: string;
  };
  occurredAt: Date;
}

export interface DocumentApprovedEvent {
  type: "document.approved";
  payload: {
    caseId: string;
    documentId: string;
  };
  occurredAt: Date;
}

export interface DocumentRejectedEvent {
  type: "document.rejected";
  payload: {
    caseId: string;
    documentId: string;
  };
  occurredAt: Date;
}

export interface CaseCreatedEvent {
  type: "case.created";
  payload: {
    caseId: string;
  };
  occurredAt: Date;
}

export interface CaseAssignedEvent {
  type: "case.assigned";
  payload: {
    caseId: string;
    paralegalId: string;
  };
  occurredAt: Date;
}

export interface DownpaymentConfirmedEvent {
  type: "downpayment.confirmed";
  payload: {
    caseId: string;
    installmentId: string;
  };
  occurredAt: Date;
}

export type CaseEvent =
  | DocumentUploadedEvent
  | DocumentApprovedEvent
  | DocumentRejectedEvent
  | CaseCreatedEvent
  | CaseAssignedEvent;

export type ConsumedByCasesEvent = DownpaymentConfirmedEvent;
