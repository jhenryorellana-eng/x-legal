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
import { onDownpaymentConfirmed } from "@/backend/modules/cases";
import { notifyFromEvent } from "@/backend/modules/notifications";
import {
  onCaseAssigned,
  onContractSigned,
  onDownpaymentConfirmedKanban,
} from "@/backend/modules/kanban";
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
    await onContractSigned(payload);
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

  logger.info({}, "consumers: F2+F3 event consumers registered (kanban listeners included)");
}
