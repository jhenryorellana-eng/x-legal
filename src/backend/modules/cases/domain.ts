/**
 * Cases module — pure domain (state machines, rules, pure functions).
 *
 * NO I/O. All functions are deterministic, testable with zero mocks.
 *
 * @module cases/domain
 */

// ---------------------------------------------------------------------------
// CaseStatus
// ---------------------------------------------------------------------------

export type CaseStatus =
  | "payment_pending"
  | "active"
  | "in_validation"
  | "ready_for_delivery"
  | "delivered"
  | "completed"
  | "cancelled"
  | "on_hold";

export type CaseDocumentStatus = "uploaded" | "approved" | "rejected" | "replaced";

export type ContractStatus = "draft" | "sent" | "signed" | "cancelled";

// ---------------------------------------------------------------------------
// Role aliases used in transition guards
// ---------------------------------------------------------------------------
export type StaffRole = "admin" | "sales" | "paralegal" | "finance";

// ---------------------------------------------------------------------------
// CASE_TRANSITIONS — who can transition to what
// ---------------------------------------------------------------------------

/**
 * Maps (from → to) to the set of roles allowed to perform the transition.
 * "admin" always works (handled in canTransitionCase).
 */
export interface TransitionRule {
  from: CaseStatus;
  to: CaseStatus;
  /** Roles that can perform this transition. Admin is always included. */
  allowedRoles: StaffRole[];
}

export const CASE_TRANSITIONS: TransitionRule[] = [
  // payment_pending → active (triggered by system after downpayment.confirmed)
  { from: "payment_pending", to: "active",               allowedRoles: ["admin"] },
  // active → in_validation
  { from: "active",          to: "in_validation",        allowedRoles: ["admin", "paralegal"] },
  // in_validation → ready_for_delivery
  { from: "in_validation",   to: "ready_for_delivery",   allowedRoles: ["admin", "paralegal"] },
  // ready_for_delivery → delivered
  { from: "ready_for_delivery", to: "delivered",         allowedRoles: ["admin", "paralegal"] },
  // delivered → completed
  { from: "delivered",       to: "completed",            allowedRoles: ["admin", "paralegal"] },
  // Any non-terminal → on_hold
  { from: "payment_pending", to: "on_hold",              allowedRoles: ["admin", "sales"] },
  { from: "active",          to: "on_hold",              allowedRoles: ["admin", "sales", "paralegal"] },
  { from: "in_validation",   to: "on_hold",              allowedRoles: ["admin", "sales", "paralegal"] },
  { from: "ready_for_delivery", to: "on_hold",           allowedRoles: ["admin", "sales", "paralegal"] },
  // on_hold → active (resume)
  { from: "on_hold",         to: "active",               allowedRoles: ["admin", "sales", "paralegal"] },
  // Any non-terminal → cancelled
  { from: "payment_pending", to: "cancelled",            allowedRoles: ["admin", "sales"] },
  { from: "active",          to: "cancelled",            allowedRoles: ["admin", "sales"] },
  { from: "in_validation",   to: "cancelled",            allowedRoles: ["admin"] },
  { from: "on_hold",         to: "cancelled",            allowedRoles: ["admin", "sales"] },
];

/**
 * Validates whether a case status transition is allowed for a given role.
 *
 * Admin bypasses role check but still requires a defined transition edge.
 *
 * @returns `null` if allowed; error code string if denied.
 */
export function canTransitionCase(
  from: CaseStatus,
  to: CaseStatus,
  role: StaffRole,
): null | "CASE_INVALID_TRANSITION" | "CASE_FORBIDDEN_TRANSITION" {
  const rule = CASE_TRANSITIONS.find((r) => r.from === from && r.to === to);
  if (!rule) return "CASE_INVALID_TRANSITION";
  if (role === "admin") return null;
  if (rule.allowedRoles.includes(role)) return null;
  return "CASE_FORBIDDEN_TRANSITION";
}

// ---------------------------------------------------------------------------
// DOCUMENT_TRANSITIONS
// ---------------------------------------------------------------------------

const DOCUMENT_TRANSITIONS: Map<CaseDocumentStatus, CaseDocumentStatus[]> = new Map([
  ["uploaded",  ["approved", "rejected"]],
  ["rejected",  ["replaced"]],
  ["replaced",  ["approved", "rejected"]],
  // "approved" is terminal
]);

/**
 * Returns null if the document status transition is valid, error code otherwise.
 */
export function canTransitionDocument(
  from: CaseDocumentStatus,
  to: CaseDocumentStatus,
): null | "DOC_INVALID_TRANSITION" {
  const allowed = DOCUMENT_TRANSITIONS.get(from) ?? [];
  return allowed.includes(to) ? null : "DOC_INVALID_TRANSITION";
}

// ---------------------------------------------------------------------------
// CONTRACT_TRANSITIONS
// ---------------------------------------------------------------------------

const CONTRACT_TRANSITIONS: Map<ContractStatus, ContractStatus[]> = new Map([
  ["draft",      ["sent", "cancelled"]],
  ["sent",       ["signed", "cancelled"]],
  // "signed" and "cancelled" are terminal
]);

/**
 * Returns null if the contract status transition is valid, error code otherwise.
 */
export function canTransitionContract(
  from: ContractStatus,
  to: ContractStatus,
): null | "CONTRACT_INVALID_TRANSITION" {
  const allowed = CONTRACT_TRANSITIONS.get(from) ?? [];
  return allowed.includes(to) ? null : "CONTRACT_INVALID_TRANSITION";
}

// ---------------------------------------------------------------------------
// Phase progress computation
// ---------------------------------------------------------------------------

/** Weights for phase progress calculation (must sum to 100) */
export const PHASE_PROGRESS_WEIGHTS = {
  documents: 50,
  forms: 30,
  appointments: 20,
} as const;

/**
 * Statuses that indicate a case is actively being worked on.
 * Used to gate certain UI / notifications.
 */
export const PRODUCTION_STATUSES: CaseStatus[] = [
  "active",
  "in_validation",
];

export interface PhaseProgressInput {
  /** Total required documents for this phase */
  totalDocuments: number;
  /** Approved documents */
  approvedDocuments: number;
  /** Total forms required */
  totalForms: number;
  /** Submitted forms */
  submittedForms: number;
  /** Total appointments required */
  totalAppointments: number;
  /** Completed appointments */
  completedAppointments: number;
}

/**
 * Computes a [0, 100] progress score for a phase.
 *
 * Uses weights: documents=50%, forms=30%, appointments=20%.
 * Returns 100 when all totals are 0 (nothing required = complete).
 */
export function computePhaseProgress(input: PhaseProgressInput): number {
  const { documents: dW, forms: fW, appointments: aW } = PHASE_PROGRESS_WEIGHTS;

  function pct(done: number, total: number): number {
    if (total === 0) return 100;
    return Math.min(100, Math.round((done / total) * 100));
  }

  const docPct   = pct(input.approvedDocuments, input.totalDocuments);
  const formPct  = pct(input.submittedForms, input.totalForms);
  const apptPct  = pct(input.completedAppointments, input.totalAppointments);

  return Math.round((docPct * dW + formPct * fW + apptPct * aW) / 100);
}

// ---------------------------------------------------------------------------
// FormResponse state machine
// ---------------------------------------------------------------------------

export type FormResponseStatus = "draft" | "submitted" | "approved";

const FORM_RESPONSE_TRANSITIONS: Map<FormResponseStatus, FormResponseStatus[]> = new Map([
  ["draft", ["submitted"]],
  ["submitted", ["approved"]],
  // "approved" is terminal
]);

/**
 * Returns null if the form response status transition is valid, error code otherwise.
 */
export function canTransitionFormResponse(
  from: FormResponseStatus,
  to: FormResponseStatus,
): null | "FORM_INVALID_TRANSITION" {
  const allowed = FORM_RESPONSE_TRANSITIONS.get(from) ?? [];
  return allowed.includes(to) ? null : "FORM_INVALID_TRANSITION";
}

// ---------------------------------------------------------------------------
// Answer validation (server-side, RF-TRX-027)
// ---------------------------------------------------------------------------

export interface QuestionValidationRule {
  id: string;
  field_type: "text" | "number" | "date" | "checkbox" | "select" | "textarea";
  is_required: boolean;
  options?: Array<{ value: string }> | null;
  /** JSON: {regex?, min?: number, max?: number} */
  validation?: Record<string, unknown> | null;
}

export interface AnswerValidationError {
  questionId: string;
  code: "required" | "regex" | "min" | "max" | "type";
}

/**
 * Validates a set of answers against the question definitions.
 * Returns an array of validation errors (empty = valid).
 * server-side enforcement — never trust the client (RF-TRX-027).
 */
export function validateAnswerTypes(
  answers: Record<string, unknown>,
  questions: QuestionValidationRule[],
): AnswerValidationError[] {
  const errors: AnswerValidationError[] = [];

  for (const q of questions) {
    const value = answers[q.id];
    const isEmpty = value === undefined || value === null || value === "";

    // Required check
    if (q.is_required && isEmpty) {
      errors.push({ questionId: q.id, code: "required" });
      continue;
    }

    if (isEmpty) continue; // optional and empty — skip validation rules

    // Select: value must be one of the declared options (server-side whitelist).
    // The client Zod schema also enforces this, but the server is the source of truth.
    if (q.field_type === "select" && q.options && q.options.length > 0) {
      const allowedValues = q.options.map((o) => o.value);
      if (!allowedValues.includes(String(value))) {
        errors.push({ questionId: q.id, code: "type" });
        continue;
      }
    }

    // Type/format validation
    const val = q.validation as { regex?: string; min?: number; max?: number } | null | undefined;

    if (val?.regex) {
      try {
        const re = new RegExp(val.regex);
        if (typeof value === "string" && !re.test(value)) {
          errors.push({ questionId: q.id, code: "regex" });
          continue;
        }
      } catch {
        // Invalid regex in catalog — skip silently
      }
    }

    if (val?.min !== undefined) {
      const num = Number(value);
      if (!isNaN(num) && num < val.min) {
        errors.push({ questionId: q.id, code: "min" });
        continue;
      }
      if (typeof value === "string" && value.length < val.min) {
        errors.push({ questionId: q.id, code: "min" });
        continue;
      }
    }

    if (val?.max !== undefined) {
      const num = Number(value);
      if (!isNaN(num) && num > val.max) {
        errors.push({ questionId: q.id, code: "max" });
        continue;
      }
      if (typeof value === "string" && value.length > val.max) {
        errors.push({ questionId: q.id, code: "max" });
        continue;
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Party eligibility
// ---------------------------------------------------------------------------

/**
 * Party roles that may appear in a case. Sourced from catalog.
 * This list drives which parties are eligible to submit documents.
 */
export type PartyRole =
  | "primary_applicant"
  | "co_applicant"
  | "spouse"
  | "dependent"
  | "guarantor";

/**
 * Returns true if the party role is an eligible party for document submission.
 * Currently all party roles are eligible.
 */
export function isEligibleParty(_role: PartyRole): boolean {
  // All party roles can submit documents in F2.
  // Extend this if future roles become ineligible (e.g. "observer").
  return true;
}

// ---------------------------------------------------------------------------
// Timeline entry helper types
// ---------------------------------------------------------------------------

export interface I18nText {
  en: string;
  es: string;
}

export interface TimelineEntryInput {
  caseId: string;
  eventType: string;
  actorKind: "staff" | "client" | "system";
  actorUserId: string | null;
  title: I18nText;
  body?: I18nText;
  icon?: string;
  color?: string;
  visibleToClient?: boolean;
}
