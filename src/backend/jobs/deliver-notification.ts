/**
 * QStash job: deliver-notification
 *
 * Handles delivery of heavy notification channels (email, push) outside
 * the request lifecycle (DOC-26 §1, SOT-7).
 *
 * Payload shape (JobEnvelope extension):
 *   - jobKey: "deliver-notification"
 *   - entityId: notificationId
 *   - channel: "email" | "push"
 *   - notificationId: string
 *   - (email) templateKey: string, recipientEmail: string, locale: string
 *
 * QStash fallback (dev): if QStash is not configured, send inline with logger.warn.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import { sendTransactional } from "@/backend/platform/resend";
import { renderTransactionalEmail } from "@/backend/platform/emails";
import { findNotificationById } from "@/backend/modules/notifications";

// ---------------------------------------------------------------------------
// Payload schema
// ---------------------------------------------------------------------------

const EmailChannelSchema = z.object({
  channel: z.literal("email"),
  notificationId: z.string().uuid(),
  templateKey: z.string(),
  recipientEmail: z.string().email(),
  locale: z.string().default("es"),
});

const PushChannelSchema = z.object({
  channel: z.literal("push"),
  notificationId: z.string().uuid(),
});

const DeliverNotificationPayloadSchema = z.discriminatedUnion("channel", [
  EmailChannelSchema,
  PushChannelSchema,
]);

export type DeliverNotificationPayload = z.infer<
  typeof DeliverNotificationPayloadSchema
>;

// ---------------------------------------------------------------------------
// i18n picker
// ---------------------------------------------------------------------------

/** Picks a localized string from an i18n jsonb map, falling back es → key. */
function pickI18n(
  map: unknown,
  locale: string,
  fallback: string,
): string {
  const record = map as Record<string, string> | null;
  return record?.[locale] ?? record?.["es"] ?? fallback;
}

// ---------------------------------------------------------------------------
// Job handler
// ---------------------------------------------------------------------------

/**
 * Executes a deliver-notification job.
 *
 * Called by the QStash route handler.
 * Returns silently on success; throws on unrecoverable error.
 */
export async function handleDeliverNotification(
  rawPayload: unknown,
): Promise<void> {
  // Parse and validate payload
  const parseResult = DeliverNotificationPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "deliver-notification: invalid payload — skipping",
    );
    return; // Don't retry on schema errors
  }

  const payload = parseResult.data;

  // Fetch the notification
  const notification = await findNotificationById(payload.notificationId);
  if (!notification) {
    logger.warn(
      { notificationId: payload.notificationId },
      "deliver-notification: notification not found — skipping",
    );
    return;
  }

  if (payload.channel === "email") {
    const title = pickI18n(notification.title_i18n, payload.locale, payload.templateKey);
    const body = pickI18n(notification.body_i18n, payload.locale, "");
    const { subject, html, text } = await renderTransactionalEmail({
      templateKey: payload.templateKey,
      locale: payload.locale,
      title,
      body: body || undefined,
      actionPath: notification.action_url,
    });

    try {
      await sendTransactional({
        to: payload.recipientEmail,
        subject,
        html,
        text,
        idempotencyKey: `notification:${notification.id}:email:${payload.templateKey}`,
      });

      logger.info(
        {
          notificationId: notification.id,
          templateKey: payload.templateKey,
          // SECURITY: recipient email NOT logged (PII)
        },
        "deliver-notification: email sent",
      );
    } catch (err) {
      // Re-throw so QStash retries
      logger.error(
        { err, notificationId: notification.id, templateKey: payload.templateKey },
        "deliver-notification: email send failed",
      );
      throw err;
    }
  } else if (payload.channel === "push") {
    // Push delivery (web push VAPID) — F2 minimal stub
    // Full implementation in F3 (platform/webpush.ts + push_subscriptions)
    logger.info(
      { notificationId: notification.id },
      "deliver-notification: push channel — not yet implemented in F2",
    );
  }
}
