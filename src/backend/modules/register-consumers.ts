/**
 * Consumer registration bootstrap.
 *
 * Registers all domain event consumers on the appEvents singleton.
 * Import this file ONCE at application startup (e.g. in the root layout.tsx
 * or an instrumentation.ts file).
 *
 * DOC-20 §5: "consumers are registered at startup; heavy side-effects are
 * delegated to QStash inside the consumer".
 */

import { appEvents } from "@/backend/platform/events";
import { logger } from "@/backend/platform/logger";
import { onDownpaymentConfirmed, onExpedienteSentToFinanceCase, onExpedientePrintedCase, appendAppointmentTimeline, enqueueAiPrefillWarm, applyPostureToCase, onDocumentCoverageDetected } from "@/backend/modules/cases";
import { notifyFromEvent } from "@/backend/modules/notifications";
import {
  onCaseOwnerChanged,
  onContractSigned as onContractSignedKanban,
  onDownpaymentConfirmedKanban,
  onExpedienteSentToFinance,
  onInstallmentOverdue,
  onExpedientePrinted as onExpedientePrintedKanban,
} from "@/backend/modules/kanban";
import { onContractSigned as onContractSignedBilling } from "@/backend/modules/billing";
import { ensureCaseConversation, syncCaseParticipants, postSystemMessage } from "@/backend/modules/messaging";
import { registerAiEngineConsumers, flagQuestionnairesOnNewEvidence, autoBootstrapCaseQuestionnaires, enqueueLexReindex } from "@/backend/modules/ai-engine";
import { captureFromRun } from "@/backend/modules/exhibits";
import { attachReadyExhibits } from "@/backend/modules/expediente";
import { registerIntegrationsConsumers } from "@/backend/modules/integrations";
import { requestReviewSystem } from "@/backend/modules/retention";
// scheduling: no in-process event consumers in V2.0 (DOC-43 §5 — scheduling does
// NOT consume events from other modules; the reminder job uses polling, not events)

// Pin the "registered" flag to globalThis (not a module-level let): the bus is
// globalThis-shared across bundles, so the guard must be too — otherwise a
// second bundle (or a hot-reload re-running instrumentation) would append a
// duplicate set of consumers to the same persistent bus.
const globalForConsumers = globalThis as unknown as {
  __ulpConsumersRegistered?: boolean;
};

/**
 * Idempotent registration — safe to call across bundles and dev hot-reloads.
 */
export function registerConsumers(): void {
  if (globalForConsumers.__ulpConsumersRegistered) return;
  globalForConsumers.__ulpConsumersRegistered = true;

  // -------------------------------------------------------------------------
  // cases consumers
  // -------------------------------------------------------------------------

  // downpayment.confirmed → activate case (payment_pending → active)
  appEvents.on("downpayment.confirmed", async (event) => {
    const payload = event.payload as { caseId: string; installmentId: string };
    logger.info(
      { caseId: payload.caseId },
      "cases: consuming downpayment.confirmed",
    );
    await onDownpaymentConfirmed(payload);
  });

  // -------------------------------------------------------------------------
  // notifications consumers (F2 matrix)
  // -------------------------------------------------------------------------

  // contract.sent → email the client the signing link (onboarding flow)
  appEvents.on("contract.sent", async (event) => {
    await notifyFromEvent(event);
  });

  // case.created → notify the case's asesora (onboarding flow)
  appEvents.on("case.created", async (event) => {
    await notifyFromEvent(event);
  });

  // case.phase_advanced (cycle restart) → notify sales (Vanessa) + client
  appEvents.on("case.phase_advanced", async (event) => {
    await notifyFromEvent(event);
  });

  // case.completed → fidelización: open a review request for the client (retención)
  appEvents.on("case.completed", async (event) => {
    const p = (event.payload ?? {}) as { orgId?: string; clientId?: string; caseId?: string };
    if (p.orgId && p.clientId && p.caseId) {
      await requestReviewSystem(p.orgId, p.clientId, p.caseId);
    }
  });

  // contract.signed → notify finance + sales + client
  appEvents.on("contract.signed", async (event) => {
    await notifyFromEvent(event);
  });

  // document.uploaded → notify the case's asesora (sales), client uploads only
  // + on_new_evidence watcher: a new input document turns READY per-case
  //   questionnaires `stale` so staff/client see the questions predate it.
  appEvents.on("document.uploaded", async (event) => {
    await notifyFromEvent(event);
    const p = (event.payload ?? {}) as { caseId?: string; documentId?: string };
    if (p.caseId && p.documentId) {
      await flagQuestionnairesOnNewEvidence(p.caseId, p.documentId);
    }
  });

  // document.approved → notify client
  // + ai_field prefill warm (Ola perf): an approval can change which document a
  //   slug resolves to — refresh the cached ai_field values in the background.
  //
  // KNOWN GAP (accepted 2026-07-18): both events carry no partyId, so the
  // proactive warm only covers CASE-LEVEL (party null) forms — which is every
  // real ai_field form today (EOIR-26 / brief questionnaire). A per-party form
  // still self-heals via getFormForClient's on-miss enqueue (which passes the
  // real partyId) + wizard polling; it just isn't pre-warmed.
  appEvents.on("document.approved", async (event) => {
    await notifyFromEvent(event);
    const p = (event.payload ?? {}) as { caseId?: string };
    if (p.caseId) await enqueueAiPrefillWarm(p.caseId, null);
  });

  // extraction.completed → ai_field prefill warm (Ola perf): the extraction is
  // the expensive input of most ai_field questions; warming HERE means the cache
  // is hot minutes before a human opens the wizard, so opens are cache-only.
  // (Same case-level-only gap as document.approved above.)
  appEvents.on("extraction.completed", async (event) => {
    const p = (event.payload ?? {}) as { caseId?: string };
    if (!p.caseId) return;
    // Posture FIRST: it governs what the questionnaire may even ask, so it must be
    // resolved before any generation reads the case. Best-effort by design.
    await applyPostureToCase(p.caseId);
    // Proactively bootstrap the case's auto questionnaires now that a document is
    // extracted: generate + AI-draft-fill them so they are ready BEFORE anyone opens
    // them (idempotent — only advances missing/pending_prereqs instances).
    await autoBootstrapCaseQuestionnaires(p.caseId);
    await enqueueAiPrefillWarm(p.caseId, null);
    // Re-index Lex now that a document's text exists. document.uploaded already
    // enqueues a reindex, but that races the extraction; firing here too GUARANTEES
    // a freshly-extracted document (e.g. the DHS Motion to Pretermit) becomes
    // readable by every staff member's Lex chat without waiting for the next event.
    await enqueueLexReindex(p.caseId);
  });

  // document.rejected → notify client
  appEvents.on("document.rejected", async (event) => {
    await notifyFromEvent(event);
  });

  // document.coverage_detected → the AI found other requested documents INSIDE
  // an upload (combined PDF). Client-facing: notification + timeline entry.
  // Then re-run the idempotent consumers that depend on the case's document
  // set: questionnaire staleness/bootstrap + ai_field prefill warm. No lex
  // reindex / posture here — extraction.completed of the SOURCE doc already ran
  // them (Lex indexes the source raw_text; posture reads the same payloads).
  appEvents.on("document.coverage_detected", async (event) => {
    await notifyFromEvent(event);
    const p = (event.payload ?? {}) as {
      caseId?: string;
      caseDocumentId?: string;
      coveredRequirementIds?: string[];
    };
    if (!p.caseId) return;
    await onDocumentCoverageDetected({
      caseId: p.caseId,
      caseDocumentId: p.caseDocumentId ?? "",
      coveredRequirementIds: p.coveredRequirementIds ?? [],
    });
    if (p.caseDocumentId) {
      await flagQuestionnairesOnNewEvidence(p.caseId, p.caseDocumentId);
    }
    await autoBootstrapCaseQuestionnaires(p.caseId);
    await enqueueAiPrefillWarm(p.caseId, null);
  });

  // form_response.submitted → notify the case's asesora (sales), client submits only
  appEvents.on("form_response.submitted", async (event) => {
    await notifyFromEvent(event);
  });

  // questionnaire.drafts_failed → notify the case's asesora (autofill total):
  // the questionnaire is ready but the AI drafting pass failed after retries.
  appEvents.on("questionnaire.drafts_failed", async (event) => {
    await notifyFromEvent(event);
  });

  // form_response.approved → notify client (in-app + push + email)
  appEvents.on("form_response.approved", async (event) => {
    await notifyFromEvent(event);
  });

  // form_response.rejected → notify client (in-app + push + email, amber)
  appEvents.on("form_response.rejected", async (event) => {
    await notifyFromEvent(event);
  });

  // downpayment.confirmed → notify sales + paralegal + client
  appEvents.on("downpayment.confirmed", async (event) => {
    await notifyFromEvent(event);
  });

  // -------------------------------------------------------------------------
  // scheduling: appointment.booked/cancelled/rescheduled/completed → notifications
  // (F3: notify the counterpart — client ↔ staff — on each appointment lifecycle event)
  // -------------------------------------------------------------------------

  appEvents.on("appointment.booked", async (event) => {
    await notifyFromEvent(event);
  });

  appEvents.on("appointment.cancelled", async (event) => {
    await notifyFromEvent(event);
  });

  appEvents.on("appointment.rescheduled", async (event) => {
    await notifyFromEvent(event);
  });

  appEvents.on("appointment.completed", async (event) => {
    await notifyFromEvent(event);
  });

  // no_show has TWO consumers (like every appointment.* event): this one notifies
  // the client (amber, never red — RF-TRX-022); the timeline projection consumer
  // is registered below alongside the other appointment.* timeline writers.
  appEvents.on("appointment.no_show", async (event) => {
    await notifyFromEvent(event);
  });

  // -------------------------------------------------------------------------
  // scheduling → cases timeline (project appointment lifecycle to case_timeline,
  // visible to the client — DOC-41 §3.14). Lead/prospect appointments (no caseId)
  // do not write a case timeline entry.
  // -------------------------------------------------------------------------

  appEvents.on("appointment.booked", async (event) => {
    const p = event.payload as {
      caseId: string | null;
      bookedBy?: "client" | "staff";
      staffId?: string;
      clientUserId?: string | null;
    };
    if (!p.caseId) return;
    const byClient = p.bookedBy === "client";
    await appendAppointmentTimeline({
      caseId: p.caseId,
      eventType: "appointment.booked",
      actorKind: byClient ? "client" : "team",
      actorUserId: byClient ? (p.clientUserId ?? null) : (p.staffId ?? null),
    });
  });

  appEvents.on("appointment.cancelled", async (event) => {
    const p = event.payload as {
      caseId: string | null;
      cancelledBy?: "client" | "staff";
      staffId?: string;
      clientUserId?: string | null;
    };
    if (!p.caseId) return;
    const byClient = p.cancelledBy === "client";
    await appendAppointmentTimeline({
      caseId: p.caseId,
      eventType: "appointment.cancelled",
      actorKind: byClient ? "client" : "team",
      actorUserId: byClient ? (p.clientUserId ?? null) : (p.staffId ?? null),
    });
  });

  appEvents.on("appointment.rescheduled", async (event) => {
    const p = event.payload as {
      caseId: string | null;
      rescheduledBy?: "client" | "staff";
      staffId?: string;
      clientUserId?: string | null;
    };
    if (!p.caseId) return;
    const byClient = p.rescheduledBy === "client";
    await appendAppointmentTimeline({
      caseId: p.caseId,
      eventType: "appointment.rescheduled",
      actorKind: byClient ? "client" : "team",
      actorUserId: byClient ? (p.clientUserId ?? null) : (p.staffId ?? null),
    });
  });

  appEvents.on("appointment.completed", async (event) => {
    const p = event.payload as {
      caseId: string | null;
      staffId?: string;
      objectivesSummary?: { total: number; achieved: number } | null;
    };
    if (!p.caseId) return;
    // High-level summary only (the per-objective detail stays staff-internal on
    // appointments.objectives_outcome). "X de Y objetivos logrados".
    const s = p.objectivesSummary;
    const bodyOverride =
      s && s.total > 0
        ? {
            es: `Lograste ${s.achieved} de ${s.total} objetivos de la cita.`,
            en: `You achieved ${s.achieved} of ${s.total} appointment objectives.`,
          }
        : null;
    await appendAppointmentTimeline({
      caseId: p.caseId,
      eventType: "appointment.completed",
      actorKind: "team",
      actorUserId: p.staffId ?? null,
      bodyOverride,
    });
  });

  appEvents.on("appointment.no_show", async (event) => {
    const p = event.payload as { caseId: string | null; staffId?: string };
    if (!p.caseId) return;
    await appendAppointmentTimeline({
      caseId: p.caseId,
      eventType: "appointment.no_show",
      actorKind: "team",
      actorUserId: p.staffId ?? null,
    });
  });

  // -------------------------------------------------------------------------
  // kanban consumers (F3 — §3.8 automatic card listeners)
  // -------------------------------------------------------------------------

  // case.owner_changed → move the case card to the new owner's cases board and
  // remove it from the previous owner's board (handoff / reassign / creation).
  appEvents.on("case.owner_changed", async (event) => {
    const payload = event.payload as {
      caseId: string;
      orgId: string;
      fromOwnerId: string | null;
      toOwnerId: string | null;
    };
    if (!payload.caseId || !payload.orgId) return;
    logger.info({ caseId: payload.caseId }, "kanban: consuming case.owner_changed");
    await onCaseOwnerChanged(payload);
  });

  // contract.signed → create card on collections board (finance)
  appEvents.on("contract.signed", async (event) => {
    const payload = event.payload as { caseId: string; orgId: string };
    if (!payload.caseId || !payload.orgId) return;
    logger.info({ caseId: payload.caseId }, "kanban: consuming contract.signed");
    await onContractSignedKanban(payload);
  });

  // contract.signed → billing: re-anchor installment due dates (DOC-44 §5.2)
  appEvents.on("contract.signed", async (event) => {
    const payload = event.payload as {
      caseId: string;
      contractId: string;
      orgId: string;
      signedAt?: string;
    };
    if (!payload.contractId) return;
    logger.info({ caseId: payload.caseId, contractId: payload.contractId }, "billing: consuming contract.signed → reanchor");
    await onContractSignedBilling({
      contractId: payload.contractId,
      caseId: payload.caseId,
      signedAt: payload.signedAt ?? new Date().toISOString(),
      orgId: payload.orgId,
    });
  });

  // downpayment.confirmed → remove card from "Por cobrar inicial" if still there
  appEvents.on("downpayment.confirmed", async (event) => {
    const payload = event.payload as { caseId: string; orgId: string };
    if (!payload.caseId || !payload.orgId) return;
    logger.info({ caseId: payload.caseId }, "kanban: consuming downpayment.confirmed (kanban)");
    await onDownpaymentConfirmedKanban(payload);
  });

  // -------------------------------------------------------------------------
  // messaging consumers (F7-Ola7a)
  // -------------------------------------------------------------------------

  // downpayment.confirmed → ensure the case conversation exists + post the
  // welcome system message (idempotent; coexists with lazy first-read).
  appEvents.on("downpayment.confirmed", async (event) => {
    const payload = event.payload as { caseId: string };
    if (!payload.caseId) return;
    logger.info({ caseId: payload.caseId }, "messaging: consuming downpayment.confirmed → ensure conversation");
    try {
      await ensureCaseConversation(payload.caseId);
      await postSystemMessage(payload.caseId, "sys.downpayment_confirmed");
    } catch (err) {
      logger.error({ err, caseId: payload.caseId }, "messaging: ensure/system-message failed — conversation is lazily created on first read");
    }
  });

  // case.owner_changed → keep the case conversation's participants in sync with
  // the case's current assignments (DOC-46 §3.5/§5.2). The Legal handoff sets
  // assigned_paralegal_id and emits this event; without this consumer the newly
  // assigned paralegal never joins the thread (she can't see the case in her
  // inbox). Idempotent + no-op if the conversation doesn't exist yet.
  appEvents.on("case.owner_changed", async (event) => {
    const payload = event.payload as { caseId: string };
    if (!payload.caseId) return;
    logger.info({ caseId: payload.caseId }, "messaging: consuming case.owner_changed → sync participants");
    try {
      await syncCaseParticipants(payload.caseId);
    } catch (err) {
      logger.error({ err, caseId: payload.caseId }, "messaging: syncCaseParticipants failed — participants self-heal on next read");
    }
  });

  // message.sent → notifications anti-burst (F7-Ola7b §4.2): in-app digest +
  // push with 5 s grace, suppressed if the recipient reads the thread first.
  appEvents.on("message.sent", async (event) => {
    await notifyFromEvent(event);
  });

  // lead.created → notify assigned staff (matrix §4.3)
  appEvents.on("lead.created", async (event) => {
    await notifyFromEvent(event);
  });

  // -------------------------------------------------------------------------
  // evaluations (external tool Juez): PDF delivered / generation failed →
  // notifications (client + sales / sales). Timeline entries are written by
  // the evaluations service itself (same transaction path as the webhook).
  // -------------------------------------------------------------------------
  appEvents.on("evaluation.completed", async (event) => {
    await notifyFromEvent(event);
  });

  appEvents.on("evaluation.failed", async (event) => {
    await notifyFromEvent(event);
  });

  // -------------------------------------------------------------------------
  // ai-engine consumers (F4 — no-op in V2.0, hook for future wiring)
  // -------------------------------------------------------------------------
  registerAiEngineConsumers();

  // -------------------------------------------------------------------------
  // exhibits: generation.completed → capture cited sources (Index of Exhibits)
  // and fan out one fetch-exhibit job per source. Gated by the letter config
  // (attach_sources_enabled). Test runs are skipped (no paid renders).
  // -------------------------------------------------------------------------
  appEvents.on("generation.completed", async (event) => {
    const p = event.payload as { caseId: string; runId: string; isTest?: boolean };
    if (p.isTest || !p.runId) return;
    try {
      await captureFromRun({ runId: p.runId });
    } catch (err) {
      logger.error({ err, runId: p.runId }, "exhibits: captureFromRun failed");
    }
  });

  // exhibits.run_settled → expediente: auto-attach the ready exhibits into the draft,
  // right after the memo (handles exhibits finishing after Diana already assembled).
  appEvents.on("exhibits.run_settled", async (event) => {
    const p = event.payload as { caseId: string; runId: string };
    if (!p.caseId || !p.runId) return;
    try {
      await attachReadyExhibits({ caseId: p.caseId, runId: p.runId });
    } catch (err) {
      logger.error({ err, runId: p.runId }, "exhibits: attachReadyExhibits failed");
    }
  });

  // -------------------------------------------------------------------------
  // integrations consumers (F5 — validation.sent / validation.verdict_received;
  // notifications wired in F7, hook registered now)
  // -------------------------------------------------------------------------
  registerIntegrationsConsumers();

  // -------------------------------------------------------------------------
  // expediente.sent_to_finance → kanban (card on Andrium's collections board)
  //                            → cases (→ ready_for_delivery)
  // -------------------------------------------------------------------------
  appEvents.on("expediente.sent_to_finance", async (event) => {
    const payload = event.payload as { caseId: string; orgId: string; expedienteId: string; attemptNo: number };
    logger.info({ caseId: payload.caseId }, "kanban: consuming expediente.sent_to_finance");
    await onExpedienteSentToFinance({ caseId: payload.caseId, orgId: payload.orgId });
  });

  appEvents.on("expediente.sent_to_finance", async (event) => {
    const payload = event.payload as { caseId: string };
    logger.info({ caseId: payload.caseId }, "cases: consuming expediente.sent_to_finance → ready_for_delivery");
    await onExpedienteSentToFinanceCase({ caseId: payload.caseId });
  });

  // -------------------------------------------------------------------------
  // expediente.printed → cases (ready_for_delivery → delivered)
  //                    → kanban (move card to "Hecho") [F6-Ola2]
  // -------------------------------------------------------------------------
  appEvents.on("expediente.printed", async (event) => {
    const payload = event.payload as { caseId: string };
    logger.info({ caseId: payload.caseId }, "cases: consuming expediente.printed → delivered");
    await onExpedientePrintedCase({ caseId: payload.caseId });
  });

  appEvents.on("expediente.printed", async (event) => {
    const payload = event.payload as {
      caseId: string;
      orgId: string;
      expedienteId: string;
      attemptNo: number;
      printedAt: string;
      printedById: string;
    };
    if (!payload.orgId) return;
    logger.info({ caseId: payload.caseId }, "kanban: consuming expediente.printed → Hecho");
    await onExpedientePrintedKanban(payload);
  });

  // -------------------------------------------------------------------------
  // installment.overdue → kanban (create/move card to "Vencidas") [F6-Ola2]
  //                     → notifications (client reminder)
  // -------------------------------------------------------------------------
  appEvents.on("installment.overdue", async (event) => {
    const payload = event.payload as {
      caseId: string;
      orgId: string;
      installmentId: string;
      number: number;
      amountCents: number;
      dueDate: string;
      daysLate: number;
    };
    if (!payload.orgId) return;
    logger.info({ caseId: payload.caseId }, "kanban: consuming installment.overdue → Vencidas");
    await onInstallmentOverdue(payload);
  });

  appEvents.on("installment.overdue", async (event) => {
    await notifyFromEvent(event);
  });

  // payment.proof_submitted → notifications (Andrium)
  appEvents.on("payment.proof_submitted", async (event) => {
    await notifyFromEvent(event);
  });

  // payment.refunded → notifications (Andrium)
  appEvents.on("payment.refunded", async (event) => {
    await notifyFromEvent(event);
  });

  // zelle.match_suggested → notifications (finance reconciliation inbox, 0111)
  appEvents.on("zelle.match_suggested", async (event) => {
    await notifyFromEvent(event);
  });

  // installment.paid → notifications (client receipt)
  appEvents.on("installment.paid", async (event) => {
    await notifyFromEvent(event);
  });

  // autopay.charge_failed → notifications (client: pay manually; finance: in-app)
  appEvents.on("autopay.charge_failed", async (event) => {
    await notifyFromEvent(event);
  });

  // autopay.disabled → notifications (client + finance) [system kill-switch only]
  appEvents.on("autopay.disabled", async (event) => {
    await notifyFromEvent(event);
  });

  logger.info({}, "consumers: F2+F3+F4+F5+F6+F7-Ola7a/7b event consumers registered (kanban + ai-engine + integrations + andrium + billing-reanchor + overdue + printed + messaging + notifications anti-burst)");
}
