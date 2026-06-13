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
// Subject and body templates
// ---------------------------------------------------------------------------

function buildEmailSubject(
  templateKey: string,
  locale: string,
): string {
  const subjects: Record<string, { en: string; es: string }> = {
    "contract-signed-finance": {
      en: "New contract signed — collect down payment",
      es: "Nuevo contrato firmado — cobrar cuota inicial",
    },
    "document-approved": {
      en: "Your document was approved",
      es: "Tu documento fue aprobado",
    },
    "document-rejected": {
      en: "Your document needs a correction",
      es: "Tu documento necesita una corrección",
    },
    "downpayment-confirmed-sales": {
      en: "Down payment received — case is active",
      es: "Pago inicial recibido — caso activo",
    },
    "downpayment-confirmed": {
      en: "Welcome — your case is now active",
      es: "Bienvenido — tu caso está activo",
    },
  };

  const entry = subjects[templateKey];
  if (!entry) return templateKey;

  return locale === "en" ? entry.en : entry.es;
}

function buildEmailHtml(
  templateKey: string,
  notification: { title_i18n: unknown; body_i18n: unknown; action_url: string | null },
  locale: string,
): string {
  // Simple text-based HTML — react-email templates are a future enhancement.
  // These provide functional email content while keeping F2 scope minimal.
  const title =
    (notification.title_i18n as Record<string, string> | null)?.[locale] ??
    (notification.title_i18n as Record<string, string> | null)?.["es"] ??
    templateKey;
  const body =
    (notification.body_i18n as Record<string, string> | null)?.[locale] ??
    (notification.body_i18n as Record<string, string> | null)?.["es"] ??
    "";

  const ctaText = locale === "en" ? "View details" : "Ver detalles";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: 'Plus Jakarta Sans', sans-serif; color: #1a1a2e; background: #f8f9fa; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="background: #003366; width: 40px; height: 40px; border-radius: 8px; margin-bottom: 24px;"></div>
    <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 12px;">${title}</h1>
    ${body ? `<p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">${body}</p>` : ""}
    ${notification.action_url ? `<a href="https://app.usalatinoprime.com${notification.action_url}" style="display: inline-block; background: #003366; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">${ctaText}</a>` : ""}
  </div>
</body>
</html>`;
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
    const subject = buildEmailSubject(payload.templateKey, payload.locale);
    const html = buildEmailHtml(payload.templateKey, notification, payload.locale);

    try {
      await sendTransactional({
        to: payload.recipientEmail,
        subject,
        html,
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
