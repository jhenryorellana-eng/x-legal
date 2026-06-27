/**
 * Expediente module — pure domain (state machines, rules, pure functions).
 *
 * NO I/O. All functions are deterministic, testable with zero mocks.
 *
 * @module expediente/domain
 */

// ---------------------------------------------------------------------------
// Status constants
// ---------------------------------------------------------------------------

export const EXPEDIENTE_STATUSES = [
  "draft",
  "compiling",
  "compile_failed",
  "compiled",
  "sent_to_lawyer",
  "corrections_needed",
  "approved",
  "sent_to_finance",
  "printed",
] as const;

export type ExpedienteStatus = (typeof EXPEDIENTE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Item type constants
// ---------------------------------------------------------------------------

export const EXPEDIENTE_ITEM_TYPES = [
  "cover",
  "ai_generation",
  "automated_form",
  "client_document",
  "translation",
  "external_file",
] as const;

export type ExpedienteItemType = (typeof EXPEDIENTE_ITEM_TYPES)[number];

// ---------------------------------------------------------------------------
// Role alias (mirrors cases/domain.ts)
// ---------------------------------------------------------------------------

export type StaffRole = "admin" | "sales" | "paralegal" | "finance";

// ---------------------------------------------------------------------------
// EXPEDIENTE_TRANSITIONS — state machine
// ---------------------------------------------------------------------------

export interface ExpedienteTransitionRule {
  from: ExpedienteStatus;
  to: ExpedienteStatus;
  /** Roles allowed (admin always included — enforced in canTransitionExpediente). */
  allowedRoles: StaffRole[];
}

/**
 * Full transition table for expediente status.
 *
 * draft → compiling         (paralegal assembles and triggers compilation)
 * compiling → compiled       (system: compile success)
 * compiling → compile_failed (system: compile error)
 * compile_failed → compiling (paralegal retries)
 * compiled → sent_to_lawyer  (paralegal sends for review)
 * compiled → sent_to_finance (shortcut: direct to finance if no legal review)
 * sent_to_lawyer → approved  (lawyer approves)
 * sent_to_lawyer → corrections_needed (lawyer requests corrections)
 * corrections_needed → (new attempt via createCorrectionAttempt → new draft)
 * approved → sent_to_finance
 * sent_to_finance → printed  (Andrium marks physical print)
 */
export const EXPEDIENTE_TRANSITIONS: ExpedienteTransitionRule[] = [
  { from: "draft",             to: "compiling",           allowedRoles: ["admin", "paralegal"] },
  { from: "compiling",         to: "compiled",            allowedRoles: ["admin", "paralegal"] },
  { from: "compiling",         to: "compile_failed",      allowedRoles: ["admin", "paralegal"] },
  { from: "compile_failed",    to: "compiling",           allowedRoles: ["admin", "paralegal"] },
  { from: "compiled",          to: "sent_to_lawyer",      allowedRoles: ["admin", "paralegal"] },
  { from: "compiled",          to: "sent_to_finance",     allowedRoles: ["admin", "paralegal"] },
  { from: "sent_to_lawyer",    to: "approved",            allowedRoles: ["admin", "paralegal"] },
  { from: "sent_to_lawyer",    to: "corrections_needed",  allowedRoles: ["admin", "paralegal"] },
  { from: "approved",          to: "sent_to_finance",     allowedRoles: ["admin", "paralegal", "finance"] },
  { from: "sent_to_finance",   to: "printed",             allowedRoles: ["admin", "finance"] },
];

/**
 * Validates whether an expediente status transition is allowed for a given role.
 *
 * Admin bypasses role check but still requires a defined transition edge.
 *
 * @returns null if allowed; error code string if denied.
 */
export function canTransitionExpediente(
  from: ExpedienteStatus,
  to: ExpedienteStatus,
  role: StaffRole,
): null | "EXPEDIENTE_INVALID_TRANSITION" | "EXPEDIENTE_FORBIDDEN_TRANSITION" {
  const rule = EXPEDIENTE_TRANSITIONS.find((r) => r.from === from && r.to === to);
  if (!rule) return "EXPEDIENTE_INVALID_TRANSITION";
  if (role === "admin") return null;
  if (rule.allowedRoles.includes(role)) return null;
  return "EXPEDIENTE_FORBIDDEN_TRANSITION";
}

// ---------------------------------------------------------------------------
// Editable status check
// ---------------------------------------------------------------------------

/** Returns true when the expediente can be edited (items added/removed/reordered). */
export function isEditableStatus(status: ExpedienteStatus): boolean {
  return status === "draft" || status === "corrections_needed";
}

// ---------------------------------------------------------------------------
// Item ref validation (pure shape check — no I/O)
// ---------------------------------------------------------------------------

export interface ItemRefValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Pure shape check: does the item have the right combination of
 * refId / externalFilePath for its itemType?
 *
 * - external_file: requires externalFilePath, must NOT have refId
 * - all others: requires refId, must NOT have externalFilePath
 */
export function validateItemRef(
  itemType: ExpedienteItemType,
  refId: string | null | undefined,
  externalFilePath: string | null | undefined,
): ItemRefValidation {
  if (itemType === "external_file") {
    if (!externalFilePath || externalFilePath.trim() === "") {
      return { ok: false, reason: "external_file requires externalFilePath" };
    }
    if (refId) {
      return { ok: false, reason: "external_file must not have a refId" };
    }
    return { ok: true };
  }

  // All other types: require refId
  if (!refId || refId.trim() === "") {
    return { ok: false, reason: `${itemType} requires a refId` };
  }
  if (externalFilePath) {
    return { ok: false, reason: `${itemType} must not have externalFilePath` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// PII-safe canonical client label (DOC-45 §3.1 — no full name exposed)
// ---------------------------------------------------------------------------

/**
 * Derives the canonical "{F}. {LastName}" label from a client's name.
 *
 * Used in cover page renders — no full first name in the expediente PDF.
 * Example: "María", "García" → "M. García"
 *
 * @param firstName  Client first name (may be multi-word; uses first char)
 * @param lastName   Client last name (displayed in full)
 */
export function canonicalClientLabel(firstName: string, lastName: string): string {
  const initial = (firstName ?? "").trim().charAt(0).toUpperCase();
  return `${initial}. ${(lastName ?? "").trim()}`;
}
