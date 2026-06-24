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
import { onDownpaymentConfirmed, onExpedienteSentToFinanceCase, onExpedientePrintedCase, appendAppointmentTimeline } from "@/backend/modules/cases";
import { notifyFromEvent } from "@/backend/modules/notifications";
import {
  onCaseAssigned,
  onContractSigned as onContractSignedKanban,
  onDownpaymentConfirmedKanban,
  onExpedienteSentToFinance,
  onInstallmentOverdue,
  onExpedientePrinted as onExpedientePrintedKanban,
} from "@/backend/modules/kanban";
import { onContractSigned as onContractSignedBilling } from "@/backend/modules/billing";
import { ensureCaseConversation, postSystemMessage } from "@/backend/modules/messaging";
import { registerAiEngineConsumers } from "@/backend/modules/ai-engine";
import { registerIntegrationsConsumers } from "@/backend/modules/integrations";
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

  // contract.signed → notify finance + sales + client
  appEvents.on("contract.signed", async (event) => {
    await notifyFromEvent(event);
  });

  // document.approved → notify client
  appEvents.on("document.approved", async (event) => {
    await notifyFromEvent(event);
  });

  // document.rejected → notify client
  appEvents.on("document.rejected", async (event) => {
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

  // case.assigned → create card on cases board of the assigned paralegal
  appEvents.on("case.assigned", async (event) => {
    const payload = event.payload as {
      caseId: string;
      assignedParalegalId: string;
      orgId: string;
      previousParalegalId?: string;
    };
    logger.info({ caseId: payload.caseId }, "kanban: consuming case.assigned");
    await onCaseAssigned(payload);
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
  // ai-engine consumers (F4 — no-op in V2.0, hook for future wiring)
  // -------------------------------------------------------------------------
  registerAiEngineConsumers();

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

  // installment.paid → notifications (client receipt)
  appEvents.on("installment.paid", async (event) => {
    await notifyFromEvent(event);
  });

  logger.info({}, "consumers: F2+F3+F4+F5+F6+F7-Ola7a/7b event consumers registered (kanban + ai-engine + integrations + andrium + billing-reanchor + overdue + printed + messaging + notifications anti-burst)");
}
