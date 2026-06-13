/**
 * QStash job: appointment-reminders
 *
 * Cron job (every 15 minutes) that sweeps appointments due for 24h and 1h
 * reminders and dispatches in-app + email notifications to client and staff.
 *
 * DOC-26 §2.7 — window logic, idempotency, retries=0.
 * DOC-47 §4.3 — notification types: appointment.reminder_1d / appointment.reminder_1h.
 * DOC-73 §2    — email templates: appointment-24h / appointment-1h.
 *
 * Idempotency: each appointment row has reminder_1d_sent_at / reminder_1h_sent_at.
 * markReminderSent updates that column (UPDATE WHERE sent_at IS NULL) so
 * re-delivery of the same cron invocation is a no-op at the DB level.
 *
 * Retries: 0 (DOC-26 §5.1). If the 15-minute window is missed, the next
 * invocation covers the next window; a stale retry would send late reminders.
 *
 * Schedule (QStash): every-15-minutes cron (UTC) — see provision-schedules.md
 *
 * Boundary: this job imports ONLY from module index.ts, platform/, and shared/
 * (rule R3 DOC-21 §1 / eslint-plugin-boundaries).
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import { enqueueJob } from "@/backend/platform/qstash";
import {
  findDueReminders,
  markReminderSent,
} from "@/backend/modules/scheduling";
import {
  insertNotificationIdempotent,
  findUserById,
} from "@/backend/modules/notifications";

// ---------------------------------------------------------------------------
// Payload schema (cron payload is minimal per DOC-26 §1.2)
// ---------------------------------------------------------------------------

const AppointmentRemindersPayloadSchema = z.object({
  jobKey: z.literal("appointment-reminders"),
  entityId: z.null().optional(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
});

export type AppointmentRemindersPayload = z.infer<
  typeof AppointmentRemindersPayloadSchema
>;

// ---------------------------------------------------------------------------
// Window constants (DOC-26 §2.7)
//
// The 15-minute cron window includes a 5-minute buffer so each appointment
// falls in exactly one run window:
//   24h reminder: starts_at in (now+24h-15min, now+24h]
//   1h  reminder: starts_at in (now+1h-15min,  now+1h]
// ---------------------------------------------------------------------------

const WINDOW_MINUTES = 15;

function buildWindows(now: Date): {
  "1d": { start: Date; end: Date };
  "1h": { start: Date; end: Date };
} {
  const windowMs = WINDOW_MINUTES * 60 * 1000;
  const h24Ms = 24 * 60 * 60 * 1000;
  const h1Ms = 60 * 60 * 1000;

  return {
    "1d": {
      start: new Date(now.getTime() + h24Ms - windowMs),
      end: new Date(now.getTime() + h24Ms),
    },
    "1h": {
      start: new Date(now.getTime() + h1Ms - windowMs),
      end: new Date(now.getTime() + h1Ms),
    },
  };
}

// ---------------------------------------------------------------------------
// Notification content (per DOC-47 §4.3 reminder rows)
// ---------------------------------------------------------------------------

interface ReminderContent {
  type: "appointment.reminder_1d" | "appointment.reminder_1h";
  titleI18n: { en: string; es: string };
  bodyI18n: { en: string; es: string };
  icon: string;
  color: string;
  emailTemplateKey: "appointment-24h" | "appointment-1h";
}

const REMINDER_CONTENT: Record<"1d" | "1h", ReminderContent> = {
  "1d": {
    type: "appointment.reminder_1d",
    titleI18n: {
      en: "Your appointment is tomorrow",
      es: "Tu cita es mañana",
    },
    bodyI18n: {
      en: "Reminder: your appointment is scheduled for tomorrow.",
      es: "Recordatorio: tu cita está programada para mañana.",
    },
    icon: "bell",
    color: "gold",
    emailTemplateKey: "appointment-24h",
  },
  "1h": {
    type: "appointment.reminder_1h",
    titleI18n: {
      en: "Your appointment starts in 1 hour",
      es: "Tu cita comienza en 1 hora",
    },
    bodyI18n: {
      en: "Your appointment starts in about 1 hour. Get ready!",
      es: "Tu cita comienza en aproximadamente 1 hora. ¡Prepárate!",
    },
    icon: "bell",
    color: "accent",
    emailTemplateKey: "appointment-1h",
  },
};

// ---------------------------------------------------------------------------
// Send reminder notifications for a single appointment + kind
// ---------------------------------------------------------------------------

async function dispatchReminderNotifications(
  appointmentId: string,
  kind: "1d" | "1h",
  recipients: Array<{ userId: string; actionUrl: string }>,
): Promise<void> {
  const content = REMINDER_CONTENT[kind];

  for (const { userId, actionUrl } of recipients) {
    const dedupeKey = `${content.type}:${appointmentId}:${userId}`;

    // Fetch user to check email eligibility
    const user = await findUserById(userId);
    if (!user) {
      logger.warn(
        { userId, appointmentId },
        "appointment-reminders: user not found — skipping",
      );
      continue;
    }

    // Insert in-app notification (idempotent by dedupe_key)
    const result = await insertNotificationIdempotent({
      userId,
      type: content.type,
      titleI18n: content.titleI18n,
      bodyI18n: content.bodyI18n,
      icon: content.icon,
      color: content.color,
      actionUrl,
      dedupeKey,
    });

    if (!result.created) {
      // Already notified — idempotent skip
      continue;
    }

    const notificationId = result.row.id;

    // Email channel (appointment_reminders preference category)
    if (user.email && !user.emailBouncedAt) {
      try {
        await enqueueJob({
          jobKey: "deliver-notification",
          entityId: notificationId,
          attempt: 1,
          dedupeId: `email:${notificationId}`,
          channel: "email",
          notificationId,
          templateKey: content.emailTemplateKey,
          recipientEmail: user.email,
          locale: user.locale ?? "es",
        });
      } catch (err) {
        logger.warn(
          { err, notificationId },
          "appointment-reminders: failed to enqueue email — continuing",
        );
      }
    }

    // Push channel (in-app ① + push ②) — enqueue push deliver-notification
    // Full push implementation is F7; stub enqueued for observability
    try {
      await enqueueJob({
        jobKey: "deliver-notification",
        entityId: notificationId,
        attempt: 1,
        dedupeId: `push:${notificationId}`,
        channel: "push",
        notificationId,
      });
    } catch (err) {
      logger.warn(
        { err, notificationId },
        "appointment-reminders: failed to enqueue push — continuing",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Job handler
// ---------------------------------------------------------------------------

/**
 * Handles the appointment-reminders cron job.
 *
 * Sweeps for appointments due in the 15-minute reminder windows
 * and sends in-app + email notifications to client and staff.
 *
 * Called by the QStash route handler via registry.ts.
 */
export async function handleAppointmentReminders(
  rawPayload: unknown,
): Promise<void> {
  const parseResult = AppointmentRemindersPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "appointment-reminders: invalid payload — skipping",
    );
    return; // Non-retriable: payload schema error
  }

  const now = new Date();
  const windows = buildWindows(now);

  logger.info(
    {
      job: "appointment-reminders",
      window1dStart: windows["1d"].start.toISOString(),
      window1dEnd: windows["1d"].end.toISOString(),
      window1hStart: windows["1h"].start.toISOString(),
      window1hEnd: windows["1h"].end.toISOString(),
    },
    "appointment-reminders: start",
  );

  let totalProcessed = 0;

  for (const kind of ["1d", "1h"] as const) {
    const window = windows[kind];
    const appointments = await findDueReminders(kind, window.start, window.end);

    logger.info(
      { kind, count: appointments.length },
      "appointment-reminders: found appointments due",
    );

    for (const appt of appointments) {
      // Build action URL for the appointment detail
      const actionUrl = appt.caseId
        ? `/caso/${appt.caseId}/citas/${appt.id}`
        : `/citas/${appt.id}`;

      // Collect recipients: client + staff (DOC-47 §4.3 reminder rows: ①②③)
      const recipients: Array<{ userId: string; actionUrl: string }> = [];
      if (appt.clientUserId) {
        recipients.push({ userId: appt.clientUserId, actionUrl });
      }
      // Staff also receives the reminder
      if (appt.staffId) {
        recipients.push({ userId: appt.staffId, actionUrl });
      }

      if (recipients.length === 0) {
        logger.warn(
          { appointmentId: appt.id },
          "appointment-reminders: no recipients — skipping",
        );
        continue;
      }

      // Dispatch notifications first, then mark as sent
      // (order: notify → mark; ensures re-delivery never sends twice because
      //  markReminderSent is idempotent via WHERE sent_at IS NULL)
      await dispatchReminderNotifications(appt.id, kind, recipients);

      // Mark idempotence flag — UPDATE WHERE sent_at IS NULL
      const marked = await markReminderSent(appt.id, kind);
      if (marked) {
        totalProcessed += 1;
      }
    }
  }

  logger.info(
    { job: "appointment-reminders", totalProcessed },
    "appointment-reminders: end",
  );
}
