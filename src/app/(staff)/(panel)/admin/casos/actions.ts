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
  getSignedContractDownloadUrl,
  getTermsAcceptanceForCase,
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
  advanceCaseMilestone,
  startDocumentUpload,
  confirmDocumentUpload,
  renameCaseDocument,
  saveFormDraft,
  submitFormResponse,
  getCaseDocumentDownloadUrl,
  transferCase,
  assignCaseOwner,
  getCaseStageInfo,
  setDocumentTranslationNotRequired,
  CaseError,
  type CaseStageInfoDto,
} from "@/backend/modules/cases";
import {
  translateAnswerText,
  translateDocument,
  getDocumentTranslation,
  AiEngineError,
  type DocumentTranslationRow,
} from "@/backend/modules/ai-engine";
import { addCaseAppointment, SchedulingError } from "@/backend/modules/scheduling";
import { classifySaveError } from "@/frontend/features/form-wizard/classify-save-error";

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: { code: string; message?: string } };

function mapErr(err: unknown): Err {
  if (err instanceof AuthzError) return { ok: false, error: { code: err.reason } };
  if (
    err instanceof ContractError ||
    err instanceof BillingError ||
    err instanceof CaseError ||
    err instanceof SchedulingError ||
    err instanceof AiEngineError
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
  /** Per-contract payment plan override (price/downpayment/installments + note). */
  paymentPlan?: {
    totalCents: number;
    downpaymentCents: number;
    installmentCount: number;
    note?: string;
  };
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

    // Parse the encoded serviceId field from the modal selector (serviceId|planId
    // resolution). The price/downpayment/installments come from the per-contract
    // payment plan override when present, else the encoded service-plan defaults.
    const [serviceId, planId, priceStr, downStr, instStr] = input.serviceId.split("|");
    const priceCents = input.paymentPlan ? input.paymentPlan.totalCents : Number(priceStr);
    const downCents = input.paymentPlan ? input.paymentPlan.downpaymentCents : Number(downStr);
    const installments = input.paymentPlan ? input.paymentPlan.installmentCount : Number(instStr);

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
        notes: input.paymentPlan?.note?.trim() || null,
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

export async function advanceCaseMilestoneAction(input: {
  caseId: string;
  toMilestoneId?: string | null;
  note?: string | null;
}): Promise<{ ok: boolean; phaseChanged?: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const res = await advanceCaseMilestone(actor, input);
    return { ok: true, phaseChanged: res.phaseChanged };
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
// Document translation (API-AI-08/09) — staff translate a client document
// (ES→EN by default) into a court-ready English PDF. The heavy work runs in a
// QStash job; the UI polls getDocumentTranslationAction. Authorization is
// requireCaseAccess inside the ai-engine module (staff allowed).
// ---------------------------------------------------------------------------

export type TranslationDirection = "es-en" | "en-es";

export interface TranslationDto {
  status: "processing" | "completed" | "failed";
  translatedText: string | null;
  hasPdf: boolean;
}

function toTranslationDto(row: DocumentTranslationRow): TranslationDto {
  return {
    status: row.status as TranslationDto["status"],
    translatedText: row.translated_text ?? null,
    hasPdf: !!row.translated_pdf_path,
  };
}

export async function translateDocumentAction(input: {
  caseId: string;
  caseDocumentId: string;
  direction?: TranslationDirection;
}): Promise<{ ok: boolean; translation?: TranslationDto; cached?: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const { translation, cached } = await translateDocument(actor, {
      caseId: input.caseId,
      caseDocumentId: input.caseDocumentId,
      direction: input.direction ?? "es-en",
    });
    return { ok: true, translation: toTranslationDto(translation), cached };
  } catch (err) {
    return mapErr(err);
  }
}

export async function getDocumentTranslationAction(input: {
  caseId: string;
  caseDocumentId: string;
  direction?: TranslationDirection;
}): Promise<{ ok: boolean; translation?: TranslationDto | null; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const row = await getDocumentTranslation(actor, {
      caseId: input.caseId,
      caseDocumentId: input.caseDocumentId,
      direction: input.direction ?? "es-en",
    });
    return { ok: true, translation: row ? toTranslationDto(row) : null };
  } catch (err) {
    return mapErr(err);
  }
}

export async function downloadSignedContractAction(input: {
  caseId: string;
}): Promise<{ ok: boolean; url?: string | null; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const url = await getSignedContractDownloadUrl(actor, input.caseId);
    return { ok: true, url };
  } catch (err) {
    return mapErr(err);
  }
}

export async function getTermsAcceptanceAction(input: {
  caseId: string;
}): Promise<{ ok: boolean; accepted?: boolean; acceptedAt?: string | null; url?: string | null; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const acc = await getTermsAcceptanceForCase(actor, input.caseId);
    return { ok: true, accepted: !!acc, acceptedAt: acc?.acceptedAt ?? null, url: acc?.signatureDownloadUrl ?? null };
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
  displayName?: string | null;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await confirmDocumentUpload(actor, input);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

/** Rename a document's semantic name (staff only) — fixes a non-fitting name a
 *  client typed on a multiple-file slot; drives the .pdf download filename. */
export async function renameDocumentAction(input: {
  caseId: string;
  documentId: string;
  displayName: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    if (actor.kind !== "staff") return { ok: false, error: { code: "FORBIDDEN" } };
    await renameCaseDocument(actor, {
      documentId: input.documentId,
      displayName: input.displayName,
    });
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
}): Promise<{ ok: boolean; responseId?: string; retryable?: boolean; error?: { code: string; details?: Record<string, unknown> } }> {
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
    const code = err instanceof CaseError ? err.code : "UNEXPECTED";
    const retryable = classifySaveError(code) === "transient";
    if (err instanceof CaseError) return { ok: false, retryable, error: { code: err.code, details: err.details } };
    return { ok: false, retryable, error: { code: "UNEXPECTED" } };
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

// ---------------------------------------------------------------------------
// Case ownership stage — responsable / etapa (eje propio)
// ---------------------------------------------------------------------------

/** Reads the responsable/etapa + checklist gating for the case detail UI. */
export async function getCaseStageInfoAction(input: {
  caseId: string;
}): Promise<{ ok: true; info: CaseStageInfoDto } | Err> {
  try {
    const actor = await requireActor();
    const info = await getCaseStageInfo(actor, input.caseId);
    return { ok: true, info };
  } catch (err) {
    return mapErr(err);
  }
}

/**
 * "Traspasar": advances the case to the next stage + responsible. Gated by the
 * stage checklist (admin may force). Moves the kanban card automatically.
 */
export async function transferCaseAction(input: {
  caseId: string;
  toOwnerId?: string | null;
  force?: boolean;
  note?: string;
}): Promise<{ ok: true; stage: string; ownerId: string | null } | Err> {
  try {
    const actor = await requireActor();
    const res = await transferCase(actor, input);
    return { ok: true, stage: res.stage, ownerId: res.ownerId };
  } catch (err) {
    return mapErr(err);
  }
}

/** Admin reassigns the responsible within the current stage. */
export async function assignCaseOwnerAction(input: {
  caseId: string;
  ownerId: string;
}): Promise<{ ok: true } | Err> {
  try {
    const actor = await requireActor();
    await assignCaseOwner(actor, input);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

/** Marks a document as already-English (excluded from the translation gating) or back. */
export async function setDocumentTranslationNotRequiredAction(input: {
  caseId: string;
  caseDocumentId: string;
  value: boolean;
}): Promise<{ ok: true } | Err> {
  try {
    const actor = await requireActor();
    await setDocumentTranslationNotRequired(actor, input);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}
