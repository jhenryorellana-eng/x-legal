/**
 * Twilio Messaging client — DOC-20 §2 / DOC-22 §1.1.
 *
 * ONLY for transactional SMS (3 critical sends per DOC-20 §2):
 *   1. Contract signing link (firma/{signing_token})
 *   2. Client welcome message (post-downpayment.confirmed)
 *   3. Signature reminder (contract-reminder)
 *
 * OTP / phone verification uses Twilio Verify configured INSIDE Supabase Auth,
 * NOT these credentials. These Twilio vars are Messaging-only (DOC-27 §7.1).
 *
 * The Twilio Messaging Service SID is used so Twilio handles sender selection
 * (long code / short code / toll-free) based on destination country.
 */

import Twilio from "twilio";
import { providerEnv } from "./env.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Client factory (lazy)
// ---------------------------------------------------------------------------

let _client: ReturnType<typeof Twilio> | null = null;

function getClient(): ReturnType<typeof Twilio> {
  if (!_client) {
    const tenv = providerEnv("twilio");
    _client = Twilio(tenv.TWILIO_ACCOUNT_SID, tenv.TWILIO_AUTH_TOKEN);
  }
  return _client;
}

// ---------------------------------------------------------------------------
// sendSms
// ---------------------------------------------------------------------------

export interface SendSmsOptions {
  /** E.164 destination number (e.g. +13105551234) */
  to: string;
  /** Message body (≤ 160 chars for single segment; longer = multipart) */
  body: string;
}

/**
 * Sends a transactional SMS via the Twilio Messaging Service.
 *
 * @returns Twilio message SID for tracking / audit log
 */
export async function sendSms(options: SendSmsOptions): Promise<{ sid: string }> {
  const tenv = providerEnv("twilio");
  const client = getClient();

  const message = await client.messages.create({
    to: options.to,
    messagingServiceSid: tenv.TWILIO_MESSAGING_SERVICE_SID,
    body: options.body,
  });

  logger.info(
    { sid: message.sid, status: message.status },
    "twilio: SMS sent",
  );

  return { sid: message.sid };
}
