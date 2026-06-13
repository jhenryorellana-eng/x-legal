/**
 * Notifications module — service layer (F2 minimum).
 *
 * F2 scope: notifyFromEvent (F2 matrix rows only), getNotifications, markRead.
 *
 * F2 notification matrix rows (DOC-47 §4.3):
 *   contract.signed    → Finance ①②③ (contract-signed-finance) + Sales ①
 *   document.approved  → Client ①②③ (document-approved)
 *   document.rejected  → Client ①②③ (document-rejected)
 *   downpayment.confirmed → Sales ①②③ (downpayment-confirmed-sales) + Paralegal ① + Client ③④◆ (welcome + downpayment-confirmed)
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

// ---------------------------------------------------------------------------
// F2 notification matrix
// ---------------------------------------------------------------------------

interface MatrixRule {
  type: string;
  /** Roles or recipient types to notify */
  recipients: Array<{
    resolverKey: "finance" | "sales_of_case" | "paralegal_of_case" | "clients_of_case";
  }>;
  channels: { push: boolean; email: boolean };
  /** Email template key from DOC-73 catalog */
  emailTemplateKey?: string;
  /** Whether to suppress by user preferences */
  unsuppressible?: boolean;
  /** Deep link template */
  deepLinkTemplate: string;
}

// F2-only matrix rows (DOC-47 §4.3)
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
  return template.replace(
    /\{(\w+)\}/g,
    (_, key) => String(payload[key] ?? ""),
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
        // Build dedupe key
        const entityId = (payload["caseId"] ?? payload["documentId"] ?? payload["contractId"] ?? "global") as string;
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
