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
  insertContract,
  updateContract,
  getActiveTermsVersion,
  findAcceptance,
  insertAcceptance,
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
      | "TERMS_VERSION_INACTIVE",
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

  appEvents.emit({
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

  appEvents.emit({
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
): Promise<{ caseId: string | null }> {
  await limitSigningTokenIp(input.ip ?? "unknown");

  const parsed = SignContractSchema.parse(input);

  const contract = await findBySigningToken(token);
  if (!contract) throw new ContractError("CONTRACT_TOKEN_INVALID");

  // Validate the uploaded signature image
  const validated = await validateUploadedObject(
    "contracts",
    parsed.signatureUploadRef,
    "contracts",
  );
  if (!validated.ok) {
    throw new ContractError("CONTRACT_TOKEN_INVALID");
  }

  // Single-use: set signing_token=null in the same update as status=signed
  await updateContract(contract.id, {
    status: "signed",
    signed_at: new Date().toISOString(),
    signed_ip: parsed.ip as unknown,
    signature_image_path: parsed.signatureUploadRef,
    signing_token: null,  // single-use invalidation
  });

  appEvents.emit({
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
 * The `contracts` bucket is PDF-only and signContract validates PDF magic
 * bytes; the signature is wrapped into a minimal one-page PDF here (the module
 * owns platform/storage). The signature image is the legal artifact stored at
 * `contracts/signatures/{token}-{ts}.pdf`.
 *
 * PUBLIC ENDPOINT — no Actor. Rate limited via limitSigningTokenIp.
 *
 * @api-id API-CTR-06 (image variant)
 */
export async function signContractFromImage(
  token: string,
  /** JPEG data URL — the client re-encodes the SignaturePad PNG to JPEG. */
  signatureJpegDataUrl: string,
  ip: string,
): Promise<{ caseId: string | null }> {
  await limitSigningTokenIp(ip);

  // Wrap the JPEG into a minimal PDF and upload it to the contracts bucket.
  const pdfBytes = jpegDataUrlToPdf(signatureJpegDataUrl);
  const path = `signatures/${token}-${Date.now()}.pdf`;
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
    throw new ContractError("CONTRACT_TOKEN_INVALID");
  }

  return signContract(token, { signatureUploadRef: uploadRef, ip });
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
    throw new ContractError("TERMS_VERSION_INACTIVE"); // repurpose for signature missing
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
    throw new ContractError("TERMS_VERSION_INACTIVE"); // repurpose for upload failure
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
