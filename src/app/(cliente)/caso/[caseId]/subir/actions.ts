"use server";

/**
 * Document upload server actions (DOC-51 §15, API-CASE-06/07).
 *
 * Thin "use server" wrappers over the cases module-pub use cases. The client
 * view (UploadScreen) calls `startUpload` to get a signed PUT URL, uploads the
 * file directly to storage from the browser, then calls `confirmUpload`. We
 * re-read the documents matrix after confirm so the celebration can show the
 * real phase-progress gain (no client-trusted progress).
 *
 * Boundary R1/R2: app → module-pub (cases/index) only.
 */

import { requireActor } from "@/backend/modules/identity";
import {
  startDocumentUpload,
  confirmDocumentUpload,
  deleteCaseDocument,
  getDocumentsMatrix,
  getDocumentExtractionStatus,
  CaseError,
} from "@/backend/modules/cases";

export interface StartUploadResult {
  ok: boolean;
  signedUrl?: string;
  uploadRef?: string;
  error?: { code: string };
}

export async function startUploadAction(input: {
  caseId: string;
  requirementId: string | null;
  partyId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<StartUploadResult> {
  try {
    const actor = await requireActor();
    const { signedUrl, uploadRef } = await startDocumentUpload(actor, {
      caseId: input.caseId,
      requirementId: input.requirementId,
      partyId: input.partyId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });
    return { ok: true, signedUrl, uploadRef };
  } catch (err) {
    const code = err instanceof CaseError ? err.code : "UNEXPECTED";
    return { ok: false, error: { code } };
  }
}

export interface ConfirmUploadResult {
  ok: boolean;
  /** New phase progress (0–100) and gain since before this upload. */
  progress?: number;
  gain?: number;
  /** The created case_documents id — used by the client to poll AI extraction. */
  caseDocumentId?: string;
  error?: { code: string };
}

export async function confirmUploadAction(input: {
  caseId: string;
  uploadRef: string;
  requirementId: string | null;
  partyId: string | null;
  originalFilename: string;
  /** Client-typed name for multiple/free uploads (ignored for single slots). */
  displayName?: string | null;
  /** Phase progress before the upload (to compute the celebration gain). */
  previousProgress: number;
}): Promise<ConfirmUploadResult> {
  try {
    const actor = await requireActor();
    const doc = await confirmDocumentUpload(actor, {
      caseId: input.caseId,
      uploadRef: input.uploadRef,
      requirementId: input.requirementId,
      partyId: input.partyId,
      originalFilename: input.originalFilename,
      displayName: input.displayName ?? null,
    });
    const matrix = await getDocumentsMatrix(actor, input.caseId);
    const gain = Math.max(0, matrix.progress - input.previousProgress);
    return { ok: true, progress: matrix.progress, gain, caseDocumentId: doc.id };
  } catch (err) {
    const code = err instanceof CaseError ? err.code : "UNEXPECTED";
    return { ok: false, error: { code } };
  }
}

/** Deletes a never-reviewed document the client uploaded (mistake/overwrite). */
export async function deleteDocumentAction(input: {
  caseId: string;
  documentId: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await deleteCaseDocument(actor, input.documentId);
    return { ok: true };
  } catch (err) {
    const code = err instanceof CaseError ? err.code : "UNEXPECTED";
    return { ok: false, error: { code } };
  }
}

/** Poll the AI extraction status + extracted fields for a freshly-uploaded
 *  document (ai_extract requirements). Boundary R1/R2: app → module-pub. */
export interface ExtractionStatusResult {
  ok: boolean;
  status?: "pending" | "completed" | "failed" | null;
  payload?: Record<string, unknown> | null;
  error?: { code: string };
}

export async function getExtractionStatusAction(input: {
  caseDocumentId: string;
}): Promise<ExtractionStatusResult> {
  try {
    const actor = await requireActor();
    const r = await getDocumentExtractionStatus(actor, input.caseDocumentId);
    return { ok: true, status: r.status, payload: r.payload };
  } catch (err) {
    const code = err instanceof CaseError ? err.code : "UNEXPECTED";
    return { ok: false, error: { code } };
  }
}
