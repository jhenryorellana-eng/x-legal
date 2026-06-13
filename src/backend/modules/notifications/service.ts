/**
 * Notifications module — service layer (F2 + F3).
 *
 * F2 matrix rows (DOC-47 §4.3):
 *   contract.signed    → Finance ①②③ (contract-signed-finance) + Sales ①
 *   document.approved  → Client ①②③ (document-approved)
 *   document.rejected  → Client ①②③ (document-rejected)
 *   downpayment.confirmed → Sales ①②③ (downpayment-confirmed-sales) + Paralegal ① + Client ③④◆ (welcome + downpayment-confirmed)
 *
 * F3 matrix rows added (DOC-47 §4.3):
 *   appointment.booked      → Client ①②③ (appointment-booked) + Staff ①
 *   appointment.cancelled   → Counterpart of actor ①②③ (appointment-cancelled)
 *   appointment.rescheduled → Counterpart of actor ①②③ (appointment-rescheduled)
 *   appointment.completed   → no-op (timeline + metrics only, per matrix)
 *   lead.created            → Assigned staff (asesora) ①② (no email per matrix)
 *
 * Push (channel ④) is F7 — only in-app + email implemented here.
 *
 * @module notifications/service
 */

import type { Actor } from "@/backend/platform/authz";
import { enqueueJob } from "@/backend/platform/qstash";
import { logger } from "@/backend/platform/logger";
import type { DomainEvent } from "@/backend/platform/events";

import {
  insertNotificationIdempotent,
  listNotificationsForUser,
  markNotificationRead,
  findUserById,
  findStaffByRole,
  findCaseClientMembers,
  findCaseAssignedStaff,
  type NotificationsPage,
} from "./repository";
// findLeadAssignedStaff is exported from repository for jobs layer use (DOC-26 §2 rule R3),
// but the service resolves lead.assigned_to directly from the event payload
// (assignedTo field in LeadCreatedPayload — kanban emits it inline).

// ---------------------------------------------------------------------------
// F2 notification matrix
// ---------------------------------------------------------------------------

interface MatrixRule {
  type: string;
  /** Roles or recipient types to notify */
  recipients: Array<{
    resolverKey:
      | "finance"
      | "sales_of_case"
      | "paralegal_of_case"
      | "clients_of_case"
      | "appointment_staff"
      | "appointment_client"
      | "appointment_counterpart"
      | "lead_assigned_staff";
  }>;
  channels: { push: boolean; email: boolean };
  /** Email template key from DOC-73 catalog */
  emailTemplateKey?: string;
  /** Whether to suppress by user preferences */
  unsuppressible?: boolean;
  /** Deep link template */
  deepLinkTemplate: string;
}

// Combined F2 + F3 matrix rows (DOC-47 §4.3).
// Rename was intentional: adding F3 rows to the same map (extending, not replacing).
const F2_MATRIX: Record<string, MatrixRule[]> = {
  "contract.signed": [
    {
      type: "contract.signed",
      recipients: [{ resolverKey: "finance" }],
      channels: { push: true, email: true },
      emailTemplateKey: "contract-signed-finance",
      deepLinkTemplate: "/admin/cobranza/{caseId}",
    },
    {
      type: "contract.signed",
      recipients: [{ resolverKey: "sales_of_case" }],
      channels: { push: false, email: false }, // sales only gets in-app ①
      deepLinkTemplate: "/ventas/casos/{caseId}",
    },
  ],
  "document.approved": [
    {
      type: "document.approved",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: true, email: true },
      emailTemplateKey: "document-approved",
      deepLinkTemplate: "/caso/{caseId}/documentos",
    },
  ],
  "document.rejected": [
    {
      type: "document.rejected",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: true, email: true },
      emailTemplateKey: "document-rejected",
      deepLinkTemplate: "/caso/{caseId}/corregir?docId={documentId}",
    },
  ],
  "downpayment.confirmed": [
    {
      type: "downpayment.confirmed",
      recipients: [{ resolverKey: "sales_of_case" }],
      channels: { push: true, email: true },
      emailTemplateKey: "downpayment-confirmed-sales",
      deepLinkTemplate: "/ventas/casos/{caseId}",
    },
    {
      type: "downpayment.confirmed",
      recipients: [{ resolverKey: "paralegal_of_case" }],
      channels: { push: false, email: false }, // paralegal only in-app ①
      deepLinkTemplate: "/legal/caso/{caseId}?tab=resumen",
    },
    {
      type: "downpayment.confirmed",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: false, email: true },
      emailTemplateKey: "downpayment-confirmed",
      unsuppressible: true, // ◆
      deepLinkTemplate: "/caso/{caseId}",
    },
  ],

  // ---------------------------------------------------------------------------
  // F3 rows — appointment lifecycle (DOC-47 §4.3)
  // ---------------------------------------------------------------------------

  // appointment.booked → Client ①②③ + Staff ①
  "appointment.booked": [
    {
      type: "appointment.booked",
      recipients: [{ resolverKey: "appointment_client" }],
      channels: { push: true, email: true },
      emailTemplateKey: "appointment-booked",
      deepLinkTemplate: "/caso/{caseId}/citas/{appointmentId}",
    },
    {
      type: "appointment.booked",
      recipients: [{ resolverKey: "appointment_staff" }],
      channels: { push: false, email: false }, // staff: in-app ① only
      deepLinkTemplate: "/agenda?appointmentId={appointmentId}",
    },
  ],

  // appointment.cancelled → Counterpart of actor ①②③
  "appointment.cancelled": [
    {
      type: "appointment.cancelled",
      recipients: [{ resolverKey: "appointment_counterpart" }],
      channels: { push: true, email: true },
      emailTemplateKey: "appointment-cancelled",
      deepLinkTemplate: "/caso/{caseId}/citas",
    },
  ],

  // appointment.rescheduled → Counterpart of actor ①②③
  "appointment.rescheduled": [
    {
      type: "appointment.rescheduled",
      recipients: [{ resolverKey: "appointment_counterpart" }],
      channels: { push: true, email: true },
      emailTemplateKey: "appointment-rescheduled",
      deepLinkTemplate: "/caso/{caseId}/citas/{newAppointmentId}",
    },
  ],

  // appointment.completed → no-op (timeline + metrics only per DOC-47 §4.3 "—")
  // No entry needed: notifyFromEvent returns immediately for unregistered event types.

  // ---------------------------------------------------------------------------
  // F3 rows — lead lifecycle (DOC-47 §4.3)
  // ---------------------------------------------------------------------------

  // lead.created → Assigned asesora ①② (no email per matrix)
  "lead.created": [
    {
      type: "lead.created",
      recipients: [{ resolverKey: "lead_assigned_staff" }],
      channels: { push: true, email: false }, // ①② per matrix, no email
      deepLinkTemplate: "/ventas/leads?leadId={leadId}",
    },
  ],
};

// ---------------------------------------------------------------------------
// Resolve recipients
// ---------------------------------------------------------------------------

async function resolveRecipients(
  resolverKey: MatrixRule["recipients"][number]["resolverKey"],
  eventPayload: Record<string, unknown>,
): Promise<string[]> {
  const caseId = eventPayload["caseId"] as string | undefined;

  switch (resolverKey) {
    case "finance":
      return findStaffByRole("finance");

    case "sales_of_case": {
      if (!caseId) return [];
      const { salesId } = await findCaseAssignedStaff(caseId);
      return salesId ? [salesId] : [];
    }

    case "paralegal_of_case": {
      if (!caseId) return [];
      const { paralegalId } = await findCaseAssignedStaff(caseId);
      return paralegalId ? [paralegalId] : [];
    }

    case "clients_of_case": {
      if (!caseId) return [];
      return findCaseClientMembers(caseId);
    }

    // F3: appointment.booked — notify the staff member of the appointment
    case "appointment_staff": {
      const staffId = eventPayload["staffId"] as string | undefined;
      return staffId ? [staffId] : [];
    }

    // F3: appointment.booked — notify the client of the appointment
    case "appointment_client": {
      const clientUserId = eventPayload["clientUserId"] as string | undefined;
      return clientUserId ? [clientUserId] : [];
    }

    // F3: appointment.cancelled / appointment.rescheduled
    // The counterpart is whoever did NOT initiate the action.
    // If cancelled/rescheduled by client → notify staff; by staff → notify client.
    // Uses cancelledBy / rescheduledBy from the event payload.
    case "appointment_counterpart": {
      const cancelledBy = eventPayload["cancelledBy"] as "client" | "staff" | undefined;
      const rescheduledBy = eventPayload["rescheduledBy"] as "client" | "staff" | undefined;
      const initiatedBy = cancelledBy ?? rescheduledBy;
      const staffId = eventPayload["staffId"] as string | undefined;
      const clientUserId = eventPayload["clientUserId"] as string | undefined;

      if (initiatedBy === "client") {
        // Client cancelled/rescheduled → notify the staff counterpart
        return staffId ? [staffId] : [];
      }
      if (initiatedBy === "staff") {
        // Staff cancelled/rescheduled → notify the client counterpart
        return clientUserId ? [clientUserId] : [];
      }
      // Unknown initiator: notify both (safe fallback)
      return [staffId, clientUserId].filter((id): id is string => !!id);
    }

    // F3: lead.created → assigned asesora (leads.assigned_to field = staff user_id)
    case "lead_assigned_staff": {
      const assignedTo = eventPayload["assignedTo"] as string | undefined;
      return assignedTo ? [assignedTo] : [];
    }

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Build action URL
// ---------------------------------------------------------------------------

function buildActionUrl(
  template: string,
  payload: Record<string, unknown>,
): string {
  // appointment.rescheduled uses newAppointmentId as the canonical id
  const enriched =
    payload["newAppointmentId"]
      ? { appointmentId: payload["newAppointmentId"], ...payload }
      : payload;
  return template.replace(
    /\{(\w+)\}/g,
    (_, key) => String(enriched[key] ?? ""),
  );
}

// ---------------------------------------------------------------------------
// Render bilingual content for a notification type
// ---------------------------------------------------------------------------

function renderContent(
  type: string,
  _payload: Record<string, unknown>,
): { titleI18n: { en: string; es: string }; bodyI18n: { en: string; es: string } | null; icon: string; color: string } {
  // F2 content map — extend as more event types are added
  const contentMap: Record<string, { titleI18n: { en: string; es: string }; bodyI18n: { en: string; es: string } | null; icon: string; color: string }> = {
    "contract.signed": {
      titleI18n: { en: "Contract signed", es: "Contrato firmado" },
      bodyI18n: { en: "A contract has been signed — collect the down payment.", es: "Se ha firmado un contrato — cobrar el pago inicial." },
      icon: "file-check",
      color: "green",
    },
    "document.approved": {
      titleI18n: { en: "Document approved", es: "Documento aprobado" },
      bodyI18n: { en: "Your document was reviewed and approved.", es: "Tu documento fue revisado y aprobado." },
      icon: "check-circle",
      color: "green",
    },
    "document.rejected": {
      titleI18n: { en: "Document needs correction", es: "El documento necesita corrección" },
      bodyI18n: { en: "Please review and re-upload your document.", es: "Por favor revisa y vuelve a subir tu documento." },
      icon: "alert-circle",
      color: "amber", // never red (RF-TRX-022)
    },
    "downpayment.confirmed": {
      titleI18n: { en: "Down payment confirmed", es: "Pago inicial confirmado" },
      bodyI18n: { en: "The initial payment has been received. Your case is now active.", es: "El pago inicial fue recibido. Tu caso está activo." },
      icon: "dollar-sign",
      color: "green",
    },
    // F3 appointment events
    "appointment.booked": {
      titleI18n: { en: "Appointment booked", es: "Cita agendada" },
      bodyI18n: { en: "Your appointment has been confirmed.", es: "Tu cita ha sido confirmada." },
      icon: "calendar",
      color: "green",
    },
    "appointment.cancelled": {
      titleI18n: { en: "Appointment cancelled", es: "Cita cancelada" },
      bodyI18n: { en: "Your appointment was cancelled. You can reschedule at any time.", es: "Tu cita fue cancelada. Puedes reagendar cuando quieras." },
      icon: "calendar-x",
      color: "amber", // amber for correctable situation (RF-TRX-022)
    },
    "appointment.rescheduled": {
      titleI18n: { en: "Appointment rescheduled", es: "Cita reprogramada" },
      bodyI18n: { en: "Your appointment has been moved to a new date.", es: "Tu cita fue cambiada a una nueva fecha." },
      icon: "calendar-clock",
      color: "gold",
    },
    // F3 reminder types (used by job appointment-reminders)
    "appointment.reminder_1d": {
      titleI18n: { en: "Your appointment is tomorrow", es: "Tu cita es mañana" },
      bodyI18n: { en: "Reminder: your appointment is scheduled for tomorrow.", es: "Recordatorio: tu cita está programada para mañana." },
      icon: "bell",
      color: "gold",
    },
    "appointment.reminder_1h": {
      titleI18n: { en: "Your appointment starts in 1 hour", es: "Tu cita comienza en 1 hora" },
      bodyI18n: { en: "Your appointment starts in about 1 hour.", es: "Tu cita comienza en aproximadamente 1 hora." },
      icon: "bell",
      color: "accent",
    },
    // F3 lead.created
    "lead.created": {
      titleI18n: { en: "New lead assigned", es: "Nuevo lead asignado" },
      bodyI18n: { en: "A new lead has been assigned to you.", es: "Un nuevo lead te ha sido asignado." },
      icon: "user-plus",
      color: "accent",
    },
  };

  return contentMap[type] ?? {
    titleI18n: { en: type, es: type },
    bodyI18n: null,
    icon: "bell",
    color: "gray",
  };
}

// ---------------------------------------------------------------------------
// notifyFromEvent — F2 dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatches notifications for domain events matching the F2 matrix.
 *
 * Called by register-consumers.ts event handlers.
 * No-op for events not in the F2 matrix.
 */
export async function notifyFromEvent(event: DomainEvent): Promise<void> {
  const rules = F2_MATRIX[event.type];
  if (!rules || rules.length === 0) return;

  const payload = (event.payload ?? {}) as Record<string, unknown>;

  for (const rule of rules) {
    for (const recipientDef of rule.recipients) {
      const userIds = await resolveRecipients(recipientDef.resolverKey, payload);

      for (const userId of userIds) {
        // Build dedupe key — pick the most specific entity id available
        const entityId = (
          payload["appointmentId"] ??
          payload["newAppointmentId"] ??
          payload["caseId"] ??
          payload["leadId"] ??
          payload["documentId"] ??
          payload["contractId"] ??
          "global"
        ) as string;
        const dedupeKey = `${event.type}:${entityId}:${userId}`;

        const content = renderContent(rule.type, payload);
        const actionUrl = buildActionUrl(rule.deepLinkTemplate, payload);

        const result = await insertNotificationIdempotent({
          userId,
          type: rule.type,
          titleI18n: content.titleI18n,
          bodyI18n: content.bodyI18n,
          icon: content.icon,
          color: content.color,
          actionUrl,
          dedupeKey,
        });

        // Re-delivery: skip heavy channels if notification already existed
        if (!result.created) continue;

        // Heavy channels via QStash (out of request)
        const notificationId = result.row.id;

        // Push channel
        if (rule.channels.push) {
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
              "notifications: failed to enqueue push delivery — continuing",
            );
          }
        }

        // Email channel
        if (rule.channels.email) {
          const user = await findUserById(userId);
          const hasEmail = user?.email && !user.emailBouncedAt;
          // C-2 FIX: removed `|| true` that made every email unsuppressible.
          // Correct logic (DOC-47 §4.3):
          //   - unsuppressible:true  → always send (cannot be turned off)
          //   - unsuppressible:false/undefined (suppresible) → send UNLESS the user
          //     has opted out. User preference table not yet implemented, so default=send.
          // TODO(SoT DOC-47): replace `?? true` with a real pref check once
          //   notification_preferences table is provisioned.
          const shouldSendEmail = rule.unsuppressible ?? true;
          if (shouldSendEmail && hasEmail && rule.emailTemplateKey) {
            try {
              await enqueueJob({
                jobKey: "deliver-notification",
                entityId: notificationId,
                attempt: 1,
                dedupeId: `email:${notificationId}`,
                channel: "email",
                notificationId,
                templateKey: rule.emailTemplateKey,
                recipientEmail: user!.email!,
                locale: user!.locale ?? "es",
              });
            } catch (err) {
              logger.warn(
                { err, notificationId },
                "notifications: failed to enqueue email delivery — continuing",
              );
            }
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// getNotifications — paginated list for actor
// ---------------------------------------------------------------------------

/**
 * Returns paginated notifications for the current actor.
 *
 * @api-id (notifications read endpoint)
 */
export async function getNotifications(
  actor: Actor,
  opts: { cursor?: string; limit?: number },
): Promise<NotificationsPage> {
  return listNotificationsForUser(actor.userId, opts);
}

// ---------------------------------------------------------------------------
// markRead
// ---------------------------------------------------------------------------

/**
 * Marks a notification as read.
 */
export async function markRead(
  actor: Actor,
  notificationId: string,
): Promise<void> {
  await markNotificationRead(notificationId, actor.userId);
}
