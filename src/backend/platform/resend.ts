/**
 * Resend email client — DOC-73 §1.5.
 *
 * Single point of contact with the Resend API. No module calls Resend
 * directly; all email sending flows through this client.
 *
 * Senders (DOC-73 §1.3 canonically uses the `mail.` subdomain; we send from the
 * ROOT domain `usalatinoprime.com` because that is the domain verified in Resend
 * — decisión Henry 2026-06-16. Switch back to `mail.usalatinoprime.com` once that
 * subdomain is verified for reputation isolation).
 * - Transactional: `UsaLatinoPrime <notificaciones@usalatinoprime.com>`
 * - Campaigns: `UsaLatinoPrime <novedades@usalatinoprime.com>`
 *
 * Usage pattern (DOC-73 §1.5):
 * - notifications/service.ts → sendTransactional()
 * - jobs/send-campaign.ts → sendBatch()
 *
 * Note: email sending always runs inside a QStash job (with retries + backoff),
 * never in the request lifecycle (DOC-73 §1.5).
 */

import { Resend } from "resend";
import { providerEnv } from "./env";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Canonical senders
// ---------------------------------------------------------------------------

export const FROM_TRANSACTIONAL =
  "UsaLatinoPrime <notificaciones@usalatinoprime.com>";

export const FROM_CAMPAIGNS =
  "UsaLatinoPrime <novedades@usalatinoprime.com>";

// ---------------------------------------------------------------------------
// Client factory (lazy)
// ---------------------------------------------------------------------------

let _client: Resend | null = null;

function getClient(): Resend {
  if (!_client) {
    const resendEnv = providerEnv("resend");
    _client = new Resend(resendEnv.RESEND_API_KEY);
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransactionalEmailOptions {
  to: string | string[];
  subject: string;
  /** react-email rendered component or raw HTML string */
  html: string;
  /** Optional plain-text fallback */
  text?: string;
  /** Override from address (defaults to FROM_TRANSACTIONAL) */
  from?: string;
  /** Optional reply-to address (should be from orgs.settings) */
  replyTo?: string;
  /** Idempotency key for dedup (use the notification id or event id) */
  idempotencyKey?: string;
}

export interface BatchEmailItem {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

// ---------------------------------------------------------------------------
// sendTransactional
// ---------------------------------------------------------------------------

/**
 * Sends a single transactional email via Resend.
 *
 * Used by: notifications/service.ts, identity/service.ts (staff invite)
 */
export async function sendTransactional(
  options: TransactionalEmailOptions,
): Promise<{ id: string }> {
  const client = getClient();

  const { data, error } = await client.emails.send({
    from: options.from ?? FROM_TRANSACTIONAL,
    to: Array.isArray(options.to) ? options.to : [options.to],
    subject: options.subject,
    html: options.html,
    ...(options.text && { text: options.text }),
    ...(options.replyTo && { reply_to: options.replyTo }),
  });

  if (error || !data) {
    logger.error(
      { err: error, subject: options.subject },
      "resend: failed to send transactional email",
    );
    throw new Error(`Resend send failed: ${error?.message}`);
  }

  logger.info(
    { emailId: data.id, subject: options.subject },
    "resend: transactional email sent",
  );

  return { id: data.id };
}

// ---------------------------------------------------------------------------
// sendBatch
// ---------------------------------------------------------------------------

/**
 * Sends a batch of emails via Resend (used by the send-campaign job).
 *
 * Resend batch API accepts up to 100 emails per call (DOC-73).
 */
export async function sendBatch(
  emails: BatchEmailItem[],
): Promise<{ ids: string[] }> {
  const client = getClient();

  const payload = emails.map((e) => ({
    from: e.from ?? FROM_CAMPAIGNS,
    to: Array.isArray(e.to) ? e.to : [e.to],
    subject: e.subject,
    html: e.html,
    ...(e.text && { text: e.text }),
  }));

  const { data, error } = await client.batch.send(payload);

  if (error || !data) {
    logger.error({ err: error, count: emails.length }, "resend: batch send failed");
    throw new Error(`Resend batch failed: ${(error as { message?: string })?.message}`);
  }

  // CreateBatchSuccessResponse has shape: { data: { id: string }[] }
  const ids = data.data.map((r) => r.id);
  logger.info({ count: ids.length }, "resend: batch emails sent");

  return { ids };
}
