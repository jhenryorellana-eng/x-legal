/**
 * IMAP client — single point of contact with the Migadu mailbox that receives
 * Chase "You received money with Zelle" alerts (zelle-recon module).
 *
 * Serverless-shaped: one short-lived TLS connection per sweep (QStash cron),
 * never a persistent IDLE process. The mailbox itself is the durable queue —
 * a failed sweep self-heals on the next run.
 *
 * Coexistence with Thunderbird (Henry reads this mailbox by hand): we NEVER
 * use \Seen. Processing is tracked with the custom keyword $Reconciled, so a
 * human opening an email can never make the worker skip a payment. Dovecot
 * (Migadu) supports custom keywords out of the box.
 */

import { ImapFlow } from "imapflow";
import { providerEnv } from "./env";
import { logger } from "./logger";

/** Custom IMAP keyword marking an email as ingested. NOT \Seen (see header). */
export const RECONCILED_FLAG = "$Reconciled";

/** Default upper bound of messages pulled per sweep (memory + lease bound). */
const DEFAULT_BATCH_LIMIT = 50;

export interface RawInboundEmail {
  uid: number;
  /** UIDVALIDITY of the mailbox at fetch time (uid is meaningless without it). */
  uidvalidity: number;
  /** Full raw RFC-822 source (the .eml bytes — canonical evidence). */
  source: Buffer;
  internalDate: Date | null;
}

export interface ZelleSweepResult {
  uidvalidity: bigint;
  /** Cursor to persist: every UID ≤ this was either processed or flagged. */
  newLastUid: number;
  fetched: number;
  processed: number;
  failed: number;
}

/**
 * Sweeps the ZELLE mailbox: fetches messages that are (a) above the persisted
 * UID cursor and (b) not yet flagged $Reconciled, hands each to `handle`, and
 * flags the ones that processed cleanly. A message whose handler throws stays
 * unflagged and below the returned cursor — the next sweep retries it.
 *
 * imapflow constraint: no IMAP commands may run while a fetch iterator is
 * open, so messages are buffered first (bounded by batchLimit) and flagged
 * after processing.
 */
export async function sweepZelleMailbox(
  opts: {
    sinceUid: number;
    knownUidvalidity: bigint | null;
    batchLimit?: number;
  },
  handle: (email: RawInboundEmail) => Promise<void>,
): Promise<ZelleSweepResult> {
  const imapEnv = providerEnv("zelleImap");
  const batchLimit = opts.batchLimit ?? DEFAULT_BATCH_LIMIT;

  const client = new ImapFlow({
    host: imapEnv.ZELLE_IMAP_HOST,
    port: imapEnv.ZELLE_IMAP_PORT,
    secure: true,
    auth: { user: imapEnv.ZELLE_IMAP_USER, pass: imapEnv.ZELLE_IMAP_PASS },
    logger: false,
    // Keep every network phase well under the sweep lease (90 s).
    socketTimeout: 60_000,
    greetingTimeout: 15_000,
    connectionTimeout: 20_000,
  });
  client.on("error", (err: Error) => {
    logger.warn({ err }, "imap: connection error event");
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock(imapEnv.ZELLE_IMAP_MAILBOX);
    try {
      const mailbox = client.mailbox;
      if (!mailbox || typeof mailbox === "boolean") {
        throw new Error("imap: mailbox open returned no state");
      }
      const uidvalidity = mailbox.uidValidity ?? BigInt(0);

      // UIDVALIDITY changed → every UID is meaningless: rescan from 0. The
      // $Reconciled keyword and the DB message_id/transaction_number dedupe
      // make the rescan harmless.
      const cursorValid =
        opts.knownUidvalidity !== null && uidvalidity === opts.knownUidvalidity;
      const sinceUid = cursorValid ? opts.sinceUid : 0;

      // Buffer first (see header note): fetch everything unflagged above the
      // cursor, up to batchLimit.
      const buffered: RawInboundEmail[] = [];
      for await (const msg of client.fetch(
        { uid: `${sinceUid + 1}:*`, unKeyword: RECONCILED_FLAG },
        { uid: true, source: true, internalDate: true },
        { uid: true },
      )) {
        // `n:*` quirk: IMAP always includes the highest-UID message even when
        // it is below the requested floor — filter it out explicitly.
        if (msg.uid <= sinceUid) continue;
        if (!msg.source) continue;
        buffered.push({
          uid: msg.uid,
          uidvalidity: Number(uidvalidity),
          source: msg.source as Buffer,
          internalDate: (msg.internalDate as Date | undefined) ?? null,
        });
        if (buffered.length >= batchLimit) break;
      }
      buffered.sort((a, b) => a.uid - b.uid);

      let processed = 0;
      const okUids: number[] = [];
      let firstFailedUid: number | null = null;

      for (const email of buffered) {
        try {
          await handle(email);
          processed += 1;
          okUids.push(email.uid);
        } catch (err) {
          // Stays unflagged → retried next sweep. Log by uid only (no PII).
          firstFailedUid = firstFailedUid ?? email.uid;
          logger.error({ err, uid: email.uid }, "imap: message handler failed — will retry");
        }
      }

      if (okUids.length > 0) {
        await client.messageFlagsAdd(
          { uid: okUids.join(",") },
          [RECONCILED_FLAG],
          { uid: true },
        );
      }

      // Cursor may only advance across a contiguous prefix of successes: a
      // failed UID must remain above the cursor so the next sweep finds it.
      const maxUidSeen = buffered.length > 0 ? buffered[buffered.length - 1].uid : sinceUid;
      const newLastUid =
        firstFailedUid !== null
          ? Math.max(sinceUid, firstFailedUid - 1)
          : Math.max(sinceUid, maxUidSeen);

      return {
        uidvalidity,
        newLastUid,
        fetched: buffered.length,
        processed,
        failed: buffered.length - processed,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {
      // logout is best-effort; the socket dies with the lambda anyway
    });
  }
}
