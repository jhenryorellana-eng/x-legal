/**
 * QStash job: expire-stale-checkouts
 *
 * Cron job (hourly) that clears orphaned Stripe checkout attempts:
 * pending/stripe payment rows whose Checkout Session was never created
 * (stripe_checkout_session_id IS NULL) and that are older than the cutoff.
 *
 * Why this exists: createCheckoutSessionForInstallment inserts the payment row
 * BEFORE calling Stripe (the BD is the mutex via payments_active_stripe_unique_idx).
 * If stripe.checkout.sessions.create then throws, the row is orphaned and blocks
 * any future checkout for that installment. The lazy cleanup at the top of
 * createCheckoutSessionForInstallment handles the retry path; this cron is the
 * backstop for installments the client never retries.
 *
 * Sessions that WERE created and then expire are handled by the Stripe webhook
 * (checkout.session.expired) — out of scope here.
 *
 * Schedule (QStash): hourly — see provision-schedules.md.
 *
 * Boundary: imports ONLY from module index.ts, platform/, and shared/ (rule R3).
 */

import { z } from "zod";
import { systemActor } from "@/backend/platform/authz";
import { logger } from "@/backend/platform/logger";
import { expireOrphanCheckouts } from "@/backend/modules/billing";

const ExpireStaleCheckoutsPayloadSchema = z.object({
  jobKey: z.literal("expire-stale-checkouts"),
  entityId: z.null().optional(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string().min(1),
  /** Override the default 60-min cutoff (mainly for tests). */
  olderThanMinutes: z.number().int().positive().optional(),
});

export type ExpireStaleCheckoutsPayload = z.infer<
  typeof ExpireStaleCheckoutsPayloadSchema
>;

/**
 * Handles the expire-stale-checkouts cron job.
 *
 * Called by the QStash route handler via JOB_REGISTRY.
 */
export async function handleExpireStaleCheckouts(
  rawPayload: unknown,
): Promise<void> {
  const parseResult = ExpireStaleCheckoutsPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "expire-stale-checkouts: invalid payload — skipping",
    );
    return; // Non-retriable: payload schema error
  }

  const actor = systemActor();

  try {
    const result = await expireOrphanCheckouts(actor, {
      olderThanMinutes: parseResult.data.olderThanMinutes,
    });
    logger.info(
      { job: "expire-stale-checkouts", expired: result.expired },
      "expire-stale-checkouts: done",
    );
  } catch (err) {
    logger.error({ err }, "expire-stale-checkouts: failed — surfacing for retry");
    throw err; // Surface to QStash for retry
  }
}
