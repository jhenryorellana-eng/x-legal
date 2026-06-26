/**
 * shared-case view model + action types (DOC-50 §4, DOC-52/53).
 *
 * The RSC page assembles `CaseWorkspaceVM` from the cases/billing/contracts
 * module reads and injects the server actions. The feature is presentational +
 * data-driven over this VM — no module imports here (R2).
 */

import type { StatusKind } from "@/frontend/components/brand/status-pill";

/**
 * Canonical tab ids. The role decides WHICH subset renders and with what label
 * (Vanessa vs Henry differ in label/order, not in the underlying id) — see
 * build-tabs.ts. `cartas`/`generaciones` are the two ai-letter surfaces
 * (asesora vs admin) and stay distinct ids.
 */
export type CaseTabId =
  | "resumen"
  | "contrato"
  | "citas"
  | "documentos"
  | "formularios"
  | "cartas"
  | "generaciones"
  | "traspaso"
  | "historial"
  | "pagos"
  | "expediente"
  | "validacion"
  | "mensajes";

export type StaffRoleVM = "sales" | "paralegal" | "finance" | "admin";

export interface CaseHeaderVM {
  caseId: string;
  caseNumber: string;
  clientName: string;
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
}

export interface PartyVM {
  id: string;
  name: string;
  role: string;
  /** Legal name parts for admin edit prefill (optional — not every surface fills them). */
  firstName?: string | null;
  lastName?: string | null;
}

export interface InstallmentVM {
  id: string;
  number: number;
  amountCents: number;
  status: string;
  isDownpayment: boolean;
  dueDate: string | null;
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
  id: string;
  label: string;
  /** null = not started yet. */
  status: string | null;
  partyId: string | null;
  partyName: string | null;
}

export interface GenerationVM {
  id: string;
  /** Resolved form label (or "—" when not in the client forms set). */
  formLabel: string;
  /** queued | running | completed | failed | cancelled. */
  status: string;
  version: number;
  costUsd: number | null;
  isCurrent: boolean;
  partyName: string | null;
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

export interface CaseWorkspaceVM {
  header: CaseHeaderVM;
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
  installments: InstallmentVM[];
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
}

export interface CaseDetailActions {
  /** Approve / reject a document (combined reviewDocument verdict). */
  reviewDocument: (input: {
    documentId: string;
    verdict: "approve" | "reject";
    reason?: { es: string; en: string } | null;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /** Register the manual Zelle payment of an installment (gate → active). */
  registerPayment: (input: {
    installmentId: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /** Resend the contract signing link (rotates the token). */
  resendSigningLink: (input: {
    contractId: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /** Send a draft contract for signing (draft → sent). */
  sendContract: (input: {
    contractId: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  /** Returns a short-lived signed download URL for a document. */
  getDocumentUrl: (input: {
    documentId: string;
  }) => Promise<{ ok: boolean; url?: string; error?: { code: string } }>;
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
   * Advance the case to the next service phase (admin + paralegal only). Manual,
   * staff-driven — the within-phase % is automatic. Optional: only surfaces that
   * authorize it inject the action; absence hides the affordance.
   */
  advanceCasePhase?: (input: {
    caseId: string;
    toPhaseId?: string | null;
    note?: string | null;
  }) => Promise<{ ok: boolean; phaseIndex?: number; phaseCount?: number; error?: { code: string } }>;
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
}
