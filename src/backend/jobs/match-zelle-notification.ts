/**
 * QStash job: match-zelle-notification
 *
 * Fan-out per parsed bank transaction (enqueued by the ingest sweep). Scores
 * candidates, decides tier A auto-settlement (atomic RPC) vs review inbox,
 * and notifies finance on anything that needs human eyes.
 *
 * Idempotency: dedupeId = `match-zelle:<transaction_number>` (webhook_events
 * barrier) + the notification lifecycle guard inside the service.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import { matchZelleNotification } from "@/backend/modules/zelle-recon";

const MatchZelleNotificationPayloadSchema = z.object({
  jobKey: z.literal("match-zelle-notification"),
  entityId: z.string().uuid(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string().min(1),
  orgId: z.string().uuid().optional(),
});

export type MatchZelleNotificationPayload = z.infer<typeof MatchZelleNotificationPayloadSchema>;

export async function handleMatchZelleNotification(rawPayload: unknown): Promise<void> {
  const parseResult = MatchZelleNotificationPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "match-zelle-notification: invalid payload — skipping",
    );
    return;
  }

  try {
    await matchZelleNotification(parseResult.data.entityId);
  } catch (err) {
    logger.error(
      { err, notificationId: parseResult.data.entityId },
      "match-zelle-notification: failed — surfacing for retry",
    );
    throw err;
  }
}
