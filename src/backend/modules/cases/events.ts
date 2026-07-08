/**
 * Cases module domain events.
 *
 * F2 events emitted by cases/service.ts:
 * - document.uploaded       (caseId, documentId, uploadedByKind)
 * - document.approved       (caseId, documentId)
 * - document.rejected       (caseId, documentId)
 * - form_response.submitted (caseId, responseId, formDefinitionId, partyId, submittedByKind)
 * - form_response.approved  (caseId, responseId, formDefinitionId, partyId)
 * - form_response.rejected  (caseId, responseId, formDefinitionId, partyId)
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
    /** Who uploaded it — the sales notification only fires for client uploads. */
    uploadedByKind: "client" | "staff";
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

/**
 * A client (or staff) finished and submitted a form response. The notifications
 * matrix fires the sales alert only when `submittedByKind === "client"`.
 */
export interface FormResponseSubmittedEvent {
  type: "form_response.submitted";
  payload: {
    caseId: string;
    responseId: string;
    formDefinitionId: string;
    partyId: string | null;
    submittedByKind: "client" | "staff";
  };
  occurredAt: Date;
}

/** Staff approved a submitted form response (submitted → approved). */
export interface FormResponseApprovedEvent {
  type: "form_response.approved";
  payload: {
    caseId: string;
    responseId: string;
    formDefinitionId: string;
    partyId: string | null;
  };
  occurredAt: Date;
}

/** Staff returned a submitted form response for correction (submitted → rejected). */
export interface FormResponseRejectedEvent {
  type: "form_response.rejected";
  payload: {
    caseId: string;
    responseId: string;
    formDefinitionId: string;
    partyId: string | null;
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

/**
 * Emitted whenever the case's responsible staff (current_owner_id) changes:
 * at creation (fromOwnerId=null), on a stage transfer, or on an admin reassign.
 * The kanban module consumes it to project the case card onto the new owner's
 * `cases` board and remove it from the previous owner's board.
 */
export interface CaseOwnerChangedEvent {
  type: "case.owner_changed";
  payload: {
    caseId: string;
    orgId: string;
    fromOwnerId: string | null;
    toOwnerId: string | null;
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
  | FormResponseSubmittedEvent
  | FormResponseApprovedEvent
  | FormResponseRejectedEvent
  | CaseCreatedEvent
  | CaseOwnerChangedEvent;

export type ConsumedByCasesEvent = DownpaymentConfirmedEvent;
