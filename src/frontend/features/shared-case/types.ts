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
  status: "pendiente" | "revision" | "aprobado" | "corregir";
  documentId: string | null;
  rejectionReason: string | null;
}

export interface PartyVM {
  id: string;
  name: string;
  role: string;
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

export interface CaseWorkspaceVM {
  header: CaseHeaderVM;
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
}
