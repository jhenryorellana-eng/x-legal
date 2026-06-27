/**
 * Shared types for the FormWizard engine (DOC-50 §6, Propuesta SOT-3).
 *
 * The engine is data-driven and consumed by TWO surfaces with the SAME impl:
 *  - cliente: `caso/[caseId]/formulario/[formId]` (step-by-step "Paso n de N")
 *  - staff:   shared-case "Información" tab / admin form-editor live preview
 *
 * These shapes are structurally identical to the backend `FormForClientDto`
 * (cases/service.ts). They are RE-DECLARED here because `frontend` may not import
 * `backend` nor `app` (boundary R2/R5). The server page reads the DTO via
 * `modules/cases/index.ts` and passes it as a prop — it matches structurally.
 */

import type { QuestionCondition } from "@/shared/form-logic/conditions";

export type Locale = "es" | "en";

export interface I18nValue {
  en: string;
  es: string;
}

/** The 6 canonical field types of `form_questions.field_type` (DOC-30). */
export type FieldType = "text" | "textarea" | "number" | "date" | "checkbox" | "select";

/** Validation jsonb mirrored from `form_questions.validation` (server is SoT). */
export interface QuestionValidation {
  regex?: string;
  min?: number;
  max?: number;
}

export interface WizardQuestion {
  id: string;
  groupId: string;
  questionI18n: I18nValue;
  helpI18n: I18nValue | null;
  fieldType: string;
  options: Array<{ value: string; labelI18n: I18nValue }> | null;
  isRequired: boolean;
  position: number;
  /** 'client_answer' | 'document_extraction' | 'generation_output' | 'profile'. */
  source: string;
  validation: QuestionValidation | null;
  /** Pre-filled value resolved by the backend (null for client_answer). */
  prefillValue: unknown;
  /** True when the value came from a non-client source ("Ya lo tenemos"). */
  isPrefilled: boolean;
  /** The answer currently saved in the response (null if none yet). */
  currentAnswer: unknown;
  /** Conditional visibility (show/lock/require). NULL/absent = unconditional. */
  condition?: QuestionCondition | null;
}

export interface WizardGroup {
  id: string;
  titleI18n: I18nValue;
  position: number;
  questions: WizardQuestion[];
}

export interface WizardForm {
  responseId: string | null;
  formDefinitionId: string;
  labelI18n: I18nValue;
  /** 'pdf_automation' | 'ai_letter'. */
  kind: string;
  isPerParty: boolean;
  versionId: string | null;
  /** null | 'draft' | 'submitted' | 'approved' | 'in_validation' | … */
  status: string | null;
  submittedAt: string | null;
  filledPdfPath: string | null;
  filledBy: string;
  /** Language of the official PDF (pdf_automation). Drives answer translation. */
  sourceLanguage: Locale;
  groups: WizardGroup[];
}

// ---------------------------------------------------------------------------
// Injected server-action result shapes (structurally identical to app actions)
// ---------------------------------------------------------------------------

export interface SaveDraftResult {
  ok: boolean;
  responseId?: string;
  /**
   * Whether a failed save is worth retrying. The server is the source of truth for
   * the policy (computed via classifySaveError); the client falls back to its own
   * classifier when this is absent (older deployments / network throws).
   */
  retryable?: boolean;
  error?: { code: string; details?: Record<string, unknown> };
}

export interface SubmitFormResult {
  ok: boolean;
  responseId?: string;
  error?: { code: string; details?: Record<string, unknown> };
}

/** Autosave action: debounced partial patch of answers (API-CASE-16). */
export type SaveDraftFn = (input: {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  patch: Record<string, unknown>;
}) => Promise<SaveDraftResult>;

/** Final submit action: server validates all required fields (API-CASE-17). */
export type SubmitFormFn = (input: {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  /** Best-effort client-side translation of textual answers (Chrome Translator). */
  answersTranslated?: Record<string, string>;
  translationStatus?: "none" | "partial" | "pending_server" | "done";
}) => Promise<SubmitFormResult>;

/** Server fallback translator (Gemini) injected into the wizard for the cases
 *  where the on-device Chrome Translator API is unavailable. */
export type TranslateAnswersFn = (input: {
  items: Array<{ id: string; text: string }>;
  from: Locale;
  to: Locale;
}) => Promise<{ ok: boolean; translations?: Record<string, string>; error?: { code: string } }>;

// ---------------------------------------------------------------------------
// Wizard runtime state (UI-only — never the source of truth)
// ---------------------------------------------------------------------------

/**
 * The discrete autosave indicator state (DOC-50 §6.3).
 *  - idle/saving/saved: normal online lifecycle.
 *  - queued: offline (or a network throw) — saved on-device, pending sync.
 *  - error: a transient server error — retrying with backoff.
 *  - blocked: a permanent rejection (e.g. submitted elsewhere) — no retry; reload.
 */
export type SaveState = "idle" | "saving" | "saved" | "queued" | "error" | "blocked";

/** Per-question validation failure codes mirroring the server domain. */
export type FieldErrorCode = "required" | "regex" | "min" | "max" | "type";

/** A flat answers map: { [questionId]: value }. */
export type AnswersMap = Record<string, unknown>;

/**
 * The fully-resolved string bundle the wizard needs. Resolved server-side from
 * next-intl and passed as a prop so the engine never imports `next-intl` itself
 * (it must stay surface-agnostic — cliente + staff preview share it).
 */
export interface WizardLabels {
  // Header
  stepCounter: string; // "Paso {n} de {total}" / "Step {n} of {total}"
  back: string;
  // Autosave indicator
  saving: string; // "Guardando…"
  saved: string; // "Guardado ✓"
  queued: string; // "Guardado en este dispositivo · pendiente de envío"
  saveError: string; // "Reintentando…"
  saveBlocked: string; // "No pudimos guardar. Recarga la página para continuar."
  saveBlockedSubmitted: string; // "Este formulario ya fue enviado. Recarga…"
  offlineBanner: string; // persistent offline banner

  // Prefill ("Ya lo tenemos")
  prefillChip: string; // "Ya lo tenemos"
  prefillFromDocument: string; // "lo tomamos de tu acta de nacimiento"
  prefillFromProfile: string; // "lo tomamos de tu perfil"
  prefillFromGeneration: string; // "lo tomamos de tu solicitud"
  prefillEdited: string; // "Lo cambiaste tú"
  prefillAiBadge: string; // "IA" — marks a field autocompleted by AI from a document
  // Field UI
  selectPlaceholder: string; // "Elige una opción"
  textareaPlaceholder: string; // "Escribe aquí, o toca el micrófono para hablar…"
  checkboxYes: string; // "Sí"
  // Validation (amable, never aggressive red)
  errRequired: string; // "Esto nos hace falta para continuar."
  errRegex: string; // "Revisa el formato, por favor."
  errMin: string; // "Es un poco corto. ¿Puedes ampliar?"
  errMax: string; // "Es demasiado largo. Acórtalo un poco."
  // Navigation
  next: string; // "Siguiente"
  finish: string; // "Terminar"
  submitting: string; // "Enviando…"
  // Submit error
  submitErrorTitle: string; // "No pudimos enviarlo"
  submitErrorBody: string; // "Vuelve a intentarlo en un momento."
  // Footer
  privacyNote: string; // "Tu información está protegida y es confidencial"
  // Dictation (Mi Historia + textarea fields)
  dictateIdle: string; // "Tocar para hablar"
  dictateActive: string; // "Escuchando… toca para parar"
  dictateUnsupported: string; // "El dictado no está disponible aquí. Puedes escribir."
  // Submitted (read-only)
  submittedPill: string; // "Enviado"
  submittedTitle: string; // "Esto ya está enviado"
  submittedBody: string; // "Tu equipo lo está revisando."
}
