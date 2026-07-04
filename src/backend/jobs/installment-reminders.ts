/**
 * QStash job: installment-reminders
 *
 * Cron job (daily, org timezone) that:
 *  1. Calls markOverdues(systemActor, today) — marks pending → overdue for all
 *     installments past due. Idempotent (skips already-overdue rows).
 *  2. Calls listReminderTargets(today) — pending with due_date in {today, today+3}
 *     that haven't been reminded yet (last_reminder_at IS NULL or < today).
 *  3. For each target: inserts an in-app notification and enqueues email delivery.
 *  4. Calls recordReminderSent(systemActor, installmentId) for each processed target.
 *
 * DOC-44 §3.9 — markOverdues + reminder dispatch.
 * DOC-44 §3.11 — due-3d and due-day notification types.
 * DOC-26 §1.2 — cron payload schema minimal.
 *
 * Idempotency:
 *   markOverdues is idempotent (re-marks already-overdue are no-ops at DB level).
 *   recordReminderSent uses last_reminder_at; concurrent invocations are safe.
 *
 * Boundary: imports ONLY from module index.ts, platform/, and shared/ (rule R3).
 *
 * Schedule (QStash): once daily at 08:00 UTC — see provision-schedules.md
 */

import { z } from "zod";
import { systemActor } from "@/backend/platform/authz";
import { logger } from "@/backend/platform/logger";
import { enqueueJob } from "@/backend/platform/qstash";
import {
  markOverdues,
  listReminderTargets,
  recordReminderSent,
} from "@/backend/modules/billing";
import {
  insertNotificationIdempotent,
  findUserById,
} from "@/backend/modules/notifications";

// ---------------------------------------------------------------------------
// Payload schema (DOC-26 §1.2)
// ---------------------------------------------------------------------------

const InstallmentRemindersPayloadSchema = z.object({
  jobKey: z.literal("installment-reminders"),
  entityId: z.null().optional(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
  /** YYYY-MM-DD in the org's local timezone (UTC fallback if absent). */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type InstallmentRemindersPayload = z.infer<typeof InstallmentRemindersPayloadSchema>;

// ---------------------------------------------------------------------------
// Notification content (DOC-44 §3.11)
// ---------------------------------------------------------------------------

interface ReminderContent {
  type: "installment.reminder_3d" | "installment.reminder_due";
  titleI18n: { en: string; es: string };
  bodyI18n: { en: string; es: string };
  icon: string;
  color: string;
  emailTemplateKey: "installment-reminder-3d" | "installment-reminder-due";
}

function buildReminderContent(
  dueDate: string,
  isToday: boolean,
  autopayEnabled: boolean,
): ReminderContent {
  if (isToday) {
    return {
      type: "installment.reminder_due",
      titleI18n: {
        en: "Your installment is due today",
        es: "Tu cuota vence hoy",
      },
      bodyI18n: {
        en: `Your installment of ${dueDate} is due today. Please make your payment to avoid late fees.`,
        es: `Tu cuota del ${dueDate} vence hoy. Por favor realiza tu pago para evitar cargos por mora.`,
      },
      icon: "alert-circle",
      color: "red",
      emailTemplateKey: "installment-reminder-due",
    };
  }
  if (autopayEnabled) {
    // Autopay plan: the due-3d reminder is a heads-up, not a call to action —
    // the charge cron will collect it automatically on the due date.
    return {
      type: "installment.reminder_3d",
      titleI18n: {
        en: "Upcoming automatic payment",
        es: "Próximo cobro automático",
      },
      bodyI18n: {
        en: `Your installment of ${dueDate} will be charged automatically to your saved card on its due date. No action needed.`,
        es: `Tu cuota del ${dueDate} se cobrará automáticamente a tu tarjeta guardada en su fecha de vencimiento. No necesitas hacer nada.`,
      },
      icon: "credit-card",
      color: "gold",
      emailTemplateKey: "installment-reminder-3d",
    };
  }
  return {
    type: "installment.reminder_3d",
    titleI18n: {
      en: "Your installment is due in 3 days",
      es: "Tu cuota vence en 3 días",
    },
    bodyI18n: {
      en: `Your installment of ${dueDate} is due in 3 days. Please prepare your payment.`,
      es: `Tu cuota del ${dueDate} vence en 3 días. Por favor prepara tu pago.`,
    },
    icon: "bell",
    color: "gold",
    emailTemplateKey: "installment-reminder-3d",
  };
}

// ---------------------------------------------------------------------------
// Dispatch single reminder
// ---------------------------------------------------------------------------

async function dispatchReminderForTarget(
  installmentId: string,
  caseId: string,
  clientUserId: string | null,
  dueDate: string,
  today: string,
  autopayEnabled: boolean,
): Promise<void> {
  if (!clientUserId) {
    logger.warn(
      { installmentId, caseId },
      "installment-reminders: no clientUserId — skipping reminder dispatch",
    );
    return;
  }

  const isToday = dueDate === today;
  const content = buildReminderContent(dueDate, isToday, autopayEnabled);
  const dedupeKey = `${content.type}:${installmentId}:${clientUserId}`;
  // Client payments live at the account-level /pagos screen (there is no
  // /caso/[caseId]/cuotas route — linking there 404s). ?caseId opens that
  // case's plan via the multi-case selector.
  const actionUrl = `/pagos?caseId=${caseId}`;

  const user = await findUserById(clientUserId);
  if (!user) {
    logger.warn(
      { clientUserId, installmentId },
      "installment-reminders: user not found — skipping",
    );
    return;
  }

  const result = await insertNotificationIdempotent({
    userId: clientUserId,
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
    return;
  }

  const notificationId = result.row.id;

  // Email channel
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
        { err, notificationId, installmentId },
        "installment-reminders: failed to enqueue email — continuing",
      );
    }
  }

  // Push channel (stub — full push is F7)
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
      { err, notificationId, installmentId },
      "installment-reminders: failed to enqueue push — continuing",
    );
  }
}

// ---------------------------------------------------------------------------
// Job handler
// ---------------------------------------------------------------------------

/**
 * Handles the installment-reminders cron job.
 *
 * Called by the QStash route handler via JOB_REGISTRY.
 */
export async function handleInstallmentReminders(rawPayload: unknown): Promise<void> {
  const parseResult = InstallmentRemindersPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "installment-reminders: invalid payload — skipping",
    );
    return; // Non-retriable: payload schema error
  }

  // Use today from payload (org TZ) or fall back to UTC date
  const today = parseResult.data.today ?? new Date().toISOString().split("T")[0];
  const actor = systemActor();

  logger.info({ job: "installment-reminders", today }, "installment-reminders: start");

  // Step 1 — mark overdue installments
  let overdueResult: { marked: number };
  try {
    overdueResult = await markOverdues(actor, today);
    logger.info(
      { job: "installment-reminders", marked: overdueResult.marked },
      "installment-reminders: markOverdues complete",
    );
  } catch (err) {
    logger.error({ err }, "installment-reminders: markOverdues failed — aborting");
    throw err; // Surface to QStash for retry
  }

  // Step 2 — fetch reminder targets
  let targets: Awaited<ReturnType<typeof listReminderTargets>>;
  try {
    targets = await listReminderTargets(today);
    logger.info(
      { job: "installment-reminders", targets: targets.length },
      "installment-reminders: reminder targets found",
    );
  } catch (err) {
    logger.error({ err }, "installment-reminders: listReminderTargets failed — aborting");
    throw err;
  }

  // Step 3 — process each target
  let totalNotified = 0;
  let autopaySkipped = 0;
  for (const target of targets) {
    try {
      // Autopay plans: skip the due-day reminder — charge-due-installments
      // (10:30 UTC, before this job) collects it automatically; a "pay today"
      // nudge would contradict the automatic charge (DOC-44 §3.13).
      if (target.autopayEnabled && target.dueDate === today) {
        autopaySkipped += 1;
        continue;
      }

      // Mark BEFORE dispatching (same pattern as appointment-reminders H-4 FIX)
      await recordReminderSent(actor, target.installmentId);

      await dispatchReminderForTarget(
        target.installmentId,
        target.caseId,
        target.clientUserId,
        target.dueDate,
        today,
        target.autopayEnabled,
      );
      totalNotified += 1;
    } catch (err) {
      logger.error(
        { err, installmentId: target.installmentId },
        "installment-reminders: error processing target — continuing",
      );
    }
  }

  logger.info(
    {
      job: "installment-reminders",
      overdueMarked: overdueResult.marked,
      totalNotified,
      autopaySkipped,
    },
    "installment-reminders: end",
  );
}
