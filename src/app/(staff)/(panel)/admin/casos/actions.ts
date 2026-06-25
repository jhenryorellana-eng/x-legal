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

import { requireActor, provisionClientUser, normalizePhoneE164, isValidEmail, AuthzError } from "@/backend/modules/identity";
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
  updateCaseParty,
  reviewDocument,
  setRequirementVisibility,
  advanceCasePhase,
  startDocumentUpload,
  confirmDocumentUpload,
  saveFormDraft,
  submitFormResponse,
  getCaseDocumentDownloadUrl,
  CaseError,
} from "@/backend/modules/cases";
import { translateAnswerText } from "@/backend/modules/ai-engine";
import { addCaseAppointment, SchedulingError } from "@/backend/modules/scheduling";

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: { code: string; message?: string } };

function mapErr(err: unknown): Err {
  if (err instanceof AuthzError) return { ok: false, error: { code: err.reason } };
  if (
    err instanceof ContractError ||
    err instanceof BillingError ||
    err instanceof CaseError ||
    err instanceof SchedulingError
  ) {
    return { ok: false, error: { code: err.code } };
  }
  // Unexpected (non-domain) errors: surface server-side for observability.
  // Domain errors already carry a stable code to the client.
  // H-5: log only the message, never the raw Error object (may carry PII in stack/metadata)
  console.error("[casos action] unexpected:", (err as Error)?.message ?? String(err));
  return { ok: false, error: { code: "internal" } };
}

// ---------------------------------------------------------------------------
// createCaseAction — "Nuevo caso" full H-2 flow
// ---------------------------------------------------------------------------

export interface CreateCaseUiInput {
  clientName: string;
  /** Login credential (DOC-22 §1, email auth) — captured at intake. */
  clientEmail: string;
  /** Login credential (DOC-22 §1) — required: phone + email together. */
  clientPhone: string;
  /** Full US mailing address — required (prefills the I-589 via profile). */
  clientAddress: {
    line1: string;
    city: string;
    state: string;
    zip: string;
    apartment?: string;
  };
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

    // Email + phone are BOTH login credentials (DOC-22 §1). Both required.
    if (!isValidEmail(input.clientEmail)) {
      return { ok: false, error: { code: "INVALID_EMAIL" } };
    }
    if (!input.clientPhone || !input.clientPhone.trim()) {
      return { ok: false, error: { code: "INVALID_PHONE" } };
    }
    let phoneE164: string;
    try {
      phoneE164 = normalizePhoneE164(input.clientPhone);
    } catch {
      return { ok: false, error: { code: "INVALID_PHONE" } };
    }

    // Full US address is required — it prefills the I-589 (address.* via profile).
    const addr = input.clientAddress;
    if (!addr?.line1?.trim() || !addr.city?.trim() || !addr.state?.trim() || !addr.zip?.trim()) {
      return { ok: false, error: { code: "INVALID_ADDRESS" } };
    }

    // Step 1: Provision client user (idempotent — email is the identity)
    const { userId } = await provisionClientUser(actor, {
      fullName: input.clientName,
      email: input.clientEmail,
      phoneE164,
      address: {
        line1: addr.line1.trim(),
        city: addr.city.trim(),
        state: addr.state.trim(),
        zip: addr.zip.trim(),
        apartment: addr.apartment?.trim() || null,
      },
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

export async function setRequirementVisibilityAction(input: {
  caseId: string;
  requirementId: string | null;
  partyId: string | null;
  hidden: boolean;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await setRequirementVisibility(actor, input);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function advanceCasePhaseAction(input: {
  caseId: string;
  toPhaseId?: string | null;
  note?: string | null;
}): Promise<{ ok: boolean; phaseIndex?: number; phaseCount?: number; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const res = await advanceCasePhase(actor, input);
    return { ok: true, phaseIndex: res.phaseIndex, phaseCount: res.phaseCount };
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

export async function updateCasePartyAction(input: {
  caseId: string;
  partyId: string;
  firstName: string;
  lastName: string;
}): Promise<{ ok: boolean; resynced?: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const { resynced } = await updateCaseParty(actor, input);
    return { ok: true, resynced };
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

export async function sendContractAction(input: {
  contractId: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await sendContractForSigning(actor, input.contractId);
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

// ---------------------------------------------------------------------------
// Staff document upload (RF-ADM-008) — admin/sales upload on the client's behalf
// from the case workspace. Thin wrappers over the cases module-pub use cases;
// authorization is `requireCaseAccess` inside the service (staff allowed).
// ---------------------------------------------------------------------------

export async function startDocumentUploadAction(input: {
  caseId: string;
  requirementId: string | null;
  partyId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<{ ok: boolean; signedUrl?: string; uploadRef?: string; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const { signedUrl, uploadRef } = await startDocumentUpload(actor, input);
    return { ok: true, signedUrl, uploadRef };
  } catch (err) {
    return mapErr(err);
  }
}

export async function confirmDocumentUploadAction(input: {
  caseId: string;
  uploadRef: string;
  requirementId: string | null;
  partyId: string | null;
  originalFilename: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await confirmDocumentUpload(actor, input);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

// ---------------------------------------------------------------------------
// Staff form fill (RF-ADM-010) — admin/sales fill the same wizard the client
// sees. The cases use cases authorize by requireCaseAccess (staff allowed; only
// CLIENTS are blocked from staff-only forms). Signatures mirror the client
// wizard fn types so FormWizard consumes them unchanged.
// ---------------------------------------------------------------------------

export async function saveFormDraftAction(input: {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  patch: Record<string, unknown>;
}): Promise<{ ok: boolean; responseId?: string; error?: { code: string; details?: Record<string, unknown> } }> {
  try {
    const actor = await requireActor();
    const response = await saveFormDraft(actor, {
      caseId: input.caseId,
      formDefinitionId: input.formDefinitionId,
      partyId: input.partyId,
      patch: input.patch,
    });
    return { ok: true, responseId: response.id };
  } catch (err) {
    if (err instanceof CaseError) return { ok: false, error: { code: err.code, details: err.details } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

export async function submitFormResponseAction(input: {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  answersTranslated?: Record<string, string>;
  translationStatus?: "none" | "partial" | "pending_server" | "done";
}): Promise<{ ok: boolean; responseId?: string; error?: { code: string; details?: Record<string, unknown> } }> {
  try {
    const actor = await requireActor();
    const response = await submitFormResponse(actor, {
      caseId: input.caseId,
      formDefinitionId: input.formDefinitionId,
      partyId: input.partyId,
      answersTranslated: input.answersTranslated,
      translationStatus: input.translationStatus,
    });
    return { ok: true, responseId: response.id };
  } catch (err) {
    if (err instanceof CaseError) return { ok: false, error: { code: err.code, details: err.details } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// Ruta de citas (DOC-52 §5.5) — staff adds an intermediate cita to one case.
// ---------------------------------------------------------------------------

export async function addCaseAppointmentAction(input: {
  caseId: string;
  label?: { es: string; en: string } | null;
  objectives: Array<{ id?: string; text: { es: string; en: string } }>;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await addCaseAppointment(actor, {
      caseId: input.caseId,
      labelI18n: input.label ?? null,
      objectives: input.objectives,
    });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function translateFormAnswersAction(input: {
  items: Array<{ id: string; text: string }>;
  from: "en" | "es";
  to: "en" | "es";
}): Promise<{ ok: boolean; translations?: Record<string, string>; error?: { code: string } }> {
  try {
    await requireActor();
    if (input.from === input.to) {
      return { ok: true, translations: Object.fromEntries(input.items.map((i) => [i.id, i.text])) };
    }
    const direction = `${input.from}-${input.to}` as "es-en" | "en-es";
    const translations: Record<string, string> = {};
    for (const item of input.items) {
      if (!item.text.trim()) continue;
      try {
        const r = await translateAnswerText({ text: item.text, direction });
        if (r.text.trim()) translations[item.id] = r.text;
      } catch {
        // best-effort — skip this item
      }
    }
    return { ok: true, translations };
  } catch {
    return { ok: false, error: { code: "TRANSLATE_FAILED" } };
  }
}
