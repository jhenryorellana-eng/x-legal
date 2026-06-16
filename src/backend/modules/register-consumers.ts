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
import { onDownpaymentConfirmed, onExpedienteSentToFinanceCase, onExpedientePrintedCase } from "@/backend/modules/cases";
import { notifyFromEvent } from "@/backend/modules/notifications";
import {
  onCaseAssigned,
  onContractSigned as onContractSignedKanban,
  onDownpaymentConfirmedKanban,
  onExpedienteSentToFinance,
} from "@/backend/modules/kanban";
import { onContractSigned as onContractSignedBilling } from "@/backend/modules/billing";
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

  // contract.signed → notify finance + sales
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
  // -------------------------------------------------------------------------
  appEvents.on("expediente.printed", async (event) => {
    const payload = event.payload as { caseId: string };
    logger.info({ caseId: payload.caseId }, "cases: consuming expediente.printed → delivered");
    await onExpedientePrintedCase({ caseId: payload.caseId });
  });

  logger.info({}, "consumers: F2+F3+F4+F5+F5-Ola3+F6-Ola1 event consumers registered (kanban + ai-engine + integrations + andrium + billing-reanchor)");
}
