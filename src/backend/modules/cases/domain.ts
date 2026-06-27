/**
 * Cases module — pure domain (state machines, rules, pure functions).
 *
 * NO I/O. All functions are deterministic, testable with zero mocks.
 *
 * @module cases/domain
 */

import { deriveFieldState, parseConditionOrNull } from "@/shared/form-logic/conditions";
import { PRINCIPAL_ROLE_KEY } from "@/shared/constants/party-roles";

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
// Contract parties snapshot (DOC-30 §5 / DOC-41 §3.1)
//
// `contracts.parties_snapshot` is an informational freeze of the case parties
// at a point in time — the live truth is `case_parties`. It MUST list the
// principal applicant (petitioner) FIRST, then the additional parties in order.
// Pure: name resolution (I/O) happens in the service; this only shapes the JSON.
// ---------------------------------------------------------------------------

export interface SnapshotParty {
  role: string;
  userId: string | null;
  name: string | null;
}

export interface PartiesSnapshotShape {
  parties: SnapshotParty[];
}

/**
 * Builds the contract parties snapshot: the principal applicant (petitioner)
 * always first, then the additional parties in the given order. Pure — callers
 * resolve names (I/O) and pass them in.
 */
export function buildPartiesSnapshot(
  principal: { userId: string; name: string | null },
  additional: ReadonlyArray<{ role: string; userId: string | null; name: string | null }>,
): PartiesSnapshotShape {
  return {
    parties: [
      { role: PRINCIPAL_ROLE_KEY, userId: principal.userId, name: principal.name },
      ...additional.map((a) => ({ role: a.role, userId: a.userId, name: a.name })),
    ],
  };
}

/**
 * Keeps only the additional parties whose role is included in the contract
 * (`service_party_roles.include_in_contract`). The principal applicant
 * (petitioner) is ALWAYS in the contract and is added separately by
 * buildPartiesSnapshot — it must NOT be in `additional`.
 *
 * Pure. The `case_parties` table still stores ALL parties (e.g. an optional
 * spouse remains a real case party); this filter only shapes the contract
 * snapshot that the signing page + PDF render.
 */
export function selectContractAdditionalParties<T extends { role: string }>(
  additional: ReadonlyArray<T>,
  includedRoleKeys: ReadonlySet<string>,
): T[] {
  return additional.filter((a) => includedRoleKeys.has(a.role));
}

/**
 * Validates per-role cardinality: a role declared `single` may appear at most
 * once among the case parties. Returns the FIRST role_key that violates the
 * rule, or null when all roles are within their cardinality. Pure.
 */
export function findCardinalityViolation(
  partyRoles: ReadonlyArray<string>,
  singleRoleKeys: ReadonlySet<string>,
): string | null {
  const seen = new Set<string>();
  for (const role of partyRoles) {
    if (!singleRoleKeys.has(role)) continue;
    if (seen.has(role)) return role;
    seen.add(role);
  }
  return null;
}

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
 * Base weights: documents=50%, forms=30%, appointments=20%. Only categories that
 * actually have requirements (total > 0) count — the weights are renormalized
 * over the required categories. A category with nothing required does NOT count
 * as "100% done": otherwise a documents-only phase (forms/appointments not yet
 * wired, passed as 0/0) would show a fixed 30%+20% = 50% floor even with zero
 * documents uploaded. When NOTHING at all is required, the phase is complete (100).
 */
export function computePhaseProgress(input: PhaseProgressInput): number {
  const { documents: dW, forms: fW, appointments: aW } = PHASE_PROGRESS_WEIGHTS;

  const categories = [
    { weight: dW, done: input.approvedDocuments, total: input.totalDocuments },
    { weight: fW, done: input.submittedForms, total: input.totalForms },
    { weight: aW, done: input.completedAppointments, total: input.totalAppointments },
  ].filter((c) => c.total > 0);

  // Nothing required anywhere in the phase → complete.
  if (categories.length === 0) return 100;

  const totalWeight = categories.reduce((sum, c) => sum + c.weight, 0);
  const weighted = categories.reduce((sum, c) => {
    const pct = Math.min(100, Math.round((c.done / c.total) * 100));
    return sum + pct * c.weight;
  }, 0);

  return Math.round(weighted / totalWeight);
}

// ---------------------------------------------------------------------------
// Case ownership stage — responsable / etapa interna (eje propio)
//
// Eje de RESPONSABILIDAD, ortogonal a `cases.status` (legal) y a la columna kanban.
// El caso pasa de un responsable al siguiente por TRASPASO MANUAL gated por tareas:
//   sales (Vanessa) → legal (Diana) → operations (Andrium) → done
// El traspaso NO toca cases.status. Estas funciones son puras; el servicio orquesta
// el I/O (update + history + kanban + audit).
// ---------------------------------------------------------------------------

export type CaseStage = "sales" | "legal" | "operations" | "done";

/** Orden canónico de las etapas. `done` es terminal. */
export const STAGE_ORDER: CaseStage[] = ["sales", "legal", "operations", "done"];

/** La etapa siguiente, o null si la actual es terminal (`done`). Pura. */
export function nextStage(stage: CaseStage): CaseStage | null {
  const i = STAGE_ORDER.indexOf(stage);
  if (i < 0 || i >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[i + 1];
}

/**
 * Módulo de permisos que gobierna la ELEGIBILIDAD del responsable de cada etapa
 * (no-terminal). Los candidatos = staff con can_edit en ese module_key (+ admin).
 * Editable por el admin en /admin/empleados → "todo por permisos".
 *  - sales       → 'leads'       (los asesores de ventas)
 *  - legal       → 'expedientes' (paralegales: arman el expediente)
 *  - operations  → 'printing'    (operaciones: imprimen/envían)
 */
export const STAGE_MODULE: Record<Exclude<CaseStage, "done">, string> = {
  sales: "leads",
  legal: "expedientes",
  operations: "printing",
};

export interface StageChecklistItem {
  /** Clave estable para i18n y tests (la etiqueta la resuelve el frontend). */
  key: string;
  done: boolean;
  /** true = tarea aún no definida en el producto (gate placeholder, forzable por admin). */
  placeholder?: boolean;
}

export interface StageChecklist {
  stage: CaseStage;
  items: StageChecklistItem[];
  /** Todas las tareas no-placeholder cumplidas (habilita "Traspasar"). */
  allDone: boolean;
}

/**
 * Señales (ya calculadas en el servicio) que alimentan el checklist de la etapa.
 * Un total === 0 significa "no aplica" → cuenta como cumplido (no bloquea).
 *
 * Nota: pago + contrato firmado + disclaimer son prerequisitos de ACCESO al caso
 * (puntos aparte), NO tareas del traspaso — por eso no están aquí.
 */
export interface StageChecklistSignals {
  citasTotal: number;
  citasCompleted: number;
  docsTotal: number;
  /** Documentos APROBADOS (status='approved'), no sólo subidos. */
  docsApproved: number;
  formsTotal: number;
  formsDone: number;
  /** Documentos que requieren traducción (ES, sin marcar "ya en inglés"). */
  docsToTranslate: number;
  translationsCompleted: number;
}

/**
 * Definition of Done por etapa. Devuelve los ítems con su estado `done`.
 *
 * Etapa `sales` (Vanessa) — gating del traspaso a Legal (decisión de Henry):
 *   - citas: toda la ruta de citas completada.
 *   - docs: documentos del cliente al 100% APROBADOS (status='approved').
 *   - forms: formularios al 100% enviados.
 *   - translation: todo documento en español traducido (los marcados "ya en
 *     inglés" se excluyen del denominador).
 *   (pago + contrato + disclaimer son prerequisitos de acceso, puntos aparte.)
 *
 * Etapas `legal` / `operations`: gate placeholder (las tareas se definen en otra
 * sesión); el admin puede forzar el traspaso mientras tanto.
 *
 * Pura.
 */
export function computeStageChecklist(
  stage: CaseStage,
  s: StageChecklistSignals,
): StageChecklist {
  const done = (total: number, ok: number) => total === 0 || ok >= total;

  let items: StageChecklistItem[];
  if (stage === "sales") {
    items = [
      { key: "citas", done: done(s.citasTotal, s.citasCompleted) },
      { key: "docs", done: done(s.docsTotal, s.docsApproved) },
      { key: "forms", done: done(s.formsTotal, s.formsDone) },
      { key: "translation", done: done(s.docsToTranslate, s.translationsCompleted) },
    ];
  } else if (stage === "legal") {
    items = [{ key: "expediente", done: false, placeholder: true }];
  } else if (stage === "operations") {
    items = [{ key: "print_send", done: false, placeholder: true }];
  } else {
    items = [];
  }

  const gating = items.filter((i) => !i.placeholder);
  const allDone = gating.length > 0 && gating.every((i) => i.done);
  return { stage, items, allDone };
}

/**
 * ¿Se puede traspasar la etapa actual? Pura.
 * Devuelve null si está permitido, o un código de error.
 *  - Sólo el responsable actual o un admin pueden traspasar.
 *  - El checklist debe estar completo, salvo que un admin lo fuerce (`force`).
 *  - No se puede traspasar desde una etapa terminal.
 */
export function canTransferStage(
  stage: CaseStage,
  checklist: StageChecklist,
  ctx: { isOwner: boolean; isAdmin: boolean; force?: boolean },
): null | "STAGE_TERMINAL" | "STAGE_FORBIDDEN" | "STAGE_NOT_READY" {
  if (nextStage(stage) === null) return "STAGE_TERMINAL";
  if (!ctx.isOwner && !ctx.isAdmin) return "STAGE_FORBIDDEN";
  if (!checklist.allDone) {
    if (ctx.isAdmin && ctx.force) return null;
    return "STAGE_NOT_READY";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Phase advancement — manual, staff-driven (DOC-51 §13 / §22)
//
// The phase % within a phase is automatic (computePhaseProgress above); moving
// the case to the NEXT phase is a deliberate staff action, because each phase
// boundary tracks an external legal event (USCIS receipt, court order, …) the
// system cannot observe. This pure helper only decides WHICH phase is next; the
// service orchestrates the I/O (update + phase history + timeline + audit).
// ---------------------------------------------------------------------------

export interface ServicePhaseRef {
  id: string;
  position: number;
}

/**
 * Resolves the phase a case should move to next: the phase with the smallest
 * position strictly greater than the current phase's. Returns null when the case
 * is already at the last phase, or when the current phase is unknown / absent
 * from the list (caller treats null as "cannot advance"). Pure, order-independent.
 */
export function resolveNextPhase(
  phases: ServicePhaseRef[],
  currentPhaseId: string | null,
): ServicePhaseRef | null {
  if (!currentPhaseId) return null;
  const current = phases.find((p) => p.id === currentPhaseId);
  if (!current) return null;
  const ahead = phases
    .filter((p) => p.position > current.position)
    .sort((a, b) => a.position - b.position);
  return ahead[0] ?? null;
}

// ---------------------------------------------------------------------------
// Milestone advancement — manual, staff-driven (DOC-51 §22)
//
// Milestones are the first-class progression unit ("Mi proceso"). The case
// points at a current milestone; the staff advances it one by one. Milestones
// are globally ordered across phases by (phasePosition, position); advancing
// across a phase boundary also moves the case's phase (the service syncs it).
// This pure helper only decides WHICH milestone is next.
// ---------------------------------------------------------------------------

export interface MilestoneRef {
  id: string;
  /** Position of the milestone's phase within the service. */
  phasePosition: number;
  /** Position of the milestone within its phase. */
  position: number;
}

/** Global order of milestones across phases: by phase, then position. */
function orderMilestones(milestones: MilestoneRef[]): MilestoneRef[] {
  return [...milestones].sort(
    (a, b) => a.phasePosition - b.phasePosition || a.position - b.position,
  );
}

/**
 * The first milestone of the service in global order, or null when there are
 * none (used to seed `current_milestone_id` on case activation). Pure.
 */
export function resolveFirstMilestone(milestones: MilestoneRef[]): MilestoneRef | null {
  return orderMilestones(milestones)[0] ?? null;
}

/**
 * Resolves the milestone a case should advance to next: the one immediately
 * after the current milestone in global order (phase, then position). Returns
 * null when already at the last milestone, or when the current milestone is
 * unknown / absent (caller treats null as "cannot advance"). Pure, order-independent.
 */
export function resolveNextMilestone(
  milestones: MilestoneRef[],
  currentMilestoneId: string | null,
): MilestoneRef | null {
  if (!currentMilestoneId) return null;
  const ordered = orderMilestones(milestones);
  const idx = ordered.findIndex((m) => m.id === currentMilestoneId);
  if (idx < 0 || idx === ordered.length - 1) return null;
  return ordered[idx + 1];
}

// ---------------------------------------------------------------------------
// Cronograma — estimated dates from the case anchor (cases.opened_at)
// ---------------------------------------------------------------------------

/**
 * Adds `weeks * 7` days to an ISO anchor, returning an ISO string — or null when
 * there is no anchor yet (case not active / opened_at null) or the anchor is
 * unparseable. Pure; used for the client-facing cronograma + estimated delivery.
 */
export function addWeeksToAnchorIso(anchorIso: string | null, weeks: number): string | null {
  if (!anchorIso) return null;
  const d = new Date(anchorIso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + weeks * 7 * 24 * 60 * 60 * 1000).toISOString();
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
  /** Conditional visibility jsonb (show/lock/require). Raw — parsed per call. */
  condition?: unknown;
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
  /**
   * When true (submit), missing required answers are errors. When false (draft
   * autosave), only the answers actually PRESENT are type-checked — a partial
   * patch must never be rejected for the fields the user hasn't filled yet.
   */
  enforceRequired = true,
): AnswerValidationError[] {
  const errors: AnswerValidationError[] = [];

  for (const q of questions) {
    // Conditional/dynamic: a field hidden by its condition is never validated
    // (and is left blank at PDF time); a condition can also flip `required`.
    const condState = deriveFieldState(parseConditionOrNull(q.condition), q.is_required, answers);
    if (!condState.visible) continue;

    const value = answers[q.id];
    const isEmpty = value === undefined || value === null || value === "";

    // Required check (submit only)
    if (enforceRequired && condState.required && isEmpty) {
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
 * Party roles that may appear in a case. Canonical source of truth is the shared
 * constant (mirrors the case_parties.party_role CHECK). A service declares which
 * of these its cases use via service_party_roles.
 */
export type PartyRole = import("@/shared/constants/party-roles").PartyRoleKey;

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
