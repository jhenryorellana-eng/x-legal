/**
 * QStash job: charge-due-installments
 *
 * Daily MIT (merchant-initiated) charge cron for autopay-enrolled plans
 * (DOC-71 §2.4). Charges pending/overdue installments with due_date <= today
 * off-session against the client's saved card:
 *
 *   - Retry policy (Henry 2026-07-03): the cron runs daily, so a failed charge
 *     naturally retries the next day; after 3 failed attempts (derived from
 *     failed autopay payments) the plan's autopay is disabled (kill-switch).
 *   - SCA (authentication_required) disables autopay immediately — off-session
 *     retries cannot complete a bank challenge; the client pays manually and
 *     re-enrolls.
 *   - Runs at 10:30 UTC, BEFORE installment-reminders (11:00 UTC), so charged
 *     installments are already processing/paid when reminders are computed.
 *
 * Idempotency: the payments row acts as a DB mutex (unique partial index) and
 * the PaymentIntent uses idempotencyKey `autopay:<paymentId>`; a duplicate run
 * skips targets whose mutex is held.
 *
 * Boundary: imports ONLY from module index.ts, platform/, and shared/ (rule R3).
 *
 * Schedule (QStash): daily 10:30 UTC — see provision-schedules.md.
 */

import { z } from "zod";
import { systemActor } from "@/backend/platform/authz";
import { logger } from "@/backend/platform/logger";
import { chargeDueInstallments } from "@/backend/modules/billing";

const ChargeDueInstallmentsPayloadSchema = z.object({
  jobKey: z.literal("charge-due-installments"),
  entityId: z.null().optional(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string().min(1),
  /** YYYY-MM-DD override (mainly for tests / manual runs). */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type ChargeDueInstallmentsPayload = z.infer<
  typeof ChargeDueInstallmentsPayloadSchema
>;

/**
 * Handles the charge-due-installments cron job.
 *
 * Called by the QStash route handler via JOB_REGISTRY.
 */
export async function handleChargeDueInstallments(rawPayload: unknown): Promise<void> {
  const parseResult = ChargeDueInstallmentsPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "charge-due-installments: invalid payload — skipping",
    );
    return; // Non-retriable: payload schema error
  }

  const actor = systemActor();

  try {
    const result = await chargeDueInstallments(actor, parseResult.data.today);
    logger.info(
      { job: "charge-due-installments", ...result },
      "charge-due-installments: done",
    );
  } catch (err) {
    logger.error({ err }, "charge-due-installments: failed — surfacing for retry");
    throw err; // Surface to QStash for retry (per-target errors are already contained)
  }
}
