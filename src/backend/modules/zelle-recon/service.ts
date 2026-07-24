/**
 * Zelle reconciliation — service layer.
 *
 * Three entry points, all job-driven (no request-path work):
 *  - runZelleIngestSweep   (cron every 2 min): IMAP sweep → evidence →
 *    parsed notification → fan-out to match-zelle-notification.
 *  - checkIngestHeartbeat  (cron hourly): alert admins when the mailbox has
 *    not been swept successfully for hours (worker/creds/Chase-alert broken).
 *  - matchZelleNotification (fan-out per notification): scores candidates,
 *    decides tier A auto-settlement vs review inbox, and applies via
 *    billing.applyBankVerifiedZellePayment (atomic RPC).
 *
 * Plus the finance-owned config (orgs.settings.zelle_reconciliation).
 *
 * @module zelle-recon/service
 */

import { createHash } from "node:crypto";
import { simpleParser } from "mailparser";

import { can, type Actor } from "@/backend/platform/authz";
import { appEvents } from "@/backend/platform/events";
import { logger } from "@/backend/platform/logger";
import { sweepZelleMailbox, type RawInboundEmail } from "@/backend/platform/imap";
import { uploadBytesToStorage, createSignedDownloadUrl } from "@/backend/platform/storage";
import { htmlToPdf } from "@/backend/platform/pdf";
import { enqueueJob } from "@/backend/platform/qstash";
import { writeAudit } from "@/backend/modules/audit";
import {
  applyBankVerifiedZellePayment,
  confirmZellePayment,
  registerZellePayment,
} from "@/backend/modules/billing";
import { insertNotificationIdempotent } from "@/backend/modules/notifications";
import {
  ZelleReconciliationSettingsSchema,
  type ZelleReconciliationSettings,
} from "@/backend/modules/org";

import {
  verifyChaseAuthenticity,
  parseChaseZelleEmail,
  extractRefCode,
  normalizePayerName,
  decideMatch,
  KNOWN_TEMPLATE_IDS,
  SCORER_VERSION,
  type ChaseZellePayment,
  type NotificationFacts,
  type ReconConfig,
  type RefResolution,
  type AuthVerdict,
} from "./domain";
import {
  findReconOrgId,
  getIngestState,
  claimIngestLease,
  releaseIngestLease,
  insertInboundEmail,
  updateInboundEmailParse,
  findInboundEmailById,
  findNotificationByTransactionNumber,
  findNotificationById,
  insertNotification,
  updateNotificationLifecycle,
  insertMatches,
  findMatchById,
  updateMatch,
  rejectOtherSuggestedMatches,
  listReviewNotifications,
  listSuggestedMatchesForNotifications,
  listAutoAppliedMatches,
  getCaseHeaders,
  getInstallmentHeaders,
  findPendingZellePaymentId,
  upsertPayerIdentity,
  listAliasesByName,
  getDailyAutoStats,
  findCaseIdByCaseNumber,
  listMatchCandidates,
  readOrgSettingsRaw,
  writeReconSettings,
  listAdminUserIds,
  type ZelleNotificationRow,
} from "./repository";

const EVIDENCE_BUCKET = "zelle-inbound";
const PROOF_BUCKET = "payment-proofs"; // the existing zelle-proof viewer reads here
const LEASE_SECONDS = 90;
const HEARTBEAT_STALE_HOURS = 6;
/** Max suggested candidates persisted per notification (inbox stays readable). */
const MAX_SUGGESTED_MATCHES = 5;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function toReconConfig(s: ZelleReconciliationSettings): ReconConfig {
  return {
    enabled: s.enabled,
    tierAMaxAmountCents: s.tier_a_max_amount_cents,
    dailyAutoMaxCents: s.daily_auto_max_cents,
    dailyAutoMaxCount: s.daily_auto_max_count,
    perPayerDailyMax: s.per_payer_daily_max,
    tierBMode: s.tier_b_mode,
  };
}

export async function getReconConfig(orgId: string): Promise<ReconConfig> {
  const raw = await readOrgSettingsRaw(orgId);
  const parsed = ZelleReconciliationSettingsSchema.safeParse(
    (raw as { zelle_reconciliation?: unknown }).zelle_reconciliation ?? {},
  );
  return toReconConfig(parsed.success ? parsed.data : ZelleReconciliationSettingsSchema.parse({}));
}

/** Finance-owned circuit-breaker knobs (kill switch, caps, tier-B mode). */
export async function updateReconConfig(
  actor: Actor,
  patch: Partial<ZelleReconciliationSettings>,
): Promise<ReconConfig> {
  can(actor, "billing", "edit");

  const raw = await readOrgSettingsRaw(actor.orgId);
  const beforeParsed = ZelleReconciliationSettingsSchema.safeParse(
    (raw as { zelle_reconciliation?: unknown }).zelle_reconciliation ?? {},
  );
  const before = beforeParsed.success
    ? beforeParsed.data
    : ZelleReconciliationSettingsSchema.parse({});

  const next = ZelleReconciliationSettingsSchema.parse({ ...before, ...patch });
  await writeReconSettings(actor.orgId, next);

  await writeAudit(actor, "zelle.recon.config_updated", "orgs", actor.orgId, {
    before: { ...before },
    after: { ...next },
  });

  return toReconConfig(next);
}

// ---------------------------------------------------------------------------
// Admin anomaly alerts (in-app, idempotent per dedupe key)
// ---------------------------------------------------------------------------

async function alertAdmins(
  orgId: string,
  input: {
    type: string;
    titleI18n: { es: string; en: string };
    bodyI18n?: { es: string; en: string };
    dedupeKey: string;
  },
): Promise<void> {
  try {
    const adminIds = await listAdminUserIds(orgId);
    for (const userId of adminIds) {
      await insertNotificationIdempotent({
        userId,
        type: input.type,
        titleI18n: { en: input.titleI18n.en, es: input.titleI18n.es },
        bodyI18n: input.bodyI18n ? { en: input.bodyI18n.en, es: input.bodyI18n.es } : null,
        icon: "alert-triangle",
        color: "warning",
        actionUrl: "/finanzas/pagos?tab=conciliacion",
        dedupeKey: input.dedupeKey,
      });
    }
  } catch (err) {
    // Alerting must never break ingestion.
    logger.error({ err, orgId, type: input.type }, "zelle-recon: alertAdmins failed");
  }
}

// ---------------------------------------------------------------------------
// Ingest sweep
// ---------------------------------------------------------------------------

export interface IngestSweepResult {
  swept: boolean;
  fetched: number;
  processed: number;
  failed: number;
}

export async function runZelleIngestSweep(): Promise<IngestSweepResult> {
  const orgId = await findReconOrgId();
  if (!orgId) {
    logger.warn({}, "zelle-recon: no org found — sweep skipped");
    return { swept: false, fetched: 0, processed: 0, failed: 0 };
  }

  // Row-lease lock: overlapping crons (or a slow previous run) never sweep
  // concurrently. The lease expires on its own if this run dies.
  const claimed = await claimIngestLease(orgId, LEASE_SECONDS);
  if (!claimed) {
    logger.info({ orgId }, "zelle-recon: lease busy — sweep skipped");
    return { swept: false, fetched: 0, processed: 0, failed: 0 };
  }

  const state = await getIngestState(orgId);
  try {
    const result = await sweepZelleMailbox(
      {
        sinceUid: state?.last_uid ?? 0,
        knownUidvalidity: state?.uidvalidity != null ? BigInt(state.uidvalidity) : null,
      },
      (email) => ingestOneEmail(orgId, email),
    );

    await releaseIngestLease(orgId, {
      success: true,
      lastUid: result.newLastUid,
      uidvalidity: Number(result.uidvalidity),
      error: result.failed > 0 ? `${result.failed} message(s) failed — will retry` : null,
    });

    if (result.fetched > 0) {
      logger.info(
        { orgId, fetched: result.fetched, processed: result.processed, failed: result.failed },
        "zelle-recon: sweep done",
      );
    }
    return { swept: true, ...result };
  } catch (err) {
    await releaseIngestLease(orgId, {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Processes ONE raw email end to end. Throwing here leaves the message
 * unflagged in the mailbox (retried next sweep) — so every failure mode that
 * is DETERMINISTIC (bad auth, unparseable template) must be persisted as
 * evidence + swallowed, never thrown.
 */
async function ingestOneEmail(orgId: string, raw: RawInboundEmail): Promise<void> {
  const parsed = await simpleParser(raw.source);

  const messageId = parsed.messageId ?? `no-msgid-${raw.uid}@zelle-recon.local`;

  // mailparser keeps repeated headers un-collapsed — exactly what the
  // injection check needs. ARC-Authentication-Results has a different key and
  // is excluded here by construction.
  const authenticationResults = parsed.headerLines
    .filter((h) => h.key === "authentication-results")
    .map((h) => {
      const idx = h.line.indexOf(":");
      return idx === -1 ? "" : h.line.slice(idx + 1).replace(/\s+/g, " ").trim();
    })
    .filter((v) => v !== "");

  const fromAddress = parsed.from?.value?.[0]?.address ?? null;
  const subject = parsed.subject ?? null;
  const auth: AuthVerdict = verifyChaseAuthenticity({
    authenticationResults,
    fromAddress,
    subject,
  });

  const html = typeof parsed.html === "string" && parsed.html !== "" ? parsed.html : (parsed.textAsHtml ?? "");
  const templateId = html.match(/<title>\s*([^<]*?)\s*<\/title>/i)?.[1] || null;

  // Deterministic parse outcome (never throws out of this block).
  let payment: ChaseZellePayment | null = null;
  let parseStatus: "parsed" | "parse_failed" | "rejected_auth";
  let parseError: string | null = null;
  if (!auth.ok) {
    // Without authenticity we don't even read the amount (fraud surface).
    parseStatus = "rejected_auth";
    parseError = auth.reasons.join(" | ");
  } else {
    try {
      payment = parseChaseZelleEmail(html);
      parseStatus = "parsed";
    } catch (err) {
      parseStatus = "parse_failed";
      parseError = err instanceof Error ? err.message : String(err);
    }
  }

  // Canonical evidence first: the raw .eml, hashed, in the private bucket.
  const sha256 = createHash("sha256").update(raw.source).digest("hex");
  const rawPath = `raw/${orgId}/${raw.uid}-${sha256.slice(0, 12)}.eml`;
  await uploadBytesToStorage(EVIDENCE_BUCKET, rawPath, new Uint8Array(raw.source), "message/rfc822");

  const { inserted, row: emailRow } = await insertInboundEmail({
    org_id: orgId,
    message_id: messageId,
    imap_uid: raw.uid,
    uidvalidity: raw.uidvalidity,
    received_at: (parsed.date ?? raw.internalDate)?.toISOString() ?? null,
    from_address: fromAddress,
    subject,
    raw_eml_path: rawPath,
    raw_hash: sha256,
    template_id: templateId,
    auth_ok: auth.ok,
    dkim: auth.dkim,
    spf: auth.spf,
    dmarc: auth.dmarc,
    auth_reasons: auth.reasons,
    parse_status: parseStatus,
    parse_error: parseError,
  });

  // Same Message-ID seen before (flag lost / UIDVALIDITY rescan) → done.
  if (!inserted || !emailRow) return;

  if (parseStatus === "rejected_auth") {
    logger.error(
      { emailId: emailRow.id, uid: raw.uid, reasons: auth.reasons },
      "zelle-recon: REJECTED by authenticity — possible spoofing attempt",
    );
    await alertAdmins(orgId, {
      type: "zelle.ingest_anomaly",
      titleI18n: {
        es: "Correo de Zelle rechazado por autenticidad",
        en: "Zelle email rejected by authenticity check",
      },
      bodyI18n: {
        es: "Un correo que dice ser de Chase no pasó DKIM/SPF/DMARC. Revisa la evidencia.",
        en: "An email claiming to be from Chase failed DKIM/SPF/DMARC. Review the evidence.",
      },
      dedupeKey: `zelle-auth-reject:${emailRow.id}`,
    });
    return;
  }

  if (parseStatus === "parse_failed" || !payment) {
    logger.error(
      { emailId: emailRow.id, uid: raw.uid, parseError },
      "zelle-recon: PARSE FAILED — manual review of the stored .eml required",
    );
    await alertAdmins(orgId, {
      type: "zelle.ingest_anomaly",
      titleI18n: {
        es: "Alerta de Zelle no se pudo leer",
        en: "Zelle alert could not be parsed",
      },
      bodyI18n: {
        es: "Chase pudo haber cambiado la plantilla del correo. El pago requiere registro manual.",
        en: "Chase may have changed the email template. The payment needs manual registration.",
      },
      dedupeKey: `zelle-parse-failed:${emailRow.id}`,
    });
    return;
  }

  if (!payment.templateKnown) {
    logger.warn(
      { emailId: emailRow.id, templateId: payment.templateId },
      "zelle-recon: unknown Chase template — parsed OK but auto-approval is disabled for it",
    );
  }

  const ref = extractRefCode(payment.memo);
  const existing = await findNotificationByTransactionNumber(payment.transactionNumber);

  if (!existing) {
    const { inserted: isNew, row: notification } = await insertNotification({
      org_id: orgId,
      email_id: emailRow.id,
      transaction_number: payment.transactionNumber,
      sender_name: payment.senderName,
      normalized_sender: normalizePayerName(payment.senderName),
      amount_cents: payment.amountCents,
      sent_on: payment.sentOn,
      memo: payment.memo,
      ref_code: ref.canonical,
      ref_ambiguous: ref.ambiguous,
      name_cross_checked: payment.nameCrossChecked,
      lifecycle_status: "received",
    });
    await updateInboundEmailParse(emailRow.id, { notification_id: notification.id });

    if (isNew) {
      await enqueueJob({
        jobKey: "match-zelle-notification",
        entityId: notification.id,
        attempt: 1,
        dedupeId: `match-zelle:${payment.transactionNumber}`,
        orgId,
      });
    }
    return;
  }

  // Chase RESEND of a known transaction: attach this email as extra evidence
  // and verify the fields still agree — a disagreement is an anomaly.
  await updateInboundEmailParse(emailRow.id, { notification_id: existing.id });
  const mismatch =
    existing.amount_cents !== payment.amountCents ||
    existing.sender_name !== payment.senderName ||
    (existing.sent_on ?? null) !== (payment.sentOn ?? null);

  if (mismatch) {
    logger.error(
      { notificationId: existing.id, emailId: emailRow.id },
      "zelle-recon: resend carries DIFFERENT fields for the same transaction — flagged",
    );
    if (existing.lifecycle_status === "applied") {
      await alertAdmins(orgId, {
        type: "zelle.ingest_anomaly",
        titleI18n: {
          es: "Reenvío de Chase contradice un pago ya aplicado",
          en: "Chase resend contradicts an already-applied payment",
        },
        dedupeKey: `zelle-resend-mismatch:${existing.id}`,
      });
    } else {
      await updateNotificationLifecycle(existing.id, {
        lifecycle_status: "review",
        review_reason: "resend_mismatch",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export async function checkIngestHeartbeat(): Promise<void> {
  const orgId = await findReconOrgId();
  if (!orgId) return;

  const state = await getIngestState(orgId);
  const last = state?.last_success_at ? Date.parse(state.last_success_at) : null;
  const staleMs = HEARTBEAT_STALE_HOURS * 3600_000;
  const isStale = last === null || Date.now() - last > staleMs;
  if (!isStale) return;

  const day = new Date().toISOString().slice(0, 10);
  logger.error(
    { orgId, lastSuccessAt: state?.last_success_at ?? null, lastError: state?.last_error ?? null },
    "zelle-recon: ingest heartbeat STALE",
  );
  await alertAdmins(orgId, {
    type: "zelle.ingest_stale",
    titleI18n: {
      es: `Sin barrido exitoso del buzón Zelle en ${HEARTBEAT_STALE_HOURS}h`,
      en: `No successful Zelle mailbox sweep in ${HEARTBEAT_STALE_HOURS}h`,
    },
    bodyI18n: {
      es: "Verifica el worker, la contraseña IMAP de Migadu y la alerta de Chase.",
      en: "Check the worker, the Migadu IMAP app password and the Chase alert.",
    },
    dedupeKey: `zelle-heartbeat:${day}`,
  });
}

// ---------------------------------------------------------------------------
// Matching + tier-A settlement
// ---------------------------------------------------------------------------

/** Evidence summary PDF used as payments.zelle_proof_path (the existing
 *  zelle-proof viewer renders PDFs from the payment-proofs bucket). The raw
 *  .eml in zelle-inbound remains the canonical evidence. */
function buildEvidencePdfHtml(n: ZelleNotificationRow, auth: { dkim: string | null; spf: string | null; dmarc: string | null }): string {
  const esc = (s: string | null) =>
    String(s ?? "—").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
  const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const row = (k: string, v: string) =>
    `<tr><td style="padding:6pt 0;color:#5a6675;font-size:11pt;width:40%">${k}</td>
     <td style="padding:6pt 0;font-size:11pt;font-weight:bold">${v}</td></tr>`;
  return `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;margin:0;padding:48pt 54pt;color:#1c2430">
    <div style="border-bottom:2pt solid #0d2d52;padding-bottom:10pt">
      <div style="font-size:18pt;font-weight:bold;color:#0d2d52">Comprobante bancario — alerta Zelle verificada</div>
      <div style="font-size:10pt;color:#5a6675;margin-top:4pt">Generado automáticamente desde el correo de Chase (DKIM/SPF/DMARC verificados por Migadu)</div>
    </div>
    <table style="width:100%;margin-top:18pt;border-collapse:collapse">
      ${row("Remitente (banco)", esc(n.sender_name))}
      ${row("Monto", usd(n.amount_cents))}
      ${row("Fecha del envío", esc(n.sent_on))}
      ${row("Número de transacción", esc(n.transaction_number))}
      ${row("Memo", esc(n.memo))}
      ${row("Autenticidad", `dkim=${esc(auth.dkim)} spf=${esc(auth.spf)} dmarc=${esc(auth.dmarc)}`)}
    </table>
    <div style="margin-top:24pt;border-top:1pt solid #d9e0e9;padding-top:10pt;font-size:9pt;color:#5a6675">
      La evidencia canónica es el correo .eml original archivado en el sistema (id ${esc(n.email_id)}).
    </div>
  </body></html>`;
}

export async function matchZelleNotification(notificationId: string): Promise<void> {
  const n = await findNotificationById(notificationId);
  if (!n) {
    logger.warn({ notificationId }, "zelle-recon: notification not found — skipping");
    return;
  }
  // Idempotency / job retry: only fresh or previously-reviewed notifications
  // are (re)matched. applied/dismissed/applying are terminal or in-flight.
  if (!["received", "matched", "review"].includes(n.lifecycle_status)) {
    logger.info(
      { notificationId, lifecycle: n.lifecycle_status },
      "zelle-recon: notification not matchable — skipping",
    );
    return;
  }

  const email = await findInboundEmailById(n.email_id);
  const cfg = await getReconConfig(n.org_id);
  const [candidates, aliases, todayStats] = await Promise.all([
    listMatchCandidates(n.org_id),
    listAliasesByName(n.org_id, n.normalized_sender),
    getDailyAutoStats(n.org_id),
  ]);

  let ref: RefResolution = { status: "none" };
  if (n.ref_ambiguous) {
    ref = { status: "ambiguous" };
  } else if (n.ref_code) {
    const caseId = await findCaseIdByCaseNumber(n.org_id, n.ref_code);
    ref = caseId
      ? { status: "resolved", refCode: n.ref_code, caseId }
      : { status: "unknown", refCode: n.ref_code };
  }

  const facts: NotificationFacts = {
    senderName: n.sender_name,
    normalizedSender: n.normalized_sender,
    amountCents: n.amount_cents,
    sentOn: n.sent_on,
    memo: n.memo,
    refCode: n.ref_code,
    refAmbiguous: n.ref_ambiguous,
    authOk: email?.auth_ok ?? false,
    templateKnown: email?.template_id != null && KNOWN_TEMPLATE_IDS.includes(email.template_id),
  };

  const decision = decideMatch(facts, ref, candidates, aliases, cfg, todayStats);

  // Re-scoring replaces any previous suggestions (retries after a degraded
  // auto attempt must not pile duplicate cards into the inbox).
  await rejectOtherSuggestedMatches(n.id, null);

  if (decision.action === "auto_approve") {
    const c = decision.candidate;
    const [match] = await insertMatches([
      {
        org_id: n.org_id,
        notification_id: n.id,
        case_id: c.caseId,
        installment_id: c.installmentId,
        client_user_id: c.clientUserId,
        score: Math.round(decision.score),
        signals: decision.signals,
        tier: decision.tier,
        status: "suggested",
      },
    ]);
    await updateNotificationLifecycle(n.id, { lifecycle_status: "applying" });

    // Crash-safety (review finding #1): a transient failure between "applying"
    // and settlement must NEVER strand the notification — the retry guard above
    // skips 'applying', so an unhandled throw here would make it invisible
    // forever. On error: revert to review ONLY if the RPC did not commit
    // (lifecycle still 'applying'), then rethrow so QStash retries.
    try {
      // Derivative proof for the existing viewer; the .eml stays canonical.
      const pdfBytes = await htmlToPdf(
        buildEvidencePdfHtml(n, {
          dkim: email?.dkim ?? null,
          spf: email?.spf ?? null,
          dmarc: email?.dmarc ?? null,
        }),
      );
      const proofPath = `zelle-auto/${c.installmentId}/${n.transaction_number}.pdf`;
      await uploadBytesToStorage(PROOF_BUCKET, proofPath, pdfBytes, "application/pdf");

      const result = await applyBankVerifiedZellePayment({
        notificationId: n.id,
        matchId: match.id,
        installmentId: c.installmentId,
        amountCents: n.amount_cents,
        proofPath,
        orgId: n.org_id,
        payerUserId: null, // the bank sender may not be a platform user
      });

      if (result.applied) {
        logger.info(
          { notificationId: n.id, paymentId: result.paymentId, tier: decision.tier },
          "zelle-recon: AUTO-SETTLED",
        );
        return;
      }

      // The RPC refused under the lock (state changed since scoring) — degrade
      // to the review inbox with the concrete reason. Never retry the auto.
      logger.warn(
        { notificationId: n.id, reason: result.reason },
        "zelle-recon: auto-settlement refused — degrading to review",
      );
      await updateNotificationLifecycle(n.id, {
        lifecycle_status: "review",
        review_reason: result.reason,
      });
      await emitMatchSuggested(n, c.caseId, decision.tier, result.reason);
      return;
    } catch (err) {
      logger.error(
        { err, notificationId: n.id },
        "zelle-recon: auto-settlement crashed — recovering lifecycle",
      );
      const fresh = await findNotificationById(n.id);
      if (fresh?.lifecycle_status === "applying") {
        // Settlement did NOT commit → back to the visible review inbox.
        await updateNotificationLifecycle(n.id, {
          lifecycle_status: "review",
          review_reason: "auto_settlement_error",
        });
        await emitMatchSuggested(n, c.caseId, decision.tier, "auto_settlement_error");
      }
      // If it reads 'applied', the RPC committed and only the post-commit tail
      // (events/receipt) failed — never revert a settled payment; the error
      // log above is the trail. Rethrow either way so QStash retries transients.
      throw err;
    }
  }

  if (decision.action === "review") {
    const top = decision.candidates.slice(0, MAX_SUGGESTED_MATCHES);
    if (top.length > 0) {
      await insertMatches(
        top.map((c) => ({
          org_id: n.org_id,
          notification_id: n.id,
          case_id: c.caseId,
          installment_id: c.installmentId,
          client_user_id: c.clientUserId,
          score: Math.round(c.score),
          signals: c.signals,
          tier: decision.tier ?? "B",
          status: "suggested" as const,
          review_reason: decision.reason,
        })),
      );
    }
    await updateNotificationLifecycle(n.id, {
      lifecycle_status: "review",
      review_reason: decision.reason,
    });
    await emitMatchSuggested(n, top[0]?.caseId ?? null, decision.tier, decision.reason);
    return;
  }

  // unmatched: deliberately NO candidate rows — a random name on screen
  // invites confirming without looking. The inbox shows it in "Sin identificar".
  await updateNotificationLifecycle(n.id, {
    lifecycle_status: "review",
    review_reason: decision.reason,
  });
  await emitMatchSuggested(n, null, null, decision.reason);
}

async function emitMatchSuggested(
  n: ZelleNotificationRow,
  caseId: string | null,
  tier: "A" | "B" | null,
  reason: string,
): Promise<void> {
  await appEvents.emitAndWait({
    type: "zelle.match_suggested",
    payload: {
      orgId: n.org_id,
      notificationId: n.id,
      amountCents: n.amount_cents,
      caseId,
      tier,
      reason,
    },
    occurredAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Errors (inbox flows)
// ---------------------------------------------------------------------------

export class ZelleReconError extends Error {
  constructor(
    public readonly code:
      | "NOTIFICATION_NOT_FOUND"
      | "NOTIFICATION_NOT_REVIEWABLE"
      | "MATCH_NOT_FOUND"
      | "MATCH_NOT_SUGGESTED"
      | "INSTALLMENT_NOT_FOUND"
      | "INSTALLMENT_NOT_PAYABLE"
      | "AMOUNT_MISMATCH"
      | "EVIDENCE_NOT_FOUND",
  ) {
    super(code);
    this.name = "ZelleReconError";
  }
}

// ---------------------------------------------------------------------------
// Inbox VM (page-initial read for the reconciliation tab)
// ---------------------------------------------------------------------------

export interface ReconMatchVM {
  matchId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  installmentId: string;
  installmentNumber: number;
  isDownpayment: boolean;
  installmentAmountCents: number;
  dueDate: string;
  score: number;
  tier: "A" | "B";
  /** Human-relevant signal excerpts for the "señales" chips. */
  signals: Record<string, number | string | boolean>;
}

export interface ReconNotificationVM {
  notificationId: string;
  senderName: string;
  amountCents: number;
  sentOn: string | null;
  memo: string | null;
  refCode: string | null;
  transactionNumber: string;
  receivedAt: string;
  reviewReason: string | null;
  matches: ReconMatchVM[];
}

export interface ReconAutoAppliedVM {
  notificationId: string;
  senderName: string;
  amountCents: number;
  transactionNumber: string;
  caseNumber: string;
  clientName: string;
  installmentNumber: number;
  appliedAt: string | null;
  score: number;
}

export interface ReconInboxVM {
  /** review notifications WITH at least one suggestion. */
  porConfirmar: ReconNotificationVM[];
  /** review notifications with NO suggestion (deliberately no random guess). */
  sinIdentificar: ReconNotificationVM[];
  /** auto-settled in the last 7 days (read-only audit tray). */
  autoAprobados: ReconAutoAppliedVM[];
  config: ZelleReconciliationSettings;
  pendingCount: number;
}

export async function getReconInbox(actor: Actor): Promise<ReconInboxVM> {
  can(actor, "billing", "view");
  const orgId = actor.orgId;

  const [reviews, rawSettings] = await Promise.all([
    listReviewNotifications(orgId),
    readOrgSettingsRaw(orgId),
  ]);
  const configParsed = ZelleReconciliationSettingsSchema.safeParse(
    (rawSettings as { zelle_reconciliation?: unknown }).zelle_reconciliation ?? {},
  );
  const config = configParsed.success
    ? configParsed.data
    : ZelleReconciliationSettingsSchema.parse({});

  const matches = await listSuggestedMatchesForNotifications(reviews.map((n) => n.id));
  const [caseHeaders, installmentHeaders] = await Promise.all([
    getCaseHeaders(matches.map((m) => m.case_id)),
    getInstallmentHeaders(matches.map((m) => m.installment_id)),
  ]);

  const matchesByNotification = new Map<string, ReconMatchVM[]>();
  for (const m of matches) {
    const caseH = caseHeaders.get(m.case_id);
    const instH = installmentHeaders.get(m.installment_id);
    if (!caseH || !instH) continue;
    const vm: ReconMatchVM = {
      matchId: m.id,
      caseId: m.case_id,
      caseNumber: caseH.caseNumber,
      clientName: caseH.clientName,
      installmentId: m.installment_id,
      installmentNumber: instH.number,
      isDownpayment: instH.isDownpayment,
      installmentAmountCents: instH.amountCents,
      dueDate: instH.dueDate,
      score: m.score,
      tier: m.tier,
      signals: m.signals,
    };
    const list = matchesByNotification.get(m.notification_id) ?? [];
    list.push(vm);
    matchesByNotification.set(m.notification_id, list);
  }

  const toVM = (n: ZelleNotificationRow): ReconNotificationVM => ({
    notificationId: n.id,
    senderName: n.sender_name,
    amountCents: n.amount_cents,
    sentOn: n.sent_on,
    memo: n.memo,
    refCode: n.ref_code,
    transactionNumber: n.transaction_number,
    receivedAt: n.created_at,
    reviewReason: n.review_reason,
    matches: matchesByNotification.get(n.id) ?? [],
  });

  const porConfirmar: ReconNotificationVM[] = [];
  const sinIdentificar: ReconNotificationVM[] = [];
  for (const n of reviews) {
    const vm = toVM(n);
    if (vm.matches.length > 0) porConfirmar.push(vm);
    else sinIdentificar.push(vm);
  }

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const applied = await listAutoAppliedMatches(orgId, since);
  const appliedCases = await getCaseHeaders(applied.map((a) => a.match.case_id));
  const appliedInst = await getInstallmentHeaders(applied.map((a) => a.match.installment_id));
  const autoAprobados: ReconAutoAppliedVM[] = applied.map((a) => ({
    notificationId: a.notification.id,
    senderName: a.notification.sender_name,
    amountCents: a.notification.amount_cents,
    transactionNumber: a.notification.transaction_number,
    caseNumber: appliedCases.get(a.match.case_id)?.caseNumber ?? "",
    clientName: appliedCases.get(a.match.case_id)?.clientName ?? "",
    installmentNumber: appliedInst.get(a.match.installment_id)?.number ?? 0,
    appliedAt: a.match.approved_at,
    score: a.match.score,
  }));

  return {
    porConfirmar,
    sinIdentificar,
    autoAprobados,
    config,
    pendingCount: reviews.length,
  };
}

// ---------------------------------------------------------------------------
// Manual decisions (Andrium's inbox)
// ---------------------------------------------------------------------------

async function settleManually(
  actor: Actor,
  n: ZelleNotificationRow,
  target: { caseId: string; installmentId: string; clientUserId: string | null },
  relationship: "self" | "family" | "third_party",
  matchIdToApprove: string | null,
): Promise<{ paymentId: string }> {
  // Exact amount only — the domain has no partial payments. Mismatches are
  // handled through the per-case flow (registerZellePayment warns there).
  const instH = (await getInstallmentHeaders([target.installmentId])).get(target.installmentId);
  if (!instH) throw new ZelleReconError("INSTALLMENT_NOT_FOUND");
  if (!["pending", "overdue"].includes(instH.status)) {
    throw new ZelleReconError("INSTALLMENT_NOT_PAYABLE");
  }
  if (instH.amountCents !== n.amount_cents) throw new ZelleReconError("AMOUNT_MISMATCH");

  const email = await findInboundEmailById(n.email_id);

  // A client-uploaded proof pending on the same installment → confirm THAT
  // payment (link, never duplicate).
  const pendingZelleId = await findPendingZellePaymentId(target.installmentId);
  let paymentId: string;
  if (pendingZelleId) {
    await confirmZellePayment(actor, pendingZelleId);
    paymentId = pendingZelleId;
  } else {
    const pdfBytes = await htmlToPdf(
      buildEvidencePdfHtml(n, {
        dkim: email?.dkim ?? null,
        spf: email?.spf ?? null,
        dmarc: email?.dmarc ?? null,
      }),
    );
    const proofPath = `zelle-auto/${target.installmentId}/${n.transaction_number}.pdf`;
    await uploadBytesToStorage(PROOF_BUCKET, proofPath, pdfBytes, "application/pdf");
    const result = await registerZellePayment(actor, {
      installmentId: target.installmentId,
      zelleProofPath: proofPath,
      notes: `Conciliación Zelle · txn ${n.transaction_number} · ${n.sender_name}`,
    });
    paymentId = result.paymentId;
  }

  if (matchIdToApprove) {
    await updateMatch(matchIdToApprove, {
      status: "approved",
      approved_by: actor.userId,
      approved_at: new Date().toISOString(),
      auto_approved: false,
    });
  } else {
    await insertMatches([
      {
        org_id: n.org_id,
        notification_id: n.id,
        case_id: target.caseId,
        installment_id: target.installmentId,
        client_user_id: target.clientUserId,
        score: 0,
        signals: { manual_assignment: true, scorer_version: SCORER_VERSION },
        tier: "B",
        status: "approved",
        auto_approved: false,
        approved_by: actor.userId,
        approved_at: new Date().toISOString(),
      },
    ]);
  }
  await rejectOtherSuggestedMatches(n.id, matchIdToApprove);
  await updateNotificationLifecycle(n.id, {
    lifecycle_status: "applied",
    applied_payment_id: paymentId,
  });

  // THE learning step: next time this payer name arrives, it resolves alone.
  if (target.clientUserId) {
    await upsertPayerIdentity({
      orgId: n.org_id,
      normalizedName: n.normalized_sender,
      clientUserId: target.clientUserId,
      relationship,
      confirmedBy: actor.userId,
    });
  }

  return { paymentId };
}

/** One-click confirm of a suggested match (learns the payer alias). */
export async function confirmZelleMatch(
  actor: Actor,
  input: { matchId: string; relationship: "self" | "family" | "third_party" },
): Promise<{ paymentId: string }> {
  can(actor, "billing", "edit");

  const match = await findMatchById(input.matchId);
  if (!match || match.org_id !== actor.orgId) throw new ZelleReconError("MATCH_NOT_FOUND");
  if (match.status !== "suggested") throw new ZelleReconError("MATCH_NOT_SUGGESTED");
  const n = await findNotificationById(match.notification_id);
  if (!n || n.org_id !== actor.orgId) throw new ZelleReconError("NOTIFICATION_NOT_FOUND");
  if (n.lifecycle_status !== "review") throw new ZelleReconError("NOTIFICATION_NOT_REVIEWABLE");

  const result = await settleManually(
    actor,
    n,
    { caseId: match.case_id, installmentId: match.installment_id, clientUserId: match.client_user_id },
    input.relationship,
    match.id,
  );

  await writeAudit(actor, "zelle.recon.confirmed", "zelle_payment_matches", match.id, {
    after: {
      notificationId: n.id,
      installmentId: match.installment_id,
      paymentId: result.paymentId,
      relationship: input.relationship,
    },
  });
  return result;
}

/** Assign an unidentified/mis-suggested payment to a payable installment. */
export async function reassignZelleNotification(
  actor: Actor,
  input: {
    notificationId: string;
    installmentId: string;
    relationship: "self" | "family" | "third_party";
  },
): Promise<{ paymentId: string }> {
  can(actor, "billing", "edit");

  const n = await findNotificationById(input.notificationId);
  if (!n || n.org_id !== actor.orgId) throw new ZelleReconError("NOTIFICATION_NOT_FOUND");
  if (n.lifecycle_status !== "review") throw new ZelleReconError("NOTIFICATION_NOT_REVIEWABLE");

  // Resolve the installment's case/client from the candidate universe.
  const candidates = await listMatchCandidates(n.org_id);
  const target = candidates.find((c) => c.installmentId === input.installmentId);
  if (!target) throw new ZelleReconError("INSTALLMENT_NOT_FOUND");

  const result = await settleManually(
    actor,
    n,
    { caseId: target.caseId, installmentId: target.installmentId, clientUserId: target.clientUserId },
    input.relationship,
    null,
  );

  await writeAudit(actor, "zelle.recon.reassigned", "zelle_payment_notifications", n.id, {
    after: {
      installmentId: input.installmentId,
      caseId: target.caseId,
      paymentId: result.paymentId,
      relationship: input.relationship,
    },
  });
  return result;
}

/** Dismiss a bank alert that does not belong to any client payment. */
export async function dismissZelleNotification(
  actor: Actor,
  input: { notificationId: string; reason: string },
): Promise<void> {
  can(actor, "billing", "edit");

  const n = await findNotificationById(input.notificationId);
  if (!n || n.org_id !== actor.orgId) throw new ZelleReconError("NOTIFICATION_NOT_FOUND");
  if (n.lifecycle_status !== "review") throw new ZelleReconError("NOTIFICATION_NOT_REVIEWABLE");

  await rejectOtherSuggestedMatches(n.id, null);
  await updateNotificationLifecycle(n.id, {
    lifecycle_status: "dismissed",
    review_reason: `dismissed:${input.reason}`.slice(0, 300),
  });
  await writeAudit(actor, "zelle.recon.dismissed", "zelle_payment_notifications", n.id, {
    after: { reason: input.reason },
  });
}

/** Signed URL of the canonical .eml evidence (short-lived, staff billing). */
export async function getZelleEvidenceUrl(
  actor: Actor,
  notificationId: string,
): Promise<{ url: string }> {
  can(actor, "billing", "view");
  const n = await findNotificationById(notificationId);
  if (!n || n.org_id !== actor.orgId) throw new ZelleReconError("NOTIFICATION_NOT_FOUND");
  const email = await findInboundEmailById(n.email_id);
  if (!email) throw new ZelleReconError("EVIDENCE_NOT_FOUND");
  const url = await createSignedDownloadUrl(EVIDENCE_BUCKET, email.raw_eml_path);
  return { url };
}

export interface ReconTargetVM {
  installmentId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  installmentNumber: number;
  isDownpayment: boolean;
  amountCents: number;
  dueDate: string;
  amountMatches: boolean;
}

/** Search payable installments for the reassign panel (small universe). */
export async function listReconTargets(
  actor: Actor,
  input: { query: string; amountCents?: number },
): Promise<ReconTargetVM[]> {
  can(actor, "billing", "view");
  const q = input.query.trim().toLowerCase();
  const candidates = await listMatchCandidates(actor.orgId);
  return candidates
    .filter(
      (c) =>
        q === "" ||
        c.caseNumber.toLowerCase().includes(q) ||
        c.clientFullName.toLowerCase().includes(q),
    )
    .slice(0, 20)
    .map((c) => ({
      installmentId: c.installmentId,
      caseId: c.caseId,
      caseNumber: c.caseNumber,
      clientName: c.clientFullName,
      installmentNumber: c.installmentNumber,
      isDownpayment: c.isDownpayment,
      amountCents: c.amountCents,
      dueDate: c.dueDate,
      amountMatches: input.amountCents != null ? c.amountCents === input.amountCents : false,
    }));
}
