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

let registered = false;

/**
 * Idempotent registration — safe to call multiple times in dev hot-reload.
 */
export function registerConsumers(): void {
  if (registered) return;
  registered = true;

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

  logger.info({}, "consumers: F2 event consumers registered");
}
