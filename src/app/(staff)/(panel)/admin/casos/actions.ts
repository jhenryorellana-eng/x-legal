"use server";

/**
 * Admin casos server actions (DOC-53 §2/§3).
 *
 * Thin "use server" wrappers over the cases / billing / contracts module-pub
 * use cases, normalized to a small result envelope for the client views.
 * Each action builds the Actor (requireActor) and delegates; the services
 * already authorize with can(...). Boundary R1/R2: app → module-pub only.
 *
 * createCaseAction — FULL H-2 FLOW (API-CASE-13, API-AUT-16, API-CTR-01):
 *   Step 1: identity.provisionClientUser  → userId
 *   Step 2: cases.createCaseFromContract  → { caseId, contractId }
 *   Step 3: contracts.sendContractForSigning → signingToken
 *
 * The UI modal (new-case-modal.tsx) is NOT changed. The return shape adds
 * `caseId` (was absent before) — compatible because callers check `ok` first.
 */

import { requireActor, provisionClientUser, normalizePhoneE164, AuthzError } from "@/backend/modules/identity";
import {
  sendContractForSigning,
  resendSigningLink,
  getSigningTokenForContract,
  ContractError,
} from "@/backend/modules/contracts";
import {
  registerZellePayment,
  BillingError,
} from "@/backend/modules/billing";
import {
  createCaseFromContract,
  reviewDocument,
  getCaseDocumentDownloadUrl,
  CaseError,
} from "@/backend/modules/cases";

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: { code: string; message?: string } };

function mapErr(err: unknown): Err {
  if (err instanceof AuthzError) return { ok: false, error: { code: err.reason } };
  if (err instanceof ContractError || err instanceof BillingError || err instanceof CaseError) {
    return { ok: false, error: { code: err.code } };
  }
  // Unexpected (non-domain) errors: surface server-side for observability.
  // Domain errors already carry a stable code to the client.
  console.error("[casos action] unexpected error:", err);
  return { ok: false, error: { code: "internal" } };
}

// ---------------------------------------------------------------------------
// createCaseAction — "Nuevo caso" full H-2 flow
// ---------------------------------------------------------------------------

export interface CreateCaseUiInput {
  clientName: string;
  clientPhone: string;
  /**
   * Encoded plan resolution: serviceId|planId|priceCents|downCents|installments.
   * Matches the encoding used by the plan selector in new-case-modal.tsx.
   */
  serviceId: string;
  planKind: "self" | "with_lawyer";
  parties: { name: string; role: string }[];
}

/**
 * Orchestrates the full "Nuevo caso" modal flow (DOC-41 §3.1, DOC-22 §1.2 H-2):
 *
 *   1. Provision client user (idempotent by phone — DOC-22 §1.2)
 *   2. Create case + contract + payment plan (idempotent by contractId)
 *   3. Send contract for signing → signingToken
 *
 * Returns { ok: true, signingToken, caseId } on success.
 *
 * @api-id API-CASE-13 (creates case) + API-AUT-16 (provisions client) + API-CTR-01 (send)
 */
export async function createCaseAction(
  input: CreateCaseUiInput,
): Promise<Ok<{ signingToken: string; caseId: string }> | Err> {
  try {
    const actor = await requireActor();

    // Parse the encoded serviceId field from the modal selector
    const [serviceId, planId, priceStr, downStr, instStr] = input.serviceId.split("|");
    const priceCents = Number(priceStr);
    const downCents = Number(downStr);
    const installments = Number(instStr);

    // M-3 FIX: fail fast if any numeric plan field is NaN or non-positive.
    // `Number(x) || 0` masked malformed input and could produce zero-value contracts.
    if (
      !Number.isFinite(priceCents) || priceCents <= 0 ||
      !Number.isFinite(downCents) || downCents <= 0 ||
      !Number.isFinite(installments) || installments <= 0 ||
      !Number.isInteger(installments)
    ) {
      return { ok: false, error: { code: "INVALID_PLAN" } };
    }

    // Normalize phone to E.164 (same algorithm as gate and SQL normalize_phone)
    let phoneE164: string;
    try {
      phoneE164 = normalizePhoneE164(input.clientPhone);
    } catch {
      return { ok: false, error: { code: "INVALID_PHONE" } };
    }

    // Step 1: Provision client user (idempotent — phone_e164 UNIQUE)
    const { userId } = await provisionClientUser(actor, {
      fullName: input.clientName,
      phoneE164,
    });

    // Map modal parties to the cases module input shape
    const parties = input.parties.map((p) => {
      const spaceIdx = p.name.trim().indexOf(" ");
      const firstName = spaceIdx >= 0 ? p.name.trim().slice(0, spaceIdx) : p.name.trim();
      const lastName = spaceIdx >= 0 ? p.name.trim().slice(spaceIdx + 1).trim() : "";
      return {
        role: p.role,
        person: { firstName, lastName },
      };
    });

    // Step 2: Create case + contract + payment plan (all in one orchestrated call)
    const { caseId, contractId } = await createCaseFromContract(actor, {
      primaryClientId: userId,
      serviceId,
      servicePlanId: planId,
      parties,
      paymentPlan: {
        totalCents: priceCents,
        downpaymentCents: downCents,
        installmentCount: installments,
      },
    });

    // Step 3: Send contract for signing (draft → sent, generates token)
    await sendContractForSigning(actor, contractId);

    // Read back the token (sendContractForSigning sets it on the contract row)
    const signingToken = await getSigningTokenForContract(actor, contractId);
    if (!signingToken) {
      return { ok: false, error: { code: "CONTRACT_TOKEN_INVALID" } };
    }

    return { ok: true, signingToken, caseId };
  } catch (err) {
    return mapErr(err);
  }
}

// ---------------------------------------------------------------------------
// Case detail actions (shared-case)
// ---------------------------------------------------------------------------

export async function reviewDocumentAction(input: {
  documentId: string;
  verdict: "approve" | "reject";
  reason?: { es: string; en: string } | null;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await reviewDocument(actor, {
      documentId: input.documentId,
      verdict: input.verdict,
      reason: input.reason ? { en: input.reason.en, es: input.reason.es } : null,
    });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function registerPaymentAction(input: {
  installmentId: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await registerZellePayment(actor, { installmentId: input.installmentId });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function resendSigningLinkAction(input: {
  contractId: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await resendSigningLink(actor, input.contractId);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function getDocumentUrlAction(input: {
  documentId: string;
}): Promise<{ ok: boolean; url?: string; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const url = await getCaseDocumentDownloadUrl(actor, input.documentId);
    return { ok: true, url };
  } catch (err) {
    return mapErr(err);
  }
}
