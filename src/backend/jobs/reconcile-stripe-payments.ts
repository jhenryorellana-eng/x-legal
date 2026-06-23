/**
 * QStash job: reconcile-stripe-payments
 *
 * Cron job (every 15 min) — the safety net of the card-payment confirmation
 * stack (DOC-71 §3.6). It sweeps pending/stripe payments whose Checkout Session
 * WAS created but never confirmed (older than the cutoff), retrieves each session
 * from Stripe, and settles it (paid) or fails it (expired).
 *
 * Why this exists: card confirmation funnels through three converging layers, all
 * idempotent via applyPaymentSuccess:
 *   1. the Stripe webhook (checkout.session.completed) — real-time,
 *   2. reconcileCheckoutSession on the success_url return — immediate for the user,
 *   3. THIS cron — catches the case where the webhook never arrived AND the client
 *      closed the tab before the return-URL reconcile ran.
 *
 * Complements expire-stale-checkouts, which clears session_id-NULL orphans; this
 * job handles session_id-NOT-NULL rows that are awaiting confirmation.
 *
 * Schedule (QStash): every 15 min — see provision-schedules.md.
 *
 * Boundary: imports ONLY from module index.ts, platform/, and shared/ (rule R3).
 */

import { z } from "zod";
import { systemActor } from "@/backend/platform/authz";
import { logger } from "@/backend/platform/logger";
import { reconcilePendingStripePayments } from "@/backend/modules/billing";

const ReconcileStripePaymentsPayloadSchema = z.object({
  jobKey: z.literal("reconcile-stripe-payments"),
  entityId: z.null().optional(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string().min(1),
  /** Override the default 3-min cutoff (mainly for tests). */
  olderThanMinutes: z.number().int().positive().optional(),
});

export type ReconcileStripePaymentsPayload = z.infer<
  typeof ReconcileStripePaymentsPayloadSchema
>;

/**
 * Handles the reconcile-stripe-payments cron job.
 *
 * Called by the QStash route handler via JOB_REGISTRY.
 */
export async function handleReconcileStripePayments(
  rawPayload: unknown,
): Promise<void> {
  const parseResult = ReconcileStripePaymentsPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "reconcile-stripe-payments: invalid payload — skipping",
    );
    return; // Non-retriable: payload schema error
  }

  const actor = systemActor();

  try {
    const result = await reconcilePendingStripePayments(actor, {
      olderThanMinutes: parseResult.data.olderThanMinutes,
    });
    logger.info(
      {
        job: "reconcile-stripe-payments",
        examined: result.reconciled,
        settled: result.settled,
        alreadySettled: result.alreadySettled,
        expired: result.expired,
      },
      "reconcile-stripe-payments: done",
    );
  } catch (err) {
    logger.error({ err }, "reconcile-stripe-payments: failed — surfacing for retry");
    throw err; // Surface to QStash for retry
  }
}
