/**
 * QStash job: send-campaign (DOC-26 §2.5)
 *
 * Self-chaining batch sender. Each invocation processes up to 100 pending
 * recipients (via campaigns.sendCampaignBatch) and, if more remain, enqueues
 * the next batch with a 1s delay (~1 req/s rate, well under Resend limits).
 *
 * Idempotency: dedupeId per batch (QStash dedup) + the qstash route's
 * webhook_events barrier + the status='pending' filter inside sendCampaignBatch.
 * Cancellation mid-send: sendCampaignBatch aborts when status !== 'sending'.
 *
 * Boundary: imports ONLY from module index + platform.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import { enqueueJob } from "@/backend/platform/qstash";
import { sendCampaignBatch } from "@/backend/modules/campaigns";

const PayloadSchema = z.object({
  jobKey: z.literal("send-campaign"),
  campaignId: z.string().uuid(),
  orgId: z.string().uuid(),
  batch: z.number().int().positive().default(1),
  dedupeId: z.string(),
});

export async function handleSendCampaign(rawPayload: unknown): Promise<void> {
  const parsed = PayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    logger.error({ issues: parsed.error.issues }, "send-campaign: invalid payload — skipping");
    return; // non-retriable
  }

  const { campaignId, orgId, batch } = parsed.data;

  const result = await sendCampaignBatch(campaignId);

  logger.info(
    { campaignId, batch, status: result.status, hasMore: result.hasMore },
    "send-campaign: batch processed",
  );

  if (result.hasMore) {
    const next = batch + 1;
    await enqueueJob(
      {
        jobKey: "send-campaign",
        entityId: campaignId,
        attempt: 1,
        dedupeId: `send-campaign:${campaignId}:batch-${next}`,
        orgId,
        campaignId,
        batch: next,
      },
      { delay: 1 },
    );
  }
}
