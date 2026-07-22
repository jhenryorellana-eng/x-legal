/**
 * shared-case view model + action types (DOC-50 §4, DOC-52/53).
 *
 * The RSC page assembles `CaseWorkspaceVM` from the cases/billing/contracts
 * module reads and injects the server actions. The feature is presentational +
 * data-driven over this VM — no module imports here (R2).
 */

import type { StatusKind } from "@/frontend/components/brand/status-pill";

/**
 * Canonical tab ids + staff roles live in shared/ (single source of truth used
 * by both the frontend renderer and the backend override validator). The role
 * decides WHICH subset renders and with what label; messaging is a header button,
 * not a tab. See src/shared/constants/case-tabs.ts and build-tabs.ts.
 */
import type { CaseTabId, StaffRole as StaffRoleVM } from "@/shared/constants/case-tabs";
export type { CaseTabId, StaffRoleVM };
import type { NoteView, NoteVisibility } from "./notes";

export interface CaseHeaderVM {
  caseId: string;
  caseNumber: string;
  clientName: string;
  /** Primary client's account phone (users.phone_e164) — shown in the subtitle. */
  clientPhone: string | null;
  serviceLabel: string;
  planKind: "self" | "with_lawyer";
  status: string;
  statusPill: StatusKind | "amber";
  statusLabel: string;
  /** payment_pending → banner; null phase → banner. */
  isPaymentPending: boolean;
  hasPhase: boolean;
  /** Phase stepper (DOC-53 §3.1). */
  phaseLabel: string | null;
  phaseIndex: number;
  phaseCount: number;
  phaseProgress: number;
  /** Contract status (for "resend signing link" / "enviar a firma" availability). */
  contractStatus: string | null;
  contractId: string | null;
}

export interface DocumentVM {
  id: string;
  filename: string;
  status: "uploaded" | "approved" | "rejected" | "replaced";
  partyName: string | null;
  createdAt: string;
}

/** A required-document slot from the case requirements matrix (getDocumentsMatrix). */
export interface DocMatrixVM {
  key: string;
  requirementId: string | null;
  partyId: string | null;
  partyName: string | null;
  label: string;
  category: string | null;
  isRequired: boolean;
  /** Staff view only: requirement is hidden from the client (optional docs only). */
  isHidden: boolean;
  status: "pendiente" | "revision" | "aprobado" | "corregir";
  documentId: string | null;
  rejectionReason: string | null;
  /** Staff marked this uploaded document as already-English (no translation needed). */
  translationNotRequired?: boolean;
  /** Admin-configured: the client may upload more than one file for this slot. */
  allowMultiple: boolean;
  /** All current (non-replaced) files for this slot (0/1 for single, N for multiple). */
  uploads: DocUploadVM[];
}

/** One uploaded file within a requirement slot (the unit a multiple slot lists). */
export interface DocUploadVM {
  documentId: string;
  /** Semantic/human name (display_name, falling back to the raw filename). */
  displayName: string;
  status: "revision" | "aprobado" | "corregir";
  rejectionReason: string | null;
  mimeType: string;
}

export interface PartyVM {
  id: string;
  name: string;
  role: string;
  /** Legal name parts for admin edit prefill (optional — not every surface fills them). */
  firstName?: string | null;
  lastName?: string | null;
}

/** Primary client's mailing address (every field nullable — defensive parse). */
export interface CaseClientAddressVM {
  line1: string | null;
  apartment: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** "City, ST ZIP" one-liner. */
  cityStateZip: string | null;
}

/**
 * Contact card of the case's primary client (captured at intake) shown in the
 * Resumen. Name/phone/email are immutable identity; only the address is editable.
 */
export interface CaseClientVM {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  address: CaseClientAddressVM | null;
}

/** A payment attempt/confirmation against an installment (Pagos tab). */
export interface InstallmentPaymentVM {
  id: string;
  method: "stripe" | "zelle";
  /** pending | succeeded | failed | rejected | refunded */
  status: string;
  amountCents: number;
  createdAt: string;
}

export interface InstallmentVM {
  id: string;
  number: number;
  amountCents: number;
  status: string;
  isDownpayment: boolean;
  dueDate: string | null;
  /** Payments of this installment — a pending zelle one drives "Verificar". */
  payments: InstallmentPaymentVM[];
}

export interface TimelineEventVM {
  id: string;
  title: string;
  /** Optional detail line (e.g. "Lograste 2 de 4 objetivos de la cita."). */
  body?: string | null;
  occurredAt: string;
  actorKind: string;
  icon: string;
}

export interface FormVM {
  /** Anchor form definition id (ai_letter id for a Memorándum card). */
  id: string;
  /** The form the "Ver"/"Revisión" action opens. For a Memorándum (ai_letter
   *  with a companion questionnaire) this is the questionnaire id. */
  fillFormDefinitionId: string;
  /** 'ai_letter' | 'pdf_automation' | 'questionnaire'. */
  kind: string;
  label: string;
  /** null = not started yet. */
  status: string | null;
  partyId: string | null;
  partyName: string | null;
  /** 'client' | 'staff' | 'both' — who fills it (gates staff "Generar PDF"). */
  filledBy: string;
  /** Response row id (null = untouched) — needed by staff generate/approve actions. */
  responseId: string | null;
  /** Whether the official filled PDF already exists (drives Generar vs Regenerar). */
  hasPdf: boolean;
  /** False = optional form (eligible to be hidden per-case by admin/sales). */
  isRequired: boolean;
  /** True = admin/sales hid this form for this case (shown to staff with a chip). */
  isHidden: boolean;
}

export interface GenerationVM {
  /** The generation RUN id. */
  id: string;
  /** The ai_letter form definition id (for regenerate + the review route). */
  formDefinitionId: string;
  /** Resolved form label (or "—" when not in the client forms set). */
  formLabel: string;
  /** queued | running | completed | failed | cancelled. */
  status: string;
  version: number;
  costUsd: number | null;
  isCurrent: boolean;
  partyId: string | null;
  partyName: string | null;
  /** The run produced a downloadable letter (completed + output_path). */
  outputAvailable: boolean;
  createdAt: string;
}

export interface ValidationVM {
  id: string;
  attemptNo: number;
  /** queued | sent | in_review | validated | needs_corrections | error. */
  status: string;
  /** green | amber | red (semáforo). */
  semaforo: string | null;
  aiScore: number | null;
  verdict: string | null;
  createdAt: string;
}

export interface ExpedienteVM {
  id: string;
  attemptNo: number;
  /** draft | compiling | compiled | sent_to_lawyer | approved | sent_to_finance | printed | … */
  status: string;
  pageCount: number | null;
  createdAt: string;
}

/**
 * Read-only materials (documents + form responses) from phases the case has
 * already PASSED (Etapa C). Backed by cases.getPriorPhaseMaterials; labels are
 * already locale-resolved by the RSC page. Grouped by phase, newest first.
 */
export interface PriorPhaseDocVM {
  documentId: string;
  displayName: string;
  status: string;
  mimeType: string;
  createdAt: string;
  partyName: string | null;
}
export interface PriorPhaseFormVM {
  responseId: string;
  formDefinitionId: string;
  label: string;
  status: string;
  partyName: string | null;
  /** Path to the generated filled PDF (null = not generated → no download). */
  filledPdfPath: string | null;
  submittedAt: string | null;
}
export interface PriorPhaseGroupVM {
  phaseId: string;
  label: string;
  position: number;
  documents: PriorPhaseDocVM[];
  forms: PriorPhaseFormVM[];
}

/**
 * Pre-Mortem — quality validation of a specific generation (ai_letter) or
 * automation (pdf_automation): score + semáforo + verdict + findings, validated
 * against the admin filling guide, the case context, and web examples. Category /
 * verdict labels are resolved to the active locale by the RSC page.
 */
export type PreMortemSeverity = "critico" | "moderado" | "sugerencia";
export type PreMortemSemaforo = "green" | "amber" | "red";
export type PreMortemTargetKind = "ai_letter" | "pdf_automation";

export interface PreMortemFindingVM {
  severity: PreMortemSeverity;
  /** Locale-resolved category label. */
  category: string;
  location: string;
  description: string;
  correction: string;
}

/** A document that can be validated (feeds the tab selector + per-item deep-link). */
export interface PreMortemTargetVM {
  /** `${kind}:${formDefinitionId}[:${partyId}]` — selector id + deep-link key. */
  key: string;
  kind: PreMortemTargetKind;
  formDefinitionId: string;
  /** run id (ai_letter) or responseId (pdf_automation) that produced the artifact. */
  refId: string | null;
  partyId: string | null;
  label: string;
  status: string | null;
}

export interface PreMortemReportVM {
  id: string;
  /** Matches a PreMortemTargetVM.key (or a bare `${kind}:${formDefinitionId}`). */
  targetKey: string;
  targetKind: PreMortemTargetKind;
  /** 0..100. */
  score: number;
  semaforo: PreMortemSemaforo;
  /** Verdict resolved to a boolean + locale label ("¿se aprobaría?"). */
  approved: boolean;
  verdictLabel: string;
  summary: string | null;
  findings: PreMortemFindingVM[];
  model: string | null;
  costUsd: number | null;
  createdAt: string;
}

/** A queued/running validation (async QStash pipeline) — persists across reloads. */
export interface PreMortemInFlightVM {
  assessmentId: string;
  /** Matches a PreMortemTargetVM.key (or a bare `${kind}:${formDefinitionId}:`). */
  targetKey: string;
  status: "queued" | "running";
  createdAt: string;
}

export interface PreMortemVM {
  enabled: boolean;
  targets: PreMortemTargetVM[];
  /** History (newest first); the tab filters by the selected target. */
  reports: PreMortemReportVM[];
  /** Validations currently queued/running — drives "Validando…" + button lock. */
  inFlight: PreMortemInFlightVM[];
}

/** A single objective inside a cita of the appointment route (locale-resolved). */
export interface RutaCitaObjectiveVM {
  id: string;
  /** Display text resolved to the active locale. */
  text: string;
  /** Both locales — used to pre-fill the "Añadir cita" modal with unmet objectives. */
  textI18n: { es: string; en: string };
  /** Outcome flag for a completed cita; null while planned/in-progress. */
  achieved: boolean | null;
}

/** One cita in the case appointment route ("Ruta de citas"). */
export interface RutaCitaVM {
  /** Display order in the route (1-based). The "Cita N" shown to the user. */
  number: number;
  /** Internal id linking to the booked instance — NOT the display number. */
  sequenceNumber: number;
  /** Resolved label, or null → the UI falls back to "Cita N". */
  label: string | null;
  kind: string;
  /** Configured duration of this cita type (admin cronograma), in minutes. */
  durationMinutes: number;
  status: "completed" | "current" | "upcoming";
  /** "service" = shared cronograma; "case" = an extra added to this case. */
  origin: "service" | "case";
  objectives: RutaCitaObjectiveVM[];
  appointment: {
    id: string;
    startsAt: string;
    status: string;
    videoLink: string | null;
  } | null;
}

/** The appointment route for the case's current phase (staff "Ruta de citas"). */
export interface CaseRutaVM {
  phaseLabel: string | null;
  total: number;
  currentSequence: number | null;
  citas: RutaCitaVM[];
}

/** Case responsibility stage (eje propio) — drives the Traspaso tab + header chip. */
export type CaseStageId = "sales" | "legal" | "operations" | "done";

export interface StageChecklistItemVM {
  /** Stable key → i18n label (citas, docs, forms, translation, payment, contract, …). */
  key: string;
  done: boolean;
  /** false = category has nothing to do yet (n/a) — shown greyed, not a green check. */
  applicable: boolean;
  /** true = task not yet defined in product (placeholder gate, admin can force). */
  placeholder: boolean;
}

export interface StageOwnerOptionVM {
  userId: string;
  displayName: string;
  role: string;
}

export interface CaseStageVM {
  stage: CaseStageId;
  ownerId: string | null;
  ownerName: string | null;
  nextStage: CaseStageId | null;
  checklist: StageChecklistItemVM[];
  allDone: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  /** owner/admin AND checklist complete → "Traspasar" enabled (without force). */
  canTransfer: boolean;
  /**
   * Case plan requires lawyer validation (`with_lawyer`). Only meaningful in the
   * `legal` stage: false → "Traspasar" (Andrium); true → "Traspasar a Abogado".
   */
  requiresLawyer: boolean;
  /** Candidates to reassign the CURRENT stage (admin). */
  eligibleOwners: StageOwnerOptionVM[];
  /** Candidates for the NEXT stage (transfer target picker). */
  nextStageOwners: StageOwnerOptionVM[];
}

export interface CaseWorkspaceVM {
  header: CaseHeaderVM;
  /** Responsible/stage + handoff gating (Traspaso tab + header chip). Null = unavailable. */
  stage?: CaseStageVM | null;
  /** Appointment route for the current phase (Ruta de citas tab). Null = unavailable. */
  ruta?: CaseRutaVM | null;
  /** Drives the role-aware tab set + admin affordances. */
  role: StaffRoleVM;
  isAdmin: boolean;
  /** Validación tab visibility (only with_lawyer plans). */
  requiresLawyerValidation: boolean;
  documents: DocumentVM[];
  /** Full requirements matrix (the docs the admin defined on the service). */
  requirements: DocMatrixVM[];
  /** Approved/total document requirements (docs progress ring). */
  docsApproved: number;
  docsTotal: number;
  parties: PartyVM[];
  /** Primary client's contact card (identity + address). Null = no client. */
  client?: CaseClientVM | null;
  installments: InstallmentVM[];
  /** Installment cadence of the payment plan; null = no plan yet. */
  planFrequency: "weekly" | "monthly" | null;
  /** Autopay (automatic card charges) is active on the plan. */
  planAutopayEnabled: boolean;
  /** Why autopay was turned off (5 known reasons), or null. */
  planAutopayDisabledReason: string | null;
  /** First pending/overdue downpayment installment id (gate trigger), or null. */
  downpaymentInstallmentId: string | null;
  downpaymentAmountCents: number | null;
  timeline: TimelineEventVM[];
  /** Client-facing forms for the current phase (Información tab + forms ring). */
  forms: FormVM[];
  formsDone: number;
  formsTotal: number;
  /** ai-engine generation runs for the case (Cartas / Generaciones tabs). */
  generations: GenerationVM[];
  /** Legal validation attempts (Validación tab — admin, with_lawyer plans). */
  validations: ValidationVM[];
  /** Expediente attempts (Expediente tab — admin). */
  expedientes: ExpedienteVM[];
  /** Read-only docs + forms from already-passed phases (Fases anteriores tab). */
  priorPhases?: PriorPhaseGroupVM[];
  /** Pre-Mortem quality validations. `enabled` gates the tab; targets = validable docs; reports = history. */
  preMortem?: PreMortemVM;
  /** Notes for the "Notas" tab (case notes + originating-lead notes, RLS-filtered). */
  notes?: NoteView[];
}

/** Client-facing view of a document translation (status + result). */
export interface DocumentTranslationView {
  status: "processing" | "completed" | "failed";
  translatedText: string | null;
  /** True once the rendered English PDF is available (preview/download). */
  hasPdf: boolean;
}

/* ---------------------------------------------------------------------------
 * Lex — the case AI chat (staff). Structural mirror of the ai-engine module's
 * Lex contract, REDECLARED here so the feature never imports @/backend (R2).
 * The RSC pages inject the real server actions via the `lex` prop of
 * SharedCaseView; any drift is caught by the page-level typecheck.
 * ------------------------------------------------------------------------ */

/** A citation under a Lex answer: a case chunk (document/form) or a web page. */
export type LexSource =
  | { kind: "chunk"; label: string }
  | { kind: "web"; uri: string; title: string | null };

export interface LexMessageVM {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "running" | "completed" | "failed";
  sources: LexSource[];
  createdAt: string;
}

export interface LexThreadVM {
  threadId: string | null;
  messages: LexMessageVM[];
}

/** The three ai-engine server actions the Lex tab consumes (fixed contract). */
export interface LexActions {
  getLexThread: (caseId: string) => Promise<LexThreadVM>;
  sendLexMessage: (
    caseId: string,
    content: string,
  ) => Promise<{ ok: true; threadId: string; messageId: string } | { ok: false; error: string }>;
  getLexMessageStatus: (messageId: string) => Promise<LexMessageVM | null>;
}

export interface CaseDetailActions {
  /** Add a note to the case with a visibility (general/team/personal). Optional. */
  addNote?: (input: {
    caseId: string;
    body: string;
    visibility: NoteVisibility;
  }) => Promise<{ ok: boolean; note?: NoteView; error?: { code: string } }>;
  /** Delete a note (author or admin). Optional. */
  deleteNote?: (input: { noteId: string }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /** Approve / reject a document (combined reviewDocument verdict). */
  reviewDocument: (input: {
    documentId: string;
    verdict: "approve" | "reject";
    reason?: { es: string; en: string } | null;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /**
   * Rename a document's semantic name (staff only) — fixes a non-fitting name a
   * client typed on a multiple-file slot. Drives the .pdf download filename.
   * Optional — only staff surfaces wire it.
   */
  renameDocument?: (input: {
    caseId: string;
    documentId: string;
    displayName: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /**
   * Register the manual Zelle payment of an installment (gate → active).
   * The proof is MANDATORY (Henry 2026-07-02): upload it first via
   * getZelleProofUploadUrl, then register with the storage path.
   */
  registerPayment: (input: {
    installmentId: string;
    zelleProofPath: string;
    notes?: string | null;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /**
   * Signed upload URL for a staff Zelle proof upload. Optional — only surfaces
   * that authorize payment actions (admin / sales / finance) inject it.
   */
  getZelleProofUploadUrl?: (input: {
    installmentId: string;
    filename: string;
    contentType: string;
  }) => Promise<{ ok: boolean; signedUrl?: string; path?: string; error?: { code: string } }>;
  /** Short-lived signed URL to view a Zelle proof (image/PDF). Optional. */
  getZelleProofViewUrl?: (input: {
    paymentId: string;
  }) => Promise<{ ok: boolean; url?: string; kind?: "image" | "pdf"; error?: { code: string } }>;
  /** Approve a pending Zelle payment (cases:edit — RF-AND-011). Optional. */
  confirmZellePayment?: (input: {
    paymentId: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /** Reject a pending Zelle proof with a mandatory reason. Optional. */
  rejectZelleProof?: (input: {
    paymentId: string;
    reason: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /** Resend the contract signing link (rotates the token). */
  resendSigningLink: (input: {
    contractId: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /**
   * Absolute, shareable signing link for a `sent` contract — lets staff copy the
   * link to send by another channel. Returns CONTRACT_TOKEN_INVALID once signed.
   * Optional — only staff case-detail surfaces inject it.
   */
  getSigningLink?: (input: {
    contractId: string;
  }) => Promise<{ ok: boolean; url?: string; error?: { code: string } }>;
  /** Send a draft contract for signing (draft → sent). */
  sendContract: (input: {
    contractId: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /** Returns a short-lived signed download URL for a document. */
  getDocumentUrl: (input: {
    documentId: string;
  }) => Promise<{ ok: boolean; url?: string; error?: { code: string } }>;
  /**
   * Returns a short-lived signed URL for the ALREADY-generated filled PDF of a
   * form response (read-only; null url when not generated). Used by the
   * "Fases anteriores" tab. Optional — only case-detail surfaces inject it.
   */
  getFilledPdfUrl?: (input: {
    responseId: string;
  }) => Promise<{ ok: boolean; url?: string | null; error?: { code: string } }>;
  /**
   * Generate (or regenerate) the official filled PDF of a form response, returning
   * a signed download URL (Información tab "Generar PDF"). Optional — only staff
   * surfaces that authorize generation inject it (admin / paralegal).
   */
  generateFilledPdf?: (input: {
    responseId: string;
  }) => Promise<{ ok: boolean; downloadUrl?: string; error?: { code: string; details?: Record<string, unknown> } }>;
  /**
   * Verify/approve a SUBMITTED form response (RF-VAN-043 — "Marcar como
   * Verificado" in the Información tab). The server blocks with FORM_INCOMPLETE
   * (+missing list in details) when required fields are unresolved. Optional —
   * staff surfaces with review rights inject it (ventas / legal / admin).
   */
  approveForm?: (input: {
    responseId: string;
  }) => Promise<{ ok: boolean; error?: { code: string; details?: Record<string, unknown> } }>;
  /**
   * Hide/restore an OPTIONAL form for this case (EOIR-26A Fee Waiver). Only admin
   * and sales surfaces inject it — the tab shows the toggle only when present and
   * the form is optional (`!isRequired`). Backed by setFormVisibility.
   */
  toggleFormVisibility?: (input: {
    caseId: string;
    formDefinitionId: string;
    partyId: string | null;
    hidden: boolean;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /**
   * AI-letter generation actions (Generaciones tab — Ola 2). Optional; only staff
   * surfaces that authorize generation inject them.
   */
  getGenerationOutputUrl?: (input: {
    runId: string;
  }) => Promise<{ ok: boolean; url?: string | null; error?: { code: string } }>;
  startLetterGeneration?: (input: {
    caseId: string;
    formDefinitionId: string;
    partyId: string | null;
  }) => Promise<{ ok: boolean; runId?: string; budgetWarning?: string | null; error?: { code: string } }>;
  getRunStatus?: (input: {
    runId: string;
  }) => Promise<{ ok: boolean; status?: string; outputAvailable?: boolean; error?: { code: string } }>;
  /**
   * Enqueue an async Pre-Mortem validation (QStash). Returns the assessmentId
   * the tab polls with getPreMortemStatus. Optional — only case-detail surfaces
   * inject it.
   */
  runPreMortem?: (input: {
    caseId: string;
    target: { kind: PreMortemTargetKind; formDefinitionId: string; refId?: string | null };
  }) => Promise<{ ok: boolean; assessmentId?: string; error?: { code: string } }>;
  /** Poll-safe (read-only): lifecycle status of an enqueued validation. */
  getPreMortemStatus?: (input: {
    assessmentId: string;
  }) => Promise<{ ok: boolean; status?: string; error?: { code: string } }>;
  /** Cancel a QUEUED validation (running ones are already in flight and paid). */
  cancelPreMortem?: (input: {
    assessmentId: string;
  }) => Promise<{ ok: boolean; cancelled?: boolean; error?: { code: string } }>;
  /**
   * Request a translation (ES→EN by default) of an uploaded document into a
   * court-ready English PDF. Enqueues a QStash job; poll with getTranslation.
   * Optional — only staff surfaces wire it.
   */
  translateDocument?: (input: {
    caseId: string;
    caseDocumentId: string;
    direction?: "es-en" | "en-es";
  }) => Promise<{ ok: boolean; translation?: DocumentTranslationView; cached?: boolean; error?: { code: string } }>;
  /**
   * Read the translation status/result for a document (for polling). Optional —
   * only staff surfaces wire it.
   */
  getTranslation?: (input: {
    caseId: string;
    caseDocumentId: string;
    direction?: "es-en" | "en-es";
  }) => Promise<{ ok: boolean; translation?: DocumentTranslationView | null; error?: { code: string } }>;
  /**
   * Returns a short-lived signed download URL for the SIGNED contract PDF.
   * Optional — only admin/staff surfaces wire it; null url when unsigned.
   */
  downloadSignedContract?: (input: {
    caseId: string;
  }) => Promise<{ ok: boolean; url?: string | null; error?: { code: string } }>;
  /**
   * Returns the client's in-app T&C acceptance (signed consent) for a case.
   * Optional — only admin/staff surfaces wire it. accepted=false when pending.
   */
  getTermsAcceptance?: (input: {
    caseId: string;
  }) => Promise<{ ok: boolean; accepted?: boolean; acceptedAt?: string | null; url?: string | null; error?: { code: string } }>;
  /** Start a staff upload (signed PUT URL) for a requirement slot (RF-ADM-008). */
  startUpload: (input: {
    caseId: string;
    requirementId: string | null;
    partyId: string | null;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }) => Promise<{ ok: boolean; signedUrl?: string; uploadRef?: string; error?: { code: string } }>;
  /** Confirm a staff upload after the file is PUT to storage. */
  confirmUpload: (input: {
    caseId: string;
    uploadRef: string;
    requirementId: string | null;
    partyId: string | null;
    originalFilename: string;
    displayName?: string | null;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /**
   * Hide / restore an OPTIONAL document requirement for this case so it stops
   * showing to the client (admin + sales only). Optional — not every surface
   * wires it (e.g. read-only views).
   */
  setRequirementVisibility?: (input: {
    caseId: string;
    requirementId: string | null;
    partyId: string | null;
    hidden: boolean;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /**
   * Edit a case party's legal name (admin only). Updates the live truth and
   * re-syncs the contract snapshot (unless signed → blocked). Optional — only
   * the admin surface injects it.
   */
  updateCaseParty?: (input: {
    caseId: string;
    partyId: string;
    firstName: string;
    lastName: string;
  }) => Promise<{ ok: boolean; resynced?: boolean; error?: { code: string } }>;
  /**
   * Edit the primary client's mailing address (admin + sales). Name/phone/email
   * are immutable identity — only the address may drift (client moved) and it
   * feeds the I-589 prefill. Optional — only surfaces that authorize it inject
   * it; absence renders the address read-only.
   */
  updateClientAddress?: (input: {
    caseId: string;
    line1: string;
    apartment: string | null;
    city: string;
    state: string;
    zip: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /**
   * Advance the case to the next service phase (admin + finance / Andrium — the
   * operations phase boundary that follows printing). Restarts the cycle at the
   * sales stage, or completes the case on the last phase. When several sales
   * owners are eligible the backend answers STAGE_OWNER_REQUIRED with `candidates`
   * so the UI can pick one and retry with `toOwnerId`. Optional: only surfaces
   * that authorize it inject the action; absence hides the affordance.
   */
  advanceCasePhase?: (input: {
    caseId: string;
    toPhaseId?: string | null;
    toOwnerId?: string | null;
    note?: string | null;
  }) => Promise<{
    ok: boolean;
    completed?: boolean;
    phaseIndex?: number;
    phaseCount?: number;
    candidates?: Array<{ userId: string; displayName: string; role: string }>;
    error?: { code: string };
  }>;
  /**
   * Advance the case to the next milestone (admin + paralegal only). Milestones
   * are the progression unit; advancing crosses phases automatically. Optional:
   * only surfaces that authorize it inject the action.
   */
  advanceCaseMilestone?: (input: {
    caseId: string;
    toMilestoneId?: string | null;
    note?: string | null;
  }) => Promise<{ ok: boolean; phaseChanged?: boolean; error?: { code: string } }>;
  /**
   * Add an intermediate cita to this case's current phase (sales + admin). The new
   * cita carries its own objectives and shows up in the route and the client's
   * "Mi proceso" cronograma. Optional — only surfaces that authorize it inject it.
   */
  addCaseAppointment?: (input: {
    caseId: string;
    label?: { es: string; en: string } | null;
    objectives: Array<{ id?: string; text: { es: string; en: string } }>;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /**
   * "Traspasar": advance the case to the next stage + responsible (current owner
   * or admin). Gated by the stage checklist; an admin may `force`. When the next
   * stage has several eligible owners, pass `toOwnerId`. Optional — only staff
   * surfaces inject it.
   */
  transferCase?: (input: {
    caseId: string;
    toOwnerId?: string | null;
    force?: boolean;
    note?: string;
  }) => Promise<{ ok: boolean; stage?: string; ownerId?: string | null; error?: { code: string } }>;
  /**
   * Plan-aware handoff out of the LEGAL stage (Diana): self → Andrium; with_lawyer
   * → the reviewing lawyer. Gated by the 3-task legal checklist. Optional — only the
   * legal/staff case surfaces inject it. Used instead of `transferCase` for legal.
   */
  handoffCaseFromLegal?: (input: {
    caseId: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /**
   * Reassign the responsible within the current stage (admin only). Optional —
   * only the admin surface injects it.
   */
  assignCaseOwner?: (input: {
    caseId: string;
    ownerId: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /**
   * Mark an uploaded document as already-English (excluded from the translation
   * gating) or back. Staff-only — optional, only case-detail surfaces inject it.
   */
  setDocumentTranslationNotRequired?: (input: {
    caseId: string;
    caseDocumentId: string;
    value: boolean;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
}
