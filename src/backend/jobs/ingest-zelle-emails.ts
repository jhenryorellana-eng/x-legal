/**
 * QStash job: ingest-zelle-emails
 *
 * Cron (every 2 min) — sweeps the Migadu ZELLE mailbox over IMAP, verifies
 * Chase authenticity via the Migadu Authentication-Results stamp, stores the
 * raw .eml as evidence, parses the payment and fans out one
 * match-zelle-notification job per NEW transaction.
 *
 * Concurrency: a row-lease in zelle_ingest_state guarantees one sweep at a
 * time; an overlapping cron exits without work. The mailbox is the durable
 * queue — a failed run self-heals on the next sweep.
 *
 * Schedule (QStash): every 2 min, retries 0 — see provision-schedules.md.
 *
 * Boundary: imports ONLY from module index.ts, platform/, and shared/ (R3).
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import { runZelleIngestSweep } from "@/backend/modules/zelle-recon";

const IngestZelleEmailsPayloadSchema = z.object({
  jobKey: z.literal("ingest-zelle-emails"),
  entityId: z.null().optional(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string().min(1),
});

export type IngestZelleEmailsPayload = z.infer<typeof IngestZelleEmailsPayloadSchema>;

export async function handleIngestZelleEmails(rawPayload: unknown): Promise<void> {
  const parseResult = IngestZelleEmailsPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "ingest-zelle-emails: invalid payload — skipping",
    );
    return; // Non-retriable: payload schema error
  }

  try {
    const result = await runZelleIngestSweep();
    if (result.fetched > 0 || result.failed > 0) {
      logger.info({ job: "ingest-zelle-emails", ...result }, "ingest-zelle-emails: done");
    }
  } catch (err) {
    // retries=0 on the schedule: surfacing marks the run failed in QStash
    // logs; the next 2-min sweep picks the mailbox up again.
    logger.error({ err }, "ingest-zelle-emails: sweep failed");
    throw err;
  }
}
