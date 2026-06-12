/**
 * Web Push client — DOC-20 §2 (push notifications via VAPID).
 *
 * Sends push notifications to client browsers/PWA.
 * The Capacitor mobile phase will delegate to Capacitor Push instead, but the
 * web-push VAPID path remains active for the browser/PWA build.
 *
 * VAPID keys are generated once with `web-push generate-vapid-keys --json`
 * and stored in Vercel env (DOC-27 §7.1).
 *
 * `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is exposed to the client for service worker
 * subscription; `VAPID_PRIVATE_KEY` never leaves the server.
 */

import webpush, { type PushSubscription } from "web-push";
import { providerEnv } from "./env.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// VAPID initialization (lazy)
// ---------------------------------------------------------------------------

let _initialized = false;

function ensureVapidConfigured(): void {
  if (_initialized) return;

  const wpenv = providerEnv("webpush");

  webpush.setVapidDetails(
    // Subject: identifies the sender (must be mailto: or https: URL)
    `mailto:noreply@usalatinoprime.com`,
    wpenv.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    wpenv.VAPID_PRIVATE_KEY,
  );

  _initialized = true;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PushPayload {
  title: string;
  body: string;
  /** Deep-link URL to open on tap */
  url?: string;
  /** Icon URL (served from /public or Storage) */
  icon?: string;
  /** Notification badge count (for iOS/Android PWA) */
  badge?: string;
  /** Notification tag — deduplicates notifications of the same type */
  tag?: string;
}

// ---------------------------------------------------------------------------
// sendPush
// ---------------------------------------------------------------------------

/**
 * Sends a web push notification to a single subscription endpoint.
 *
 * Returns silently if the subscription endpoint has gone stale (410 Gone) —
 * the caller should remove the subscription from `push_subscriptions`.
 *
 * @param subscription - The PushSubscription object stored in `push_subscriptions`
 * @param payload - Notification content
 * @returns `{ stale: true }` when the subscription should be deleted (410)
 */
export async function sendPush(
  subscription: PushSubscription,
  payload: PushPayload,
): Promise<{ stale: boolean }> {
  ensureVapidConfigured();

  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify(payload),
      {
        TTL: 24 * 60 * 60, // 24 hours — notification is still relevant for a day
      },
    );
    return { stale: false };
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode;

    if (status === 410 || status === 404) {
      // Subscription expired or unregistered
      logger.info(
        { status, endpoint: subscription.endpoint.slice(0, 60) },
        "webpush: stale subscription detected",
      );
      return { stale: true };
    }

    logger.error(
      { err, endpoint: subscription.endpoint.slice(0, 60) },
      "webpush: failed to send push notification",
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Re-export VAPID public key accessor
// ---------------------------------------------------------------------------

/**
 * Returns the VAPID public key for the browser subscription step.
 * Use in the service worker registration endpoint.
 */
export function getVapidPublicKey(): string {
  return providerEnv("webpush").NEXT_PUBLIC_VAPID_PUBLIC_KEY;
}
