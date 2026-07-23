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

import {
  requireActor,
  provisionClientUser,
  searchClients,
  lookupClientByPhone,
  updateClientAddress,
  normalizePhoneE164,
  isValidEmail,
  AuthzError,
} from "@/backend/modules/identity";
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
  confirmZellePayment,
  rejectZelleProof,
  getZelleProofUploadUrl,
  getZelleProofViewUrl,
  BillingError,
} from "@/backend/modules/billing";
import { headers } from "next/headers";
import { absoluteAppUrl, signingLinkPath } from "@/shared/urls";
import {
  createCaseFromContract,
  listCaseSummariesForClient,
  updateCaseParty,
  reviewDocument,
  setRequirementVisibility,
  dismissDocumentCoverage,
  setFormVisibility,
  advanceCasePhase,
  advanceCaseMilestone,
  startDocumentUpload,
  confirmDocumentUpload,
  renameCaseDocument,
  saveFormDraft,
  submitFormResponse,
  getCaseDocumentDownloadUrl,
  transferCase,
  handoffCaseFromLegal,
  assignCaseOwner,
  getCaseStageInfo,
  getCaseOverview,
  setDocumentTranslationNotRequired,
  CaseError,
  type CaseStageInfoDto,
} from "@/backend/modules/cases";
import {
  translateAnswerText,
  improveFormAnswerText,
  runFieldWebResearch,
  translateDocument,
  getDocumentTranslation,
  startPreMortemValidation,
  getPreMortemStatus,
  cancelPreMortemValidation,
  AiEngineError,
  type DocumentTranslationRow,
} from "@/backend/modules/ai-engine";
import { addCaseAppointment, SchedulingError } from "@/backend/modules/scheduling";
import {
  getStaffEvaluationPdfUrlAction as getStaffEvaluationPdfUrl,
  grantExtraAttemptAction as grantExtraEvaluationAttempt,
} from "@/backend/modules/evaluations";
import { getDeadlinePolicy } from "@/backend/modules/catalog";
import { ExpedienteError } from "@/backend/modules/expediente";
import { IntegrationsError } from "@/backend/modules/integrations";
import { linkLeadToCase } from "@/backend/modules/kanban";
import {
  addCaseNote,
  editNote,
  removeNote,
  getCaseNotes,
  NotesError,
  type NoteVM,
} from "@/backend/modules/notes";
import { classifySaveError } from "@/frontend/features/form-wizard/classify-save-error";
import { getLocale } from "next-intl/server";
import { resolveI18n, type Locale } from "@/shared/i18n";

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: { code: string; message?: string } };

function mapErr(err: unknown): Err {
  if (err instanceof AuthzError) return { ok: false, error: { code: err.reason } };
  if (
    err instanceof ContractError ||
    err instanceof BillingError ||
    err instanceof CaseError ||
    err instanceof SchedulingError ||
    err instanceof AiEngineError ||
    err instanceof ExpedienteError ||
    err instanceof IntegrationsError ||
    err instanceof NotesError
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
// Pre-Mortem actions — async QStash pipeline (enqueue / poll / cancel)
// ---------------------------------------------------------------------------

/**
 * Enqueues an async Pre-Mortem validation and returns immediately with the
 * assessmentId the tab polls via getPreMortemStatusAction. Config errors the
 * staff can act on (no guide, duplicate in flight, target regenerating) still
 * surface synchronously as domain codes.
 */
export async function runPreMortemAction(input: {
  caseId: string;
  target: { kind: "ai_letter" | "pdf_automation"; formDefinitionId: string; refId?: string | null };
}) {
  try {
    const actor = await requireActor();
    const t = input.target;
    const backendTarget =
      t.kind === "ai_letter"
        ? ({ kind: "ai_letter", runId: t.refId ?? undefined } as const)
        : ({ kind: "pdf_automation", responseId: t.refId ?? "" } as const);
    const { assessmentId } = await startPreMortemValidation(actor, { caseId: input.caseId, target: backendTarget });
    return { ok: true as const, assessmentId };
  } catch (err) {
    return mapErr(err);
  }
}

/** Poll-safe (read-only, never re-enqueues): lifecycle status of a validation. */
export async function getPreMortemStatusAction(input: { assessmentId: string }) {
  try {
    const actor = await requireActor();
    const { status } = await getPreMortemStatus(actor, input.assessmentId);
    return { ok: true as const, status };
  } catch (err) {
    return mapErr(err);
  }
}

/** Cancels a QUEUED validation (running ones are already in flight and paid). */
export async function cancelPreMortemAction(input: { assessmentId: string }) {
  try {
    const actor = await requireActor();
    const { cancelled } = await cancelPreMortemValidation(actor, input.assessmentId);
    return { ok: true as const, cancelled };
  } catch (err) {
    return mapErr(err);
  }
}

// ---------------------------------------------------------------------------
// createCaseAction — "Nuevo caso" full H-2 flow
// ---------------------------------------------------------------------------

export interface CreateCaseUiInput {
  clientName: string;
  /**
   * OPTIONAL, repeatable contact email (2026-07 phone-as-identity refactor).
   * Not the identity and never dedups accounts; may be an empty string.
   */
  clientEmail: string;
  /** The client's UNIQUE identity + login credential (DOC-22 §1) — required. */
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
   * Encoded plan resolution: serviceId|planId|priceCents|downCents|installments|frequency.
   * Matches the encoding used by the plan selector in new-case-modal.tsx.
   * The 6th field is optional (older 5-field encodings decode as monthly).
   */
  serviceId: string;
  planKind: "self" | "with_lawyer";
  parties: { name: string; role: string }[];
  /** Per-contract payment plan override (price/downpayment/installments/frequency + note). */
  paymentPlan?: {
    totalCents: number;
    downpaymentCents: number;
    installmentCount: number;
    frequency?: "weekly" | "monthly";
    note?: string;
  };
  /** Set when the case is created from a lead card — links leads.won_case_id so
   *  the lead leaves the leads board and the case appears in /ventas/casos. */
  leadId?: string;
  /**
   * Set when the operator picked an EXISTING client in step 1 (RF-VAN-018).
   * Skips provisioning: the client is validated (org + kind) and ONLY their
   * address is updated with the step-1 edit. Name, phone and email are
   * immutable in this flow — the phone is the login credential (one account
   * per client, DOC-22 §1); the UI sends them read-only for display.
   */
  existingClientId?: string;
  /**
   * Anchor date (yyyy-MM-dd) captured in the "Calificación" step for services
   * whose deadline policy is enabled (e.g. Apelación → judge's decision date).
   * Required for those services (validated server-side); ignored otherwise. The
   * "menos de 3 días hábiles" acceptance rule is a UI soft-gate with override —
   * the server does NOT hard-block on a short deadline (the operator confirmed).
   */
  deadlineAnchorDate?: string;
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
): Promise<Ok<{ signingToken: string; signingUrl: string; caseId: string }> | Err> {
  try {
    const actor = await requireActor();

    // Parse the encoded serviceId field from the modal selector (serviceId|planId
    // resolution). The price/downpayment/installments come from the per-contract
    // payment plan override when present, else the encoded service-plan defaults.
    const [serviceId, planId, priceStr, downStr, instStr, freqStr] = input.serviceId.split("|");
    const priceCents = input.paymentPlan ? input.paymentPlan.totalCents : Number(priceStr);
    const downCents = input.paymentPlan ? input.paymentPlan.downpaymentCents : Number(downStr);
    const installments = input.paymentPlan ? input.paymentPlan.installmentCount : Number(instStr);
    // 6th field is optional: 5-field encodings (pre-0063) decode as monthly.
    const encodedFrequency = freqStr === "weekly" ? "weekly" : "monthly";
    const frequency = input.paymentPlan?.frequency ?? encodedFrequency;

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

    // Full US address is required in both paths — it prefills the I-589
    // (address.* via profile) and is the ONLY field persisted for an existing
    // client.
    const addr = input.clientAddress;
    if (!addr?.line1?.trim() || !addr.city?.trim() || !addr.state?.trim() || !addr.zip?.trim()) {
      return { ok: false, error: { code: "INVALID_ADDRESS" } };
    }

    const address = {
      line1: addr.line1.trim(),
      city: addr.city.trim(),
      state: addr.state.trim(),
      zip: addr.zip.trim(),
      apartment: addr.apartment?.trim() || null,
    };

    // Step 1: resolve the primary client.
    //  - Existing client (RF-VAN-018 picker): validate (org + kind) and update
    //    ONLY the address (the client may have moved). Name/phone/email are
    //    immutable — the phone is the login credential (one account per
    //    client, DOC-22 §1); the UI sends them read-only for display.
    //  - New client: validate email + phone (both login credentials) and
    //    provision (idempotent — email is the identity).
    let userId: string;
    if (input.existingClientId) {
      const updated = await updateClientAddress(actor, {
        userId: input.existingClientId,
        address,
      });
      if (!updated.ok) {
        return { ok: false, error: { code: updated.code } };
      }
      userId = updated.userId;
    } else {
      // Phone is the client's UNIQUE identity + login credential — required.
      // Email is OPTIONAL, repeatable contact data (2026-07 phone-as-identity
      // refactor): validated only when present, and it never dedups accounts.
      if (!input.clientPhone || !input.clientPhone.trim()) {
        return { ok: false, error: { code: "INVALID_PHONE" } };
      }
      let phoneE164: string;
      try {
        phoneE164 = normalizePhoneE164(input.clientPhone);
      } catch {
        return { ok: false, error: { code: "INVALID_PHONE" } };
      }
      const emailTrimmed = input.clientEmail?.trim() ?? "";
      if (emailTrimmed && !isValidEmail(emailTrimmed)) {
        return { ok: false, error: { code: "INVALID_EMAIL" } };
      }
      ({ userId } = await provisionClientUser(actor, {
        fullName: input.clientName,
        email: emailTrimmed || null,
        phoneE164,
        address,
      }));
    }

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

    // Calificación (Feature A): services with an active deadline policy require the
    // anchor date (e.g. Apelación → judge's decision date). Defense in depth — the
    // UI already collects it. The "menos de 3 días hábiles" rule is NOT enforced
    // here: it is a UI soft-gate with explicit override (the operator confirmed).
    const anchorDate = input.deadlineAnchorDate?.trim() || null;
    // Fail open (like every sibling call site): a config-read error — e.g. the
    // deadline-policy table missing before migration 0106 lands, or a transient DB
    // hiccup — must NEVER break case creation. Degrades to "no policy".
    const deadlinePolicy = await getDeadlinePolicy(serviceId).catch(() => null);
    if (deadlinePolicy?.isEnabled && !anchorDate) {
      return { ok: false, error: { code: "INVALID_QUALIFICATION" } };
    }

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
        frequency,
        notes: input.paymentPlan?.note?.trim() || null,
      },
      ...(anchorDate ? { deadlineAnchorDate: anchorDate } : {}),
    });

    // Step 3: Send contract for signing (draft → sent, generates token)
    await sendContractForSigning(actor, contractId);

    // Read back the token (sendContractForSigning sets it on the contract row)
    const signingToken = await getSigningTokenForContract(actor, contractId);
    if (!signingToken) {
      return { ok: false, error: { code: "CONTRACT_TOKEN_INVALID" } };
    }

    // Build the ABSOLUTE signing link server-side from the real request origin
    // (falls back to the canonical prod origin, never localhost) so the copyable
    // link in the modal works when pasted anywhere — not just on the dev machine.
    const h = await headers();
    const signingUrl = absoluteAppUrl(signingLinkPath(signingToken), {
      forwardedHost: h.get("x-forwarded-host"),
      forwardedProto: h.get("x-forwarded-proto"),
      host: h.get("host"),
      envUrl: process.env.NEXT_PUBLIC_APP_URL,
    });

    // Attribute the originating lead (best-effort): set won_case_id so the lead
    // leaves the leads board and shows up as a case. Never fails case creation.
    if (input.leadId) {
      try {
        await linkLeadToCase(actor, { leadId: input.leadId, caseId });
      } catch {
        // non-fatal — the case already exists; the lead just stays on the board.
      }
    }

    return { ok: true, signingToken, signingUrl, caseId };
  } catch (err) {
    return mapErr(err);
  }
}

// ---------------------------------------------------------------------------
// Client picker actions — "Nuevo caso" step 1 existing-client mode (RF-VAN-018)
// ---------------------------------------------------------------------------

/** Client row for the step-1 picker — the modal prefills step 1 from it. */
export interface ClientPickDto {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: { line1: string; city: string; state: string; zip: string; apartment?: string } | null;
  caseCount: number;
}

/**
 * Searches existing clients for the "¿Para quién es el caso?" picker.
 * Empty query → most recent clients. Gated by can(actor,'clients','view')
 * inside identity.searchClients.
 *
 * @api-id API-AUT-20 (staff search — clients slice)
 */
export async function searchClientsForCaseAction(
  query: string,
): Promise<Ok<{ results: ClientPickDto[] }> | Err> {
  try {
    const actor = await requireActor();
    const results = await searchClients(actor, { query });
    return {
      ok: true,
      results: results.map((r) => ({
        userId: r.userId,
        name: r.fullName,
        email: r.email,
        phone: r.phoneE164,
        address: r.address
          ? {
              line1: r.address.line1,
              city: r.address.city,
              state: r.address.state,
              zip: r.address.zip,
              ...(r.address.apartment ? { apartment: r.address.apartment } : {}),
            }
          : null,
        caseCount: r.caseCount,
      })),
    };
  } catch (err) {
    return mapErr(err);
  }
}

/**
 * Duplicate-phone check for "Nuevo caso" step 1 (new-client mode). The phone is
 * the client's UNIQUE identity, so the modal calls this as the operator types a
 * phone: when it already belongs to a client, the modal warns and offers the
 * existing-client flow (RF-VAN-018) instead of creating a case under the wrong
 * account. Returns { client: null } for a partial/invalid phone or no match.
 *
 * @api-id API-AUT-20 (staff search — clients slice)
 */
export async function checkClientPhoneAction(
  rawPhone: string,
): Promise<Ok<{ client: ClientPickDto | null }> | Err> {
  try {
    const actor = await requireActor();
    const match = await lookupClientByPhone(actor, rawPhone);
    return {
      ok: true,
      client: match
        ? {
            userId: match.userId,
            name: match.fullName,
            email: match.email,
            phone: match.phoneE164,
            address: match.address
              ? {
                  line1: match.address.line1,
                  city: match.address.city,
                  state: match.address.state,
                  zip: match.address.zip,
                  ...(match.address.apartment ? { apartment: match.address.apartment } : {}),
                }
              : null,
            caseCount: match.caseCount,
          }
        : null,
    };
  } catch (err) {
    return mapErr(err);
  }
}

/** Existing case of the picked client — for the RF-VAN-019 duplicate notice. */
export interface ClientExistingCaseDto {
  caseId: string;
  caseNumber: string;
  serviceId: string;
  serviceLabel: string;
}

/**
 * Lists the picked client's cases with locale-resolved service labels so the
 * modal can warn (non-blocking) when the chosen service repeats (RF-VAN-019).
 */
export async function getClientCasesForNewCaseAction(
  clientId: string,
): Promise<Ok<{ cases: ClientExistingCaseDto[] }> | Err> {
  try {
    const actor = await requireActor();
    const locale = (await getLocale()) as Locale;
    const rows = await listCaseSummariesForClient(actor, clientId);
    return {
      ok: true,
      cases: rows.map((c) => ({
        caseId: c.caseId,
        caseNumber: c.caseNumber,
        serviceId: c.serviceId,
        serviceLabel: resolveI18n(c.serviceLabelI18n, locale),
      })),
    };
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

/** Reviewer (admin/paralegal/sales) overrules an AI coverage — the covered
 *  requirement returns to pending and the client uploads it separately. */
export async function dismissCoverageAction(input: {
  caseId: string;
  coverageId: string;
  reason?: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await dismissDocumentCoverage(actor, input);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

/** Admin/sales hides or restores an OPTIONAL form for a case (EOIR-26A Fee Waiver). */
export async function setFormVisibilityAction(input: {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  hidden: boolean;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await setFormVisibility(actor, input);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

/** Eligible sales owner surfaced when a phase advance restarts the cycle. */
export interface AdvancePhaseOwnerOption {
  userId: string;
  displayName: string;
  role: string;
}

export async function advanceCasePhaseAction(input: {
  caseId: string;
  toPhaseId?: string | null;
  toOwnerId?: string | null;
  note?: string | null;
}): Promise<{
  ok: boolean;
  completed?: boolean;
  phaseIndex?: number;
  phaseCount?: number;
  candidates?: AdvancePhaseOwnerOption[];
  error?: { code: string };
}> {
  try {
    const actor = await requireActor();
    const res = await advanceCasePhase(actor, input);
    return { ok: true, completed: res.completed, phaseIndex: res.phaseIndex, phaseCount: res.phaseCount };
  } catch (err) {
    // On a cycle restart with several eligible sales owners the service throws
    // STAGE_OWNER_REQUIRED with the candidate list — surface it so the UI can ask.
    if (err instanceof CaseError) {
      const candidates = err.details?.candidates as AdvancePhaseOwnerOption[] | undefined;
      return { ok: false, error: { code: err.code }, candidates };
    }
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

// Zelle payment actions for the shared-case Pagos tab (admin / sales / finance).
// Proof is MANDATORY (Henry 2026-07-02); verification authz is cases:edit
// (see billing/service.ts confirmZellePayment).

export async function registerPaymentAction(input: {
  installmentId: string;
  zelleProofPath: string;
  notes?: string | null;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await registerZellePayment(actor, input);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function getZelleProofUploadUrlCaseAction(input: {
  installmentId: string;
  filename: string;
  contentType: string;
}): Promise<{ ok: boolean; signedUrl?: string; path?: string; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const { signedUrl, path } = await getZelleProofUploadUrl(actor, input);
    return { ok: true, signedUrl, path };
  } catch (err) {
    return mapErr(err);
  }
}

export async function getZelleProofViewUrlCaseAction(input: {
  paymentId: string;
}): Promise<{ ok: boolean; url?: string; kind?: "image" | "pdf"; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const { url, kind } = await getZelleProofViewUrl(actor, input.paymentId);
    return { ok: true, url, kind };
  } catch (err) {
    return mapErr(err);
  }
}

export async function confirmZellePaymentCaseAction(input: {
  paymentId: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await confirmZellePayment(actor, input.paymentId);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function rejectZelleProofCaseAction(input: {
  paymentId: string;
  reason: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await rejectZelleProof(actor, input);
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

/**
 * Edit the primary client's mailing address from the case Resumen (admin +
 * sales). Resolves the case's primary client server-side (getCaseOverview
 * enforces case access) and delegates to identity.updateClientAddress — which
 * gates on clients:edit, writes ONLY the address (name/phone/email are immutable
 * identity) and audits. Required address fields are validated (apartment
 * optional), mirroring createCaseAction.
 */
export async function updateClientAddressForCaseAction(input: {
  caseId: string;
  line1: string;
  apartment: string | null;
  city: string;
  state: string;
  zip: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();

    if (
      !input.line1?.trim() ||
      !input.city?.trim() ||
      !input.state?.trim() ||
      !input.zip?.trim()
    ) {
      return { ok: false, error: { code: "INVALID_ADDRESS" } };
    }

    const caseRow = await getCaseOverview(actor, input.caseId);
    if (!caseRow.primary_client_id) {
      return { ok: false, error: { code: "CLIENT_NOT_FOUND" } };
    }

    const res = await updateClientAddress(actor, {
      userId: caseRow.primary_client_id,
      address: {
        line1: input.line1.trim(),
        city: input.city.trim(),
        state: input.state.trim(),
        zip: input.zip.trim(),
        apartment: input.apartment?.trim() || null,
      },
    });
    if (!res.ok) return { ok: false, error: { code: res.code } };
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

/**
 * Absolute, ready-to-share signing link for a `sent` contract (staff copy action).
 * The token is only present while the contract is `sent`; a signed/cancelled
 * contract (token nulled) returns CONTRACT_TOKEN_INVALID. The URL is built from the
 * real request origin (canonical fallback) so it works when pasted anywhere.
 */
export async function getSigningLinkAction(input: {
  contractId: string;
}): Promise<{ ok: boolean; url?: string; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const signingToken = await getSigningTokenForContract(actor, input.contractId);
    if (!signingToken) {
      return { ok: false, error: { code: "CONTRACT_TOKEN_INVALID" } };
    }
    const h = await headers();
    const url = absoluteAppUrl(signingLinkPath(signingToken), {
      forwardedHost: h.get("x-forwarded-host"),
      forwardedProto: h.get("x-forwarded-proto"),
      host: h.get("host"),
      envUrl: process.env.NEXT_PUBLIC_APP_URL,
    });
    return { ok: true, url };
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
    return { ok: true, accepted: !!acc, acceptedAt: acc?.acceptedAt ?? null, url: acc?.documentDownloadUrl ?? null };
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

/**
 * "Mejorar con IA" for staff fill-on-behalf — same T5 rewrite the client uses
 * (ai-engine loads the per-question instruction server-side). Best-effort.
 */
export async function improveFormAnswerAction(input: {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  questionId: string;
  text: string;
}): Promise<{ ok: boolean; improvedText?: string; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const r = await improveFormAnswerText(actor, {
      caseId: input.caseId,
      formDefinitionId: input.formDefinitionId,
      questionId: input.questionId,
      text: input.text,
    });
    return { ok: true, improvedText: r.improvedText };
  } catch (e) {
    if (e instanceof AiEngineError) return { ok: false, error: { code: e.code } };
    return { ok: false, error: { code: "IMPROVE_FAILED" } };
  }
}

/**
 * web_research "Buscar" for staff fill-on-behalf (EOIR-26 item #12): runs the
 * question's config-as-data system prompt with Anthropic web_search over the staff's
 * query and returns the produced address + citations. Config is loaded server-side
 * (never from the client). Best-effort — a failure leaves the read-only box empty.
 */
export async function researchFieldAction(input: {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  questionId: string;
  query: string;
}): Promise<{
  ok: boolean;
  address?: string;
  sources?: Array<{ uri: string; title: string | null }>;
  error?: { code: string };
}> {
  try {
    const actor = await requireActor();
    const r = await runFieldWebResearch(actor, {
      caseId: input.caseId,
      formDefinitionId: input.formDefinitionId,
      questionId: input.questionId,
      query: input.query,
    });
    return { ok: true, address: r.address, sources: r.sources };
  } catch (e) {
    if (e instanceof AiEngineError) return { ok: false, error: { code: e.code } };
    return { ok: false, error: { code: "RESEARCH_FAILED" } };
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

/**
 * Plan-aware handoff out of the legal stage (Diana's Traspaso). self → Andrium;
 * with_lawyer → the reviewing lawyer. Gated by the 3-task legal checklist.
 */
export async function handoffCaseFromLegalAction(input: {
  caseId: string;
}): Promise<{ ok: true } | Err> {
  try {
    const actor = await requireActor();
    await handoffCaseFromLegal(actor, input.caseId);
    return { ok: true };
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

// ---------------------------------------------------------------------------
// External evaluation tool (v1: Juez) — Evaluación tab (module-pub wrappers).
// The evaluations module-pub actions already build the Actor + authorize; these
// thin "use server" wrappers adapt the ActionResult envelope to the shared-case
// {ok,…} shape and expose them as Next.js server actions (app → module-pub).
// ---------------------------------------------------------------------------

/** Signed URL of the delivered external-evaluation PDF (Evaluación tab). */
export async function getEvaluationPdfUrlCaseAction(input: {
  caseId: string;
}): Promise<{ ok: boolean; url?: string; error?: { code: string } }> {
  const res = await getStaffEvaluationPdfUrl(input.caseId);
  if (res.success) return { ok: true, url: res.data.url };
  return { ok: false, error: { code: res.error.code } };
}

/** Admin-only: grant +1 attempt for the case's external evaluation. The
 *  module-pub service rejects non-admins. The tab re-fetches the panel after. */
export async function grantEvaluationAttemptCaseAction(input: {
  caseId: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  const res = await grantExtraEvaluationAttempt(input.caseId);
  if (res.success) return { ok: true };
  return { ok: false, error: { code: res.error.code } };
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

// ---------------------------------------------------------------------------
// Notes (case) — shared by all staff case surfaces (admin/ventas/legal/finanzas)
// ---------------------------------------------------------------------------

/** Adds a note to a case with the chosen visibility (general/team/personal). */
export async function addCaseNoteAction(input: {
  caseId: string;
  body: string;
  visibility: string;
}): Promise<Ok<{ note: NoteVM }> | Err> {
  try {
    const actor = await requireActor();
    const note = await addCaseNote(actor, input);
    return { ok: true, note };
  } catch (err) {
    return mapErr(err);
  }
}

/** Edits a note's body/visibility (author or admin). */
export async function editNoteAction(input: {
  noteId: string;
  body?: string;
  visibility?: string;
}): Promise<Ok<{ note: NoteVM }> | Err> {
  try {
    const actor = await requireActor();
    const note = await editNote(actor, input);
    return { ok: true, note };
  } catch (err) {
    return mapErr(err);
  }
}

/** Deletes a note (author or admin). */
export async function deleteNoteAction(input: {
  noteId: string;
}): Promise<{ ok: true } | Err> {
  try {
    const actor = await requireActor();
    await removeNote(actor, input);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

/** Lists the notes visible to the actor for a case (case + originating-lead union). */
export async function listCaseNotesAction(input: {
  caseId: string;
}): Promise<Ok<{ notes: NoteVM[] }> | Err> {
  try {
    const actor = await requireActor();
    const notes = await getCaseNotes(actor, input.caseId);
    return { ok: true, notes };
  } catch (err) {
    return mapErr(err);
  }
}
