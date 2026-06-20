/**
 * shared-case view model + action types (DOC-50 §4).
 *
 * The RSC page assembles `CaseWorkspaceVM` from the cases/billing/contracts
 * module reads and injects the server actions. The feature is presentational +
 * data-driven over this VM — no module imports here (R2).
 */

import type { StatusKind } from "@/frontend/components/brand/status-pill";

export type CaseTabId = "resumen" | "documentos" | "partes" | "mensajes";

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
  /** Contract status (for "resend signing link" availability). */
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

export interface CaseWorkspaceVM {
  header: CaseHeaderVM;
  documents: DocumentVM[];
  parties: PartyVM[];
  installments: InstallmentVM[];
  /** First pending/overdue downpayment installment id (gate trigger), or null. */
  downpaymentInstallmentId: string | null;
  downpaymentAmountCents: number | null;
  timeline: TimelineEventVM[];
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
  /** Returns a short-lived signed download URL for a document. */
  getDocumentUrl: (input: {
    documentId: string;
  }) => Promise<{ ok: boolean; url?: string; error?: { code: string } }>;
}
