/**
 * QStash job: zelle-ingest-heartbeat
 *
 * Cron (hourly) — alerts org admins when the Zelle mailbox has had no
 * successful sweep for hours: dead worker, revoked IMAP app password, broken
 * Migadu filter, or the Chase alert was turned off. "No emails" is expected;
 * "no successful sweeps" never is.
 *
 * Schedule (QStash): hourly — see provision-schedules.md.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import { checkIngestHeartbeat } from "@/backend/modules/zelle-recon";

const ZelleIngestHeartbeatPayloadSchema = z.object({
  jobKey: z.literal("zelle-ingest-heartbeat"),
  entityId: z.null().optional(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string().min(1),
});

export type ZelleIngestHeartbeatPayload = z.infer<typeof ZelleIngestHeartbeatPayloadSchema>;

export async function handleZelleIngestHeartbeat(rawPayload: unknown): Promise<void> {
  const parseResult = ZelleIngestHeartbeatPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "zelle-ingest-heartbeat: invalid payload — skipping",
    );
    return;
  }

  try {
    await checkIngestHeartbeat();
  } catch (err) {
    logger.error({ err }, "zelle-ingest-heartbeat: failed — surfacing for retry");
    throw err;
  }
}
