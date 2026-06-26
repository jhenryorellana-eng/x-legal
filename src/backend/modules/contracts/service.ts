/**
 * Contracts module — service layer (use cases).
 *
 * Public signing endpoints (getContractForSigning, signContract) do NOT use Actor:
 * they are anonymous (bearer of the signing token). Rate limited via limitSigningTokenIp.
 *
 * @module contracts/service
 */

import { z } from "zod";
import { randomUUID } from "crypto";

import { can, requireCaseAccess, AuthzError } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { appEvents } from "@/backend/platform/events";
import { limitSigningTokenIp } from "@/backend/platform/ratelimit";
import {
  validateUploadedObject,
  createSignedUploadUrl,
  createSignedDownloadUrl,
} from "@/backend/platform/storage";
import { writeAudit, appendCaseTimeline } from "@/backend/modules/audit";
import { jpegDataUrlToPdf } from "./signature-pdf";

import {
  canTransitionContract,
  type ContractStatus,
} from "./domain";
import {
  findContractById,
  findBySigningToken,
  findContractByCaseId,
  findContractByCaseIdService,
  insertContract,
  updateContract,
  getActiveTermsVersion,
  findAcceptance,
  insertAcceptance,
  latestAcceptanceForCaseService,
  type ContractRow,
  type ContractTermsAcceptanceRow,
} from "./repository";

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ContractError extends Error {
  constructor(
    public readonly code:
      | "CONTRACT_NOT_FOUND"
      | "CONTRACT_TOKEN_INVALID"
      | "CONTRACT_INVALID_TRANSITION"
      | "CONTRACT_ALREADY_SIGNED"
      | "TERMS_VERSION_INACTIVE"
      | "SIGNATURE_UPLOAD_FAILED",
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "ContractError";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

async function writeContractTimeline(entry: {
  caseId: string;
  eventType: string;
  actorKind: "client" | "team" | "system";
  actorUserId?: string | null;
  titleI18n: { en: string; es: string };
  visibleToClient: boolean;
}): Promise<void> {
  await appendCaseTimeline({
    caseId: entry.caseId,
    eventType: entry.eventType,
    actorKind: entry.actorKind,
    actorUserId: entry.actorUserId ?? null,
    titleI18n: entry.titleI18n,
    icon: "file-signature",
    color: "blue",
    visibleToClient: entry.visibleToClient,
    occurredAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// createContract — called from cases.createCaseFromContract
// ---------------------------------------------------------------------------

export interface CreateContractInput {
  orgId: string;
  caseId: string | null;
  leadId: string | null;
  serviceId: string;
  servicePlanId: string;
  planSnapshot: Record<string, unknown>;
  partiesSnapshot: Record<string, unknown>;
  createdBy: string;
  termsVersion: string | null;
}

/**
 * Creates a contract in draft status.
 * Called internally by cases.createCaseFromContract.
 *
 * @api-id API-CTR-01 (internal)
 */
export async function createContract(
  input: CreateContractInput,
): Promise<ContractRow> {
  return insertContract({
    org_id: input.orgId,
    case_id: input.caseId,
    lead_id: input.leadId,
    service_id: input.serviceId,
    service_plan_id: input.servicePlanId,
    status: "draft",
    plan_snapshot: input.planSnapshot as unknown as import("@/shared/database.types").Json,
    parties_snapshot: input.partiesSnapshot as unknown as import("@/shared/database.types").Json,
    created_by: input.createdBy,
    terms_version: input.termsVersion,
    signing_token: null,
    signing_expires_at: null,
    signed_at: null,
    signed_ip: null,
    signature_image_path: null,
    signed_pdf_path: null,
  });
}

// ---------------------------------------------------------------------------
// resyncPartiesSnapshot — refresh the informational parties snapshot
// ---------------------------------------------------------------------------

/**
 * Re-writes a contract's `parties_snapshot` from the live case parties (built
 * by the cases module and passed in). No-op when there is no contract or when
 * the contract is already `signed` — a signed contract is an immutable legal
 * record and its snapshot is the signed photo. Returns whether it changed.
 *
 * Authorization mirrors other contract mutations: governed by cases:edit +
 * case access (the caller — cases.updateCaseParty — is already admin-gated).
 *
 * @api-id (internal) called by cases.updateCaseParty
 */
export async function resyncPartiesSnapshot(
  actor: Actor,
  caseId: string,
  partiesSnapshot: Record<string, unknown>,
): Promise<{ resynced: boolean }> {
  can(actor, "cases", "edit");
  await requireCaseAccess(actor, caseId);

  const contract = await findContractByCaseId(caseId);
  if (!contract) return { resynced: false };
  if (contract.status === "signed") return { resynced: false };

  await updateContract(contract.id, {
    parties_snapshot: partiesSnapshot as unknown as import("@/shared/database.types").Json,
  });
  return { resynced: true };
}

/**
 * Re-writes a contract's frozen `document_snapshot` (the bilingual assembled
 * document the signing page renders) from a freshly assembled snapshot built by
 * the cases module. No-op when there is no contract or it is already `signed`
 * (immutable). Keeps the rendered contract in sync with pre-signature party edits.
 *
 * @api-id (internal) called by cases.updateCaseParty
 */
export async function resyncDocumentSnapshot(
  actor: Actor,
  caseId: string,
  documentSnapshot: Record<string, unknown>,
): Promise<{ resynced: boolean }> {
  can(actor, "cases", "edit");
  await requireCaseAccess(actor, caseId);

  const contract = await findContractByCaseId(caseId);
  if (!contract) return { resynced: false };
  if (contract.status === "signed") return { resynced: false };

  await updateContract(contract.id, {
    document_snapshot: documentSnapshot as unknown as import("@/shared/database.types").Json,
  });
  return { resynced: true };
}

// ---------------------------------------------------------------------------
// sendContractForSigning — draft → sent
// ---------------------------------------------------------------------------

/**
 * Generates a signing token and moves contract from draft → sent.
 * Emits contract.sent event (consumed by notifications for SMS/email).
 *
 * @api-id API-CTR-02
 */
export async function sendContractForSigning(
  actor: Actor,
  contractId: string,
): Promise<void> {
  can(actor, "cases", "edit");

  const contract = await findContractById(contractId);
  if (!contract) throw new ContractError("CONTRACT_NOT_FOUND");

  const err = canTransitionContract(
    contract.status as ContractStatus,
    "sent",
  );
  if (err) throw new ContractError("CONTRACT_INVALID_TRANSITION");

  const token = randomUUID();
  const expiresAt = addDays(new Date(), 14);

  await updateContract(contractId, {
    status: "sent",
    signing_token: token,
    signing_expires_at: expiresAt.toISOString(),
  });

  await appEvents.emitAndWait({
    type: "contract.sent",
    payload: { contractId, caseId: contract.case_id, signingToken: token },
    occurredAt: new Date(),
  });

  if (contract.case_id) {
    await writeContractTimeline({
      caseId: contract.case_id,
      eventType: "contract.sent",
      actorKind: "team",
      actorUserId: actor.userId,
      titleI18n: { en: "Contract sent for signing", es: "Contrato enviado para firma" },
      visibleToClient: true,
    });
  }

  await writeAudit(actor, "contract.sent", "contracts", contractId, {
    after: { status: "sent" },
  });
}

// ---------------------------------------------------------------------------
// cancelContractSending — sent → draft (invalidate token)
// ---------------------------------------------------------------------------

/**
 * Cancels a pending signing. Moves sent → draft and nulls the token.
 *
 * @api-id API-CTR-03
 */
export async function cancelContractSending(
  actor: Actor,
  contractId: string,
): Promise<void> {
  can(actor, "cases", "edit");

  const contract = await findContractById(contractId);
  if (!contract) throw new ContractError("CONTRACT_NOT_FOUND");

  const err = canTransitionContract(
    contract.status as ContractStatus,
    "draft",
  );
  if (err) throw new ContractError("CONTRACT_INVALID_TRANSITION");

  await updateContract(contractId, {
    status: "draft",
    signing_token: null,
    signing_expires_at: null,
  });

  await writeAudit(actor, "contract.sending_cancelled", "contracts", contractId, {
    after: { status: "draft" },
  });
}

// ---------------------------------------------------------------------------
// resendSigningLink — rotate token + reset expiry
// ---------------------------------------------------------------------------

/**
 * Rotates the signing token and resets the 14-day expiration.
 *
 * @api-id API-CTR-04
 */
export async function resendSigningLink(
  actor: Actor,
  contractId: string,
): Promise<void> {
  can(actor, "cases", "edit");

  const contract = await findContractById(contractId);
  if (!contract) throw new ContractError("CONTRACT_NOT_FOUND");

  if (contract.status !== "sent") {
    throw new ContractError("CONTRACT_INVALID_TRANSITION");
  }

  const newToken = randomUUID();
  const expiresAt = addDays(new Date(), 14);

  await updateContract(contractId, {
    signing_token: newToken,
    signing_expires_at: expiresAt.toISOString(),
  });

  await appEvents.emitAndWait({
    type: "contract.sent",
    payload: { contractId, caseId: contract.case_id, signingToken: newToken },
    occurredAt: new Date(),
  });

  await writeAudit(actor, "contract.link_resent", "contracts", contractId, {
    after: { tokenRotated: true },
  });
}

// ---------------------------------------------------------------------------
// getContractBySigningToken — PUBLIC (anonymous bearer)
// ---------------------------------------------------------------------------

export interface ContractSigningView {
  contractId: string;
  planSnapshot: Record<string, unknown>;
  partiesSnapshot: Record<string, unknown>;
  /** Frozen bilingual assembled document ({es,en}); null for legacy contracts. */
  documentSnapshot: Record<string, unknown> | null;
  termsVersion: string | null;
}

/**
 * Returns minimal contract data for the anonymous signing page.
 *
 * PUBLIC ENDPOINT — no Actor required. Token is the only credential.
 * Rate limited via limitSigningTokenIp (DOC-22 §1.6).
 *
 * @api-id API-CTR-05 (GET /api/v1/contracts/sign/[token])
 */
export async function getContractBySigningToken(
  token: string,
  ip: string,
): Promise<ContractSigningView> {
  await limitSigningTokenIp(ip);

  const contract = await findBySigningToken(token);
  // Uniform 404 for not found / expired / consumed (anti-enumeration, DOC-22 §4)
  if (!contract) throw new ContractError("CONTRACT_TOKEN_INVALID");

  return {
    contractId: contract.id,
    planSnapshot: contract.plan_snapshot as Record<string, unknown>,
    partiesSnapshot: contract.parties_snapshot as Record<string, unknown>,
    documentSnapshot: (contract.document_snapshot ?? null) as Record<string, unknown> | null,
    termsVersion: contract.terms_version,
  };
}

// ---------------------------------------------------------------------------
// signContract — PUBLIC (anonymous bearer)
// ---------------------------------------------------------------------------

const SignContractSchema = z.object({
  signatureUploadRef: z.string().min(1),
  ip: z.string().nullable().optional(),
});

export type SignContractInput = z.infer<typeof SignContractSchema>;

/**
 * Records the contract signature and transitions to signed.
 *
 * PUBLIC ENDPOINT — no Actor required. Single-use token: nulled in same update.
 * Rate limited via limitSigningTokenIp (DOC-22 §1.6).
 *
 * @api-id API-CTR-06 (POST /api/v1/contracts/sign/[token])
 */
export async function signContract(
  token: string,
  input: SignContractInput,
  opts: { skipRateLimit?: boolean; skipValidation?: boolean } = {},
): Promise<{ caseId: string | null }> {
  // Skip when called as a subroutine of signContractFromImage, which already
  // spent a rate-limit token on this request (avoid double-counting).
  if (!opts.skipRateLimit) await limitSigningTokenIp(input.ip ?? "unknown");

  const parsed = SignContractSchema.parse(input);

  const contract = await findBySigningToken(token);
  if (!contract) throw new ContractError("CONTRACT_TOKEN_INVALID");

  // Validate the uploaded signature artifact (skipped when the caller already
  // generated + uploaded it server-side — signContractFromImage).
  if (!opts.skipValidation) {
    const validated = await validateUploadedObject(
      "contracts",
      parsed.signatureUploadRef,
      "contracts",
    );
    if (!validated.ok) {
      throw new ContractError("SIGNATURE_UPLOAD_FAILED");
    }
  }

  // Single-use: set signing_token=null in the same update as status=signed.
  // signature_image_path is the raw signature image; the full assembled contract
  // PDF (signed_pdf_path) is rendered LAZILY on the first admin download so the
  // client's "Firmar" action stays fast (no synchronous mupdf render here).
  await updateContract(contract.id, {
    status: "signed",
    signed_at: new Date().toISOString(),
    signed_ip: parsed.ip as unknown,
    signature_image_path: parsed.signatureUploadRef,
    signing_token: null,  // single-use invalidation
  });

  await appEvents.emitAndWait({
    type: "contract.signed",
    payload: { contractId: contract.id, caseId: contract.case_id },
    occurredAt: new Date(),
  });

  if (contract.case_id) {
    await writeContractTimeline({
      caseId: contract.case_id,
      eventType: "contract.signed",
      actorKind: "client",
      actorUserId: null, // anonymous signer
      titleI18n: { en: "Contract signed", es: "Contrato firmado" },
      visibleToClient: true,
    });
  }

  return { caseId: contract.case_id };
}

// ---------------------------------------------------------------------------
// signContractFromImage — PUBLIC (anonymous bearer)
// ---------------------------------------------------------------------------

/**
 * Signs a contract from a signature image data URL (the public signing page).
 *
 * FAST PATH: stores the signature IMAGE (JPEG/PNG) in the contracts bucket and
 * marks the contract signed. The full assembled contract PDF (with the signature
 * embedded) is rendered LAZILY on the first admin download — so the client's
 * "Firmar" action never waits on the (heavy) mupdf render.
 *
 * PUBLIC ENDPOINT — no Actor. Rate limited via limitSigningTokenIp (once here;
 * signContract is told to skip its own limit).
 *
 * @api-id API-CTR-06 (image variant)
 */
export async function signContractFromImage(
  token: string,
  /** Image data URL — the client re-encodes the SignaturePad PNG to JPEG. */
  signatureJpegDataUrl: string,
  ip: string,
): Promise<{ caseId: string | null }> {
  await limitSigningTokenIp(ip);

  const contract = await findBySigningToken(token);
  if (!contract) throw new ContractError("CONTRACT_TOKEN_INVALID");

  // Store the raw signature IMAGE (contracts bucket allows image/jpeg|png) so it
  // can be embedded in the contract PDF on demand. Trusted server-side upload →
  // signContract skips re-validation.
  const { bytes, mime, ext } = decodeImageDataUrl(signatureJpegDataUrl);
  const signatureUploadRef = await uploadContractObject(
    `signatures/${token}-${Date.now()}.${ext}`,
    bytes,
    mime,
  );

  return signContract(token, { signatureUploadRef, ip }, { skipRateLimit: true, skipValidation: true });
}

/** Decodes a base64 image data URL into bytes + mime + file extension. */
function decodeImageDataUrl(dataUrl: string): { bytes: Buffer; mime: string; ext: string } {
  const m = /^data:(image\/(png|jpeg|jpg));base64,(.*)$/i.exec(dataUrl);
  const mime = m ? m[1].toLowerCase() : "image/jpeg";
  const b64 = m ? m[3] : dataUrl.slice(dataUrl.indexOf(",") + 1);
  const ext = mime.includes("png") ? "png" : "jpg";
  return { bytes: Buffer.from(b64, "base64"), mime, ext };
}

/** Uploads bytes to the contracts bucket at `path` with the given content-type. */
async function uploadContractObject(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const { signedUrl, path: uploadRef } = await createSignedUploadUrl("contracts", path);
  const putRes = await fetch(signedUrl, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: bytes as unknown as BodyInit,
  });
  if (!putRes.ok) throw new ContractError("SIGNATURE_UPLOAD_FAILED");
  return uploadRef;
}

// ---------------------------------------------------------------------------
// createContractAndSend — staff (creates draft → sent, returns token)
// ---------------------------------------------------------------------------

/**
 * Creates a contract and immediately sends it for signing, returning the fresh
 * signing token (so the admin "Nuevo caso" modal can show the link to copy).
 *
 * @api-id API-CTR-01 + API-CTR-02 (combined)
 */
export async function createContractAndSend(
  actor: Actor,
  input: CreateContractInput,
): Promise<{ contractId: string; signingToken: string }> {
  can(actor, "cases", "edit");
  const contract = await createContract(input);
  await sendContractForSigning(actor, contract.id);
  const sent = await findContractById(contract.id);
  const token = sent?.signing_token;
  if (!token) throw new ContractError("CONTRACT_TOKEN_INVALID");
  return { contractId: contract.id, signingToken: token };
}

// ---------------------------------------------------------------------------
// acceptTermsInApp — client only
// ---------------------------------------------------------------------------

const AcceptTermsSchema = z.object({
  caseId: z.string().uuid(),
  signatureUploadRef: z.string().min(1),
  ip: z.string().nullable().optional(),
});

export type AcceptTermsInput = z.infer<typeof AcceptTermsSchema>;

/**
 * Records client acceptance of the active Terms & Conditions.
 *
 * Idempotent: returns existing acceptance if already accepted.
 *
 * @api-id API-CTR-07
 */
export async function acceptTermsInApp(
  actor: Actor,
  input: AcceptTermsInput,
): Promise<ContractTermsAcceptanceRow> {
  await requireCaseAccess(actor, input.caseId);
  if (actor.kind !== "client") throw new AuthzError("wrong_kind");

  const parsed = AcceptTermsSchema.parse(input);

  const activeTerms = await getActiveTermsVersion(actor.orgId);
  if (!activeTerms) throw new ContractError("TERMS_VERSION_INACTIVE");

  // Idempotent: return existing acceptance
  const existing = await findAcceptance(
    parsed.caseId,
    actor.userId,
    activeTerms.version,
  );
  if (existing) return existing;

  // Validate signature upload
  const validated = await validateUploadedObject(
    "contracts",
    parsed.signatureUploadRef,
    "contracts",
  );
  if (!validated.ok) {
    throw new ContractError("SIGNATURE_UPLOAD_FAILED");
  }

  const acceptance = await insertAcceptance({
    caseId: parsed.caseId,
    userId: actor.userId,
    termsVersion: activeTerms.version,
    signatureImagePath: parsed.signatureUploadRef,
    ip: parsed.ip ?? null,
    acceptedAt: new Date().toISOString(),
  });

  await writeContractTimeline({
    caseId: parsed.caseId,
    eventType: "terms.accepted",
    actorKind: "client",
    actorUserId: actor.userId,
    titleI18n: { en: "Terms accepted", es: "Términos aceptados" },
    visibleToClient: true,
  });

  return acceptance;
}

/**
 * Accepts the active Terms in-app from a SignaturePad image (DOC-51 §12).
 *
 * Mirrors signContractFromImage: wraps the JPEG into a minimal PDF (contracts
 * bucket is PDF-only), uploads it via a signed URL, then records the acceptance.
 * Keeps the PDF/storage concern inside the module (the app action stays thin and
 * boundary-clean: app → module-pub only).
 *
 * @api-id API-CASE-12 + API-CTR-06 (combined client convenience)
 */
export async function acceptTermsFromImage(
  actor: Actor,
  input: { caseId: string; signatureJpegDataUrl: string; ip: string | null },
): Promise<ContractTermsAcceptanceRow> {
  await requireCaseAccess(actor, input.caseId);
  if (actor.kind !== "client") throw new AuthzError("wrong_kind");

  const pdfBytes = jpegDataUrlToPdf(input.signatureJpegDataUrl);
  const path = `signatures/${input.caseId}-${actor.userId}-${Date.now()}.pdf`;
  const { signedUrl, path: uploadRef } = await createSignedUploadUrl(
    "contracts",
    path,
  );

  const putRes = await fetch(signedUrl, {
    method: "PUT",
    headers: { "content-type": "application/pdf" },
    body: pdfBytes as unknown as BodyInit,
  });
  if (!putRes.ok) {
    throw new ContractError("SIGNATURE_UPLOAD_FAILED");
  }

  return acceptTermsInApp(actor, {
    caseId: input.caseId,
    signatureUploadRef: uploadRef,
    ip: input.ip,
  });
}

// ---------------------------------------------------------------------------
// Read: getTermsStatusForCase (disclaimer guard — DOC-51 §12, API-CASE-11)
// ---------------------------------------------------------------------------

export interface TermsStatusView {
  /** True when the client already accepted the org's active terms for this case. */
  alreadyAccepted: boolean;
  /** The active terms version content (null when none is published). */
  terms: {
    version: string;
    titleI18n: { en: string; es: string };
    bodyMdI18n: { en: string; es: string };
  } | null;
}

/**
 * Resolves whether the client has accepted the org's active Terms for this case
 * and returns the active terms content (read-only). Used to gate the disclaimer.
 *
 * @api-id API-CASE-11 (TermsStatusDto)
 */
export async function getTermsStatusForCase(
  actor: Actor,
  caseId: string,
): Promise<TermsStatusView> {
  await requireCaseAccess(actor, caseId);
  const activeTerms = await getActiveTermsVersion(actor.orgId);
  if (!activeTerms) return { alreadyAccepted: false, terms: null };

  const existing = await findAcceptance(caseId, actor.userId, activeTerms.version);

  const toI18n = (v: unknown): { en: string; es: string } => {
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return { en: String(o.en ?? o.es ?? ""), es: String(o.es ?? o.en ?? "") };
    }
    return { en: "", es: "" };
  };

  // The repo's TermsVersionRow interface predates the i18n columns; the actual
  // terms_versions row carries title_i18n / body_md_i18n (see database.types).
  const termsRow = activeTerms as unknown as Record<string, unknown>;

  return {
    alreadyAccepted: existing != null,
    terms: {
      version: activeTerms.version,
      titleI18n: toI18n(termsRow["title_i18n"]),
      bodyMdI18n: toI18n(termsRow["body_md_i18n"]),
    },
  };
}

// ---------------------------------------------------------------------------
// Read: getContractForCase
// ---------------------------------------------------------------------------

/**
 * Returns the contract for a specific case.
 *
 * @api-id API-CTR-08
 */
export async function getContractForCase(
  actor: Actor,
  caseId: string,
): Promise<ContractRow | null> {
  await requireCaseAccess(actor, caseId);
  return findContractByCaseId(caseId);
}

/**
 * Returns a short-lived signed download URL for a case's SIGNED contract PDF
 * (the full assembled document with the embedded signature). Null when unsigned.
 *
 * The PDF is rendered LAZILY: on the first call after signing it assembles the
 * frozen document_snapshot + the stored signature image into a PDF (mupdf),
 * caches it at signed_pdf_path, and serves it; later calls return the cached one.
 * This keeps the client's signing fast — the heavy render happens here, once.
 *
 * @api-id API-CTR-10
 */
export async function getSignedContractDownloadUrl(
  actor: Actor,
  caseId: string,
): Promise<string | null> {
  await requireCaseAccess(actor, caseId);
  const row = await findContractByCaseId(caseId);
  if (!row || row.status !== "signed") return null;

  // Cached on a previous download.
  if (row.signed_pdf_path) return createSignedDownloadUrl("contracts", row.signed_pdf_path);

  // Lazy render from the frozen bilingual document + the signature image.
  const docSnap = row.document_snapshot as
    | { es?: import("./contract-document").ContractDocument; en?: import("./contract-document").ContractDocument }
    | null;
  const doc = docSnap?.es ?? docSnap?.en ?? null;
  if (!doc) return null;

  let signatureImageDataUrl: string | undefined;
  if (row.signature_image_path) {
    try {
      const sigUrl = await createSignedDownloadUrl("contracts", row.signature_image_path);
      const resp = await fetch(sigUrl);
      if (resp.ok) {
        const ct = resp.headers.get("content-type") ?? "image/jpeg";
        // Only embed actual images (signatures stored as image/*); skip legacy PDFs.
        if (ct.startsWith("image/")) {
          const buf = Buffer.from(await resp.arrayBuffer());
          signatureImageDataUrl = `data:${ct};base64,${buf.toString("base64")}`;
        }
      }
    } catch {
      // Render without the embedded image if the signature fetch fails.
    }
  }

  const { renderContractPdf } = await import("./contract-pdf");
  const pdf = await renderContractPdf(doc, {
    signatureImageDataUrl,
    signedOnLabel: row.signed_at ? `Firmado el ${row.signed_at.slice(0, 10)}` : null,
  });
  const uploadRef = await uploadContractObject(`signed/${row.id}.pdf`, pdf, "application/pdf");
  await updateContract(row.id, { signed_pdf_path: uploadRef });
  return createSignedDownloadUrl("contracts", uploadRef);
}

/** The client's in-app T&C acceptance for a case (DOC-51 §12), for the admin. */
export interface TermsAcceptanceView {
  acceptedAt: string;
  termsVersion: string;
  /** Short-lived signed URL for the acceptance signature (PDF), or null. */
  signatureDownloadUrl: string | null;
}

/**
 * Returns the latest in-app Terms acceptance for a case (signature + date),
 * with a short-lived download URL for the signed acceptance. Null when the
 * client has not accepted yet. Authorizes via case access (staff allowed).
 *
 * @api-id API-CTR-11
 */
export async function getTermsAcceptanceForCase(
  actor: Actor,
  caseId: string,
): Promise<TermsAcceptanceView | null> {
  await requireCaseAccess(actor, caseId);
  const row = await latestAcceptanceForCaseService(caseId);
  if (!row) return null;
  const signatureDownloadUrl = row.signature_image_path
    ? await createSignedDownloadUrl("contracts", row.signature_image_path)
    : null;
  return {
    acceptedAt: row.accepted_at,
    termsVersion: row.terms_version,
    signatureDownloadUrl,
  };
}

/** Onboarding-relevant contract fields for the client dashboard card. */
export interface CaseOnboardingContract {
  /** Contract state machine: 'draft' | 'sent' | 'signed' | 'cancelled'. */
  status: string;
  /** Public signing token (/firma/{token}) — present while status='sent'. */
  signingToken: string | null;
}

/**
 * Returns the onboarding-relevant contract fields (status + signing token) for a
 * case the actor is a member of. Drives the client dashboard's "sign → pay"
 * onboarding card (`/home`).
 *
 * Authorizes via requireCaseAccess (the actor must be a case member), then reads
 * with the SERVICE client — the `contracts` table has no client RLS SELECT policy,
 * so a client-context read would return null. The membership check is the
 * authorization gate. The signing token is safe to surface to the case's own
 * client: they are the intended signer (it already reaches them via the
 * contract.sent notification + email).
 *
 * @api-id API-CTR-09
 */
export async function getCaseOnboardingContract(
  actor: Actor,
  caseId: string,
): Promise<CaseOnboardingContract | null> {
  await requireCaseAccess(actor, caseId);
  const row = await findContractByCaseIdService(caseId);
  if (!row) return null;
  return { status: row.status, signingToken: row.signing_token };
}

/**
 * Returns the signing_token for a given contract (after sendContractForSigning).
 * Used by createCaseAction to hand back the token to the modal.
 *
 * @api-id API-CTR-02 (signing token read-back)
 */
export async function getSigningTokenForContract(
  actor: Actor,
  contractId: string,
): Promise<string | null> {
  can(actor, "cases", "view");
  const row = await findContractById(contractId);
  return row?.signing_token ?? null;
}
