/**
 * Notifications module — service layer (F2 + F3 + onboarding).
 *
 * Onboarding flow rows (Henry's flow — overrides DOC-47 recipients per request):
 *   contract.sent         → Client ①②◆ push + email (contract-ready) — signing link /firma/{token}
 *   case.created          → Sales (asesora) ①② push — confirmation of the new case
 *   contract.signed       → + Client ①② push (contract.signed.client) "pay your initial"
 *   downpayment.confirmed → + Finance (Andrium) ①② push (downpayment.confirmed.finance)
 *
 * F2 matrix rows (DOC-47 §4.3):
 *   contract.signed    → Finance ①②③ (contract-signed-finance) + Sales ①
 *   document.approved  → Client ①②③ (document-approved)
 *   document.rejected  → Client ①②③ (document-rejected)
 *   downpayment.confirmed → Sales ①②③ (downpayment-confirmed-sales) + Paralegal ① + Client ③◆ (downpayment-confirmed / welcome)
 *
 * F3 matrix rows added (DOC-47 §4.3):
 *   appointment.booked      → Client ①②③ (appointment-booked) + Staff ①
 *   appointment.cancelled   → Counterpart of actor ①②③ (appointment-cancelled)
 *   appointment.rescheduled → Counterpart of actor ①②③ (appointment-rescheduled)
 *   appointment.completed   → no-op (timeline + metrics only, per matrix)
 *   appointment.no_show     → Client ①②③ (appointment-no-show, amber — RF-TRX-022)
 *   lead.created            → Assigned staff (asesora) ①② (no email per matrix)
 *
 * Channels: ① in-app (always, base channel) · ② push (web-push/VAPID, F7) ·
 * ③ email (Resend) · ◆ unsuppressible (ignores preference toggles).
 *
 * @module notifications/service
 */

import type { Actor } from "@/backend/platform/authz";
import { enqueueJob } from "@/backend/platform/qstash";
import { logger } from "@/backend/platform/logger";
import type { DomainEvent } from "@/backend/platform/events";
import type { EmailData } from "@/backend/platform/emails";

import {
  insertNotificationIdempotent,
  listNotificationsForUser,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCountForUser,
  findUserById,
  findRecipientProfile,
  type RecipientProfile,
  findStaffByRole,
  findCaseClientMembers,
  findCaseAssignedStaff,
  getPreferences as repoGetPreferences,
  upsertPreferences,
  findUnreadMessageDigest,
  bumpMessageDigest,
  upsertPushSubscription,
  removePushSubscriptionForUser,
  DEFAULT_PREFERENCES,
  type NotificationsPage,
  type NotificationPreferences,
  type NotificationCategory,
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
      | "lead_assigned_staff"
      | "message_participants";
  }>;
  channels: { push: boolean; email: boolean };
  /** Preference category that gates this rule (DOC-47 §4.1 step 4). */
  category: NotificationCategory;
  /** Email template key from DOC-73 catalog */
  emailTemplateKey?: string;
  /** Whether to suppress by user preferences (◆ in the matrix). */
  unsuppressible?: boolean;
  /** Deep link template */
  deepLinkTemplate: string;
  /**
   * Optional payload predicate: the rule only fires when it returns true.
   * Keeps conditional routing declarative (e.g. notify sales only for the
   * downpayment proof) instead of special-casing notifyFromEvent.
   */
  when?: (payload: Record<string, unknown>) => boolean;
}

// Canonical matrix (DOC-47 §4.3). F2 + F3 + F7 rows in one map (extending).
// Each rule carries its preference `category` (gates suppressible rules).
const F2_MATRIX: Record<string, MatrixRule[]> = {
  // contract.sent → the client (signer) gets the signing link (in-app + push +
  // email). Unsuppressible (◆): the link must reach them regardless of prefs.
  // Push is best-effort: it only lands if the client already has a subscription
  // (a returning client, or one who logged in and opted in); brand-new clients
  // still get it via in-app + email + the onboarding card on /home.
  "contract.sent": [
    {
      type: "contract.sent",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: true, email: true },
      category: "case_updates",
      emailTemplateKey: "contract-ready",
      unsuppressible: true,
      deepLinkTemplate: "/firma/{signingToken}",
    },
  ],
  // Onboarding flow (Henry's flow — overrides DOC-47 recipients per request):
  // case created → the case's asesora (Vanessa). Note: notifyFromEvent does NOT
  // suppress self-notify, so the creator (= the asesora) gets it as a confirmation.
  "case.created": [
    {
      type: "case.created",
      recipients: [{ resolverKey: "sales_of_case" }],
      channels: { push: true, email: false }, // ①② in-app + push
      category: "case_updates",
      deepLinkTemplate: "/ventas/clientes/{caseId}",
    },
    {
      // Welcome email (◆ account email) — ONLY on the client's FIRST case
      // (Henry 2026-07-09: welcome moved from downpayment.confirmed to case
      // creation). Email-only: brand-new clients have no push subscription yet.
      type: "case.created.welcome",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: false, email: true }, // ③ email
      category: "case_updates",
      emailTemplateKey: "welcome",
      unsuppressible: true,
      when: (p) => p["isFirstCase"] === true,
      deepLinkTemplate: "/home",
    },
  ],
  // case.phase_advanced (cycle restart) → sales (Vanessa) starts the new phase;
  // the client gets a progress nudge. Distinct rule.type → recipient-specific copy.
  "case.phase_advanced": [
    {
      type: "case.phase_advanced",
      recipients: [{ resolverKey: "sales_of_case" }],
      channels: { push: true, email: false }, // ①② in-app + push
      category: "case_updates",
      deepLinkTemplate: "/ventas/clientes/{caseId}",
    },
    {
      type: "case.phase_advanced.client",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: true, email: false }, // ①② in-app + push
      category: "case_updates",
      deepLinkTemplate: "/caso/{caseId}/camino",
    },
  ],
  "contract.signed": [
    {
      type: "contract.signed",
      recipients: [{ resolverKey: "finance" }],
      channels: { push: true, email: true },
      category: "case_updates",
      emailTemplateKey: "contract-signed-finance",
      deepLinkTemplate: "/finanzas/pagos?caseId={caseId}",
    },
    {
      type: "contract.signed",
      recipients: [{ resolverKey: "sales_of_case" }],
      channels: { push: false, email: false }, // sales only gets in-app ①
      category: "case_updates",
      deepLinkTemplate: "/ventas/clientes/{caseId}",
    },
    {
      // Client variant (Henry's flow): on sign, tell the client to pay the
      // downpayment. Distinct rule.type → client-specific content (not the
      // finance "collect" copy). Deep link to the account-level payments screen
      // (`/pagos` — there is no per-case `/caso/{id}/pagos` route).
      type: "contract.signed.client",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: true, email: false }, // ①② in-app + push
      category: "case_updates",
      deepLinkTemplate: "/pagos",
    },
  ],
  "document.approved": [
    {
      type: "document.approved",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: true, email: true },
      category: "case_updates",
      emailTemplateKey: "document-approved",
      deepLinkTemplate: "/caso/{caseId}/documentos",
    },
  ],
  "document.rejected": [
    {
      type: "document.rejected",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: true, email: true },
      category: "case_updates",
      emailTemplateKey: "document-rejected",
      deepLinkTemplate: "/caso/{caseId}/corregir?docId={documentId}",
    },
  ],
  // document.coverage_detected → client (positive tone): the AI detected other
  // requested documents INSIDE their upload — those now count as delivered.
  "document.coverage_detected": [
    {
      type: "document.coverage_detected",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: true, email: false },
      category: "case_updates",
      deepLinkTemplate: "/caso/{caseId}/documentos",
    },
  ],
  // document.uploaded → the case's asesora (Vanessa). ①② in-app + push (no email).
  // Fires ONLY for client uploads (staff uploads must not alert sales).
  "document.uploaded": [
    {
      type: "document.uploaded",
      recipients: [{ resolverKey: "sales_of_case" }],
      channels: { push: true, email: false },
      category: "case_updates",
      when: (p) => p.uploadedByKind === "client",
      deepLinkTemplate: "/ventas/clientes/{caseId}?tab=documentos",
    },
  ],
  // form_response.submitted → the case's asesora. ①② in-app + push (no email).
  // Fires ONLY for client submissions (staff filling a form must not alert sales).
  "form_response.submitted": [
    {
      type: "form_response.submitted",
      recipients: [{ resolverKey: "sales_of_case" }],
      channels: { push: true, email: false },
      category: "case_updates",
      when: (p) => p.submittedByKind === "client",
      deepLinkTemplate: "/ventas/clientes/{caseId}/revisar/{formDefinitionId}",
    },
  ],
  // questionnaire.drafts_failed → the case's asesora. In-app only: the
  // questionnaire itself is READY (the client can work) — staff just needs to
  // know the AI autofill pass failed so they can regenerate it.
  "questionnaire.drafts_failed": [
    {
      type: "questionnaire.drafts_failed",
      recipients: [{ resolverKey: "sales_of_case" }],
      channels: { push: false, email: false },
      category: "case_updates",
      deepLinkTemplate: "/ventas/clientes/{caseId}",
    },
  ],
  // form_response.approved → client. ①②③ in-app + push + email (positive/green).
  "form_response.approved": [
    {
      type: "form_response.approved",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: true, email: true },
      category: "case_updates",
      emailTemplateKey: "form-approved",
      deepLinkTemplate: "/caso/{caseId}/formulario/{formDefinitionId}",
    },
  ],
  // form_response.rejected → client. ①②③ in-app + push + email (amber, never red).
  "form_response.rejected": [
    {
      type: "form_response.rejected",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: true, email: true },
      category: "case_updates",
      emailTemplateKey: "form-rejected",
      deepLinkTemplate: "/caso/{caseId}/formulario/{formDefinitionId}",
    },
  ],
  "downpayment.confirmed": [
    {
      type: "downpayment.confirmed",
      recipients: [{ resolverKey: "sales_of_case" }],
      channels: { push: true, email: true },
      category: "case_updates",
      emailTemplateKey: "downpayment-confirmed-sales",
      deepLinkTemplate: "/ventas/clientes/{caseId}",
    },
    {
      type: "downpayment.confirmed",
      recipients: [{ resolverKey: "paralegal_of_case" }],
      channels: { push: false, email: false }, // paralegal only in-app ①
      category: "case_updates",
      deepLinkTemplate: "/legal/expediente/{caseId}",
    },
    {
      type: "downpayment.confirmed",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: false, email: true },
      category: "case_updates",
      emailTemplateKey: "downpayment-confirmed",
      unsuppressible: true, // ◆ (cliente — bienvenida)
      deepLinkTemplate: "/caso/{caseId}/camino",
    },
    {
      // Finance (Andrium) — Henry's flow: notify on payment confirmed too.
      // Distinct rule.type → finance-specific copy. In-app + push.
      type: "downpayment.confirmed.finance",
      recipients: [{ resolverKey: "finance" }],
      channels: { push: true, email: false },
      category: "case_updates",
      deepLinkTemplate: "/finanzas/pagos?caseId={caseId}",
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
      category: "appointment_reminders",
      emailTemplateKey: "appointment-booked",
      deepLinkTemplate: "/caso/{caseId}/cita/{appointmentId}",
    },
    {
      type: "appointment.booked",
      recipients: [{ resolverKey: "appointment_staff" }],
      channels: { push: false, email: false }, // staff: in-app ① only
      category: "appointment_reminders",
      deepLinkTemplate: "/agenda?appointmentId={appointmentId}",
    },
  ],

  // appointment.cancelled → Counterpart of actor ①②③
  "appointment.cancelled": [
    {
      type: "appointment.cancelled",
      recipients: [{ resolverKey: "appointment_counterpart" }],
      channels: { push: true, email: true },
      category: "appointment_reminders",
      emailTemplateKey: "appointment-cancelled",
      deepLinkTemplate: "/caso/{caseId}/agendar",
    },
  ],

  // appointment.rescheduled → Counterpart of actor ①②③
  "appointment.rescheduled": [
    {
      type: "appointment.rescheduled",
      recipients: [{ resolverKey: "appointment_counterpart" }],
      channels: { push: true, email: true },
      category: "appointment_reminders",
      emailTemplateKey: "appointment-rescheduled",
      deepLinkTemplate: "/caso/{caseId}/cita/{newAppointmentId}",
    },
  ],

  // appointment.no_show → Client ①②③ (amber, never red — RF-TRX-022).
  // Always staff-initiated, so notify the client and point them to rebook.
  // Lead/prospect no_show (no caseId, no client_user_id) → appointment_client
  // resolves to [] → notification is correctly a silent no-op (no logged-in client).
  "appointment.no_show": [
    {
      type: "appointment.no_show",
      recipients: [{ resolverKey: "appointment_client" }],
      channels: { push: true, email: true },
      category: "appointment_reminders",
      emailTemplateKey: "appointment-no-show",
      deepLinkTemplate: "/caso/{caseId}/agendar",
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
      category: "case_updates",
      deepLinkTemplate: "/ventas/leads?leadId={leadId}",
    },
  ],

  // ---------------------------------------------------------------------------
  // Evaluations (external tool Juez) — the PDF arrived / the generation failed.
  // Client ①② (no email v1 — no template yet) + sales ①. Failure is staff-only:
  // the client already sees the error inline in the tool.
  // ---------------------------------------------------------------------------
  "evaluation.completed": [
    {
      type: "evaluation.completed",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: true, email: false }, // ①② in-app + push
      category: "case_updates",
      deepLinkTemplate: "/caso/{caseId}/evaluacion",
    },
    {
      type: "evaluation.completed.staff",
      recipients: [{ resolverKey: "sales_of_case" }],
      channels: { push: false, email: false }, // in-app ① only
      category: "case_updates",
      deepLinkTemplate: "/ventas/clientes/{caseId}",
    },
  ],
  "evaluation.failed": [
    {
      type: "evaluation.failed",
      recipients: [{ resolverKey: "sales_of_case" }],
      channels: { push: false, email: false }, // in-app ① only
      category: "case_updates",
      deepLinkTemplate: "/ventas/clientes/{caseId}",
    },
  ],

  // ---------------------------------------------------------------------------
  // F7 rows — payments (DOC-47 §4.3). These events are already wired in
  // register-consumers; adding the matrix rows activates their notifications.
  // ---------------------------------------------------------------------------

  // installment.overdue → Client ①②③ + Finance ① (payment_reminders)
  "installment.overdue": [
    {
      type: "installment.overdue",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: true, email: true },
      category: "payment_reminders",
      emailTemplateKey: "installment-overdue",
      deepLinkTemplate: "/pagos",
    },
    {
      type: "installment.overdue",
      recipients: [{ resolverKey: "finance" }],
      channels: { push: false, email: false }, // finance: in-app ① only
      category: "payment_reminders",
      deepLinkTemplate: "/finanzas/pagos?caseId={caseId}",
    },
  ],

  // installment.paid → Client ①③ + Finance ① (payment_reminders)
  "installment.paid": [
    {
      type: "installment.paid",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: false, email: true }, // ①③ (no push per matrix)
      category: "payment_reminders",
      emailTemplateKey: "installment-paid",
      // Transactional receipt — always delivered (Henry 2026-07-09), not gated
      // by the payment_reminders toggle like the due/overdue nudges.
      unsuppressible: true,
      deepLinkTemplate: "/pagos",
    },
    {
      type: "installment.paid",
      recipients: [{ resolverKey: "finance" }],
      channels: { push: false, email: false }, // finance: in-app ① only
      category: "payment_reminders",
      deepLinkTemplate: "/finanzas/pagos?caseId={caseId}",
    },
  ],

  // payment.proof_submitted → Finance ①② + Client ① (payment_reminders)
  // + Sales of case ①② for the DOWNPAYMENT proof only (Henry 2026-07-02: the
  //   asesora verifies the initial-installment comprobante from the case tab).
  "payment.proof_submitted": [
    {
      type: "payment.proof_submitted",
      recipients: [{ resolverKey: "finance" }],
      channels: { push: true, email: false }, // ①②
      category: "payment_reminders",
      // Deep link straight into the verification panel (?paymentId= opens it)
      deepLinkTemplate: "/finanzas/pagos/caso/{caseId}?paymentId={paymentId}",
    },
    {
      type: "payment.proof_submitted.sales",
      recipients: [{ resolverKey: "sales_of_case" }],
      channels: { push: true, email: false }, // ①②
      category: "payment_reminders",
      when: (p) => p["isDownpayment"] === true,
      deepLinkTemplate: "/ventas/clientes/{caseId}?tab=pagos",
    },
    {
      type: "payment.proof_submitted",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: false, email: false }, // client acknowledgement ①
      category: "payment_reminders",
      deepLinkTemplate: "/pagos",
    },
  ],

  // payment.refunded → Finance ① (payment_reminders, RF-AND-018)
  "payment.refunded": [
    {
      type: "payment.refunded",
      recipients: [{ resolverKey: "finance" }],
      channels: { push: false, email: false }, // in-app ① only
      category: "payment_reminders",
      deepLinkTemplate: "/finanzas/pagos?caseId={caseId}",
    },
  ],

  // zelle.match_suggested → Finance ①② (Zelle reconciliation inbox, 0111)
  // A bank alert needs human eyes: tier-B suggestion, tier-A degradation, or
  // an unidentified payment. Deep link lands on the reconciliation tab.
  "zelle.match_suggested": [
    {
      type: "zelle.match_suggested",
      recipients: [{ resolverKey: "finance" }],
      channels: { push: true, email: false }, // ①②
      category: "payment_reminders",
      deepLinkTemplate: "/finanzas/pagos?tab=conciliacion",
    },
  ],

  // autopay.charge_failed → Client ①② + Finance ① (DOC-71 §2.4)
  "autopay.charge_failed": [
    {
      type: "autopay.charge_failed",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: true, email: false }, // ①② (no email template in V2)
      category: "payment_reminders",
      deepLinkTemplate: "/pagos",
    },
    {
      type: "autopay.charge_failed",
      recipients: [{ resolverKey: "finance" }],
      channels: { push: false, email: false }, // in-app ① only
      category: "payment_reminders",
      deepLinkTemplate: "/finanzas/pagos/caso/{caseId}",
    },
  ],

  // autopay.disabled (system kill-switch) → Client ①② + Finance ①②
  "autopay.disabled": [
    {
      type: "autopay.disabled",
      recipients: [{ resolverKey: "clients_of_case" }],
      channels: { push: true, email: false },
      category: "payment_reminders",
      deepLinkTemplate: "/pagos",
    },
    {
      type: "autopay.disabled",
      recipients: [{ resolverKey: "finance" }],
      channels: { push: true, email: false },
      category: "payment_reminders",
      deepLinkTemplate: "/finanzas/pagos/caso/{caseId}",
    },
  ],

  // ---------------------------------------------------------------------------
  // F7 — message.sent → message.received (anti-burst §4.2). Routed to
  // notifyMessageBurst inside notifyFromEvent (special-cased before the loop).
  // The row exists so the dispatcher recognizes the event; channels/category
  // are applied inside notifyMessageBurst.
  // ---------------------------------------------------------------------------
  "message.sent": [
    {
      type: "message.received",
      recipients: [{ resolverKey: "message_participants" }],
      channels: { push: true, email: false }, // ①② anti-burst, no email V2.0
      category: "messages",
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

    // F7: message.sent → conversation participants except the sender.
    // The messaging emitter precomputes recipientIds (participants minus sender).
    case "message_participants": {
      const ids = eventPayload["recipientIds"];
      return Array.isArray(ids) ? (ids as string[]) : [];
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

/** Formats integer USD cents for in-app copy ("$1,234.56"). */
function fmtCents(v: unknown): string {
  const cents = typeof v === "number" ? v : Number(v ?? 0);
  return `$${((Number.isFinite(cents) ? cents : 0) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function renderContent(
  type: string,
  payload: Record<string, unknown>,
): { titleI18n: { en: string; es: string }; bodyI18n: { en: string; es: string } | null; icon: string; color: string } {
  // F2 content map — extend as more event types are added
  const contentMap: Record<string, { titleI18n: { en: string; es: string }; bodyI18n: { en: string; es: string } | null; icon: string; color: string }> = {
    "contract.sent": {
      titleI18n: { en: "Your contract is ready to sign", es: "Tu contrato está listo para firmar" },
      bodyI18n: { en: "Review and sign your contract to continue.", es: "Revisa y firma tu contrato para continuar." },
      icon: "file-check",
      color: "accent",
    },
    "case.created": {
      titleI18n: { en: "New case created", es: "Nuevo caso creado" },
      bodyI18n: { en: "A new case was created for your client.", es: "Se creó un nuevo caso para tu cliente." },
      icon: "file-check",
      color: "accent",
    },
    "case.created.welcome": {
      titleI18n: { en: "Welcome to UsaLatinoPrime!", es: "¡Bienvenido a UsaLatinoPrime!" },
      bodyI18n: {
        en: "Your case has been created. Sign your contract to get started.",
        es: "Tu caso fue creado. Firma tu contrato para comenzar.",
      },
      icon: "party-popper",
      color: "green",
    },
    "case.phase_advanced": {
      titleI18n: { en: "New phase — start the tasks", es: "Nueva fase — inicia las tareas" },
      bodyI18n: { en: "A case advanced to a new phase. Set up its appointment route and documents.", es: "Un caso avanzó a una nueva fase. Prepara su ruta de citas y documentos." },
      icon: "chevrons-right",
      color: "gold",
    },
    "case.phase_advanced.client": {
      titleI18n: { en: "Your case advanced to a new phase", es: "Tu caso avanzó a una nueva fase" },
      bodyI18n: { en: "Great news — your case moved forward. We'll guide you on the next steps.", es: "Buenas noticias — tu caso avanzó. Te guiaremos en los siguientes pasos." },
      icon: "chevrons-right",
      color: "green",
    },
    "contract.signed": {
      titleI18n: { en: "Contract signed", es: "Contrato firmado" },
      bodyI18n: { en: "A contract has been signed — collect the down payment.", es: "Se ha firmado un contrato — cobrar el pago inicial." },
      icon: "file-check",
      color: "green",
    },
    "contract.signed.client": {
      titleI18n: { en: "Contract signed — make your initial payment", es: "Contrato firmado — realiza tu pago inicial" },
      bodyI18n: { en: "Your contract is signed. Make the initial payment to start your case.", es: "Tu contrato está firmado. Realiza el pago inicial para iniciar tu caso." },
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
    "evaluation.completed": {
      titleI18n: { en: "Your evaluation is ready", es: "Tu evaluación está lista" },
      bodyI18n: {
        en: "Your evaluation report (PDF) is ready. Open your case to view it.",
        es: "Tu informe de evaluación (PDF) está listo. Abre tu caso para verlo.",
      },
      icon: "file-check",
      color: "green",
    },
    "evaluation.completed.staff": {
      titleI18n: { en: "Evaluation delivered", es: "Evaluación entregada" },
      bodyI18n: {
        en: "The external tool delivered the client's evaluation PDF.",
        es: "La herramienta externa entregó el PDF de evaluación del cliente.",
      },
      icon: "file-check",
      color: "green",
    },
    "evaluation.failed": {
      titleI18n: { en: "Evaluation generation failed", es: "Falló la generación de la evaluación" },
      bodyI18n: {
        en: "The external tool reported a technical failure. The attempt was refunded.",
        es: "La herramienta externa reportó un fallo técnico. El intento fue devuelto.",
      },
      icon: "alert-circle",
      color: "amber",
    },
    "document.coverage_detected": {
      titleI18n: {
        en: "We found documents included in your upload",
        es: "Encontramos documentos incluidos en tu archivo",
      },
      bodyI18n: {
        en: "Some requested documents were detected inside your upload — they now count as delivered.",
        es: "Detectamos documentos solicitados dentro de tu archivo — ya cuentan como entregados.",
      },
      icon: "check-circle",
      color: "green",
    },
    // Staff-facing (asesora): a client uploaded a document to review.
    "document.uploaded": {
      titleI18n: { en: "New document to review", es: "Nuevo documento por revisar" },
      bodyI18n: { en: "A client uploaded a document to their case.", es: "Un cliente subió un documento a su caso." },
      icon: "upload",
      color: "accent",
    },
    // Staff-facing (asesora): a client submitted a form for review.
    "form_response.submitted": {
      titleI18n: { en: "Form submitted for review", es: "Formulario enviado para revisión" },
      bodyI18n: { en: "A client completed and submitted a form.", es: "Un cliente completó y envió un formulario." },
      icon: "clipboard-check",
      color: "accent",
    },
    // Staff-facing (asesora): the questionnaire is ready but the AI autofill
    // drafts failed — regenerate from the case to restore autofill.
    "questionnaire.drafts_failed": {
      titleI18n: { en: "AI drafts failed for a questionnaire", es: "Fallaron los borradores IA de un cuestionario" },
      bodyI18n: {
        en: "The questionnaire is ready, but the AI could not draft the answers. Regenerate it from the case.",
        es: "El cuestionario está listo, pero la IA no pudo redactar los borradores. Regenéralo desde el caso.",
      },
      icon: "alert-circle",
      color: "amber",
    },
    // Client-facing: the form was reviewed and approved.
    "form_response.approved": {
      titleI18n: { en: "Form approved", es: "Formulario aprobado" },
      bodyI18n: { en: "Your form was reviewed and approved.", es: "Tu formulario fue revisado y aprobado." },
      icon: "check-circle",
      color: "green",
    },
    // Client-facing: the form needs correction (amber, never red — RF-TRX-022).
    "form_response.rejected": {
      titleI18n: { en: "Your form needs correction", es: "Tu formulario necesita corrección" },
      bodyI18n: { en: "Please review the notes and submit it again.", es: "Revisa las observaciones y vuelve a enviarlo." },
      icon: "alert-circle",
      color: "amber",
    },
    "downpayment.confirmed": {
      titleI18n: { en: "Down payment confirmed", es: "Pago inicial confirmado" },
      bodyI18n: { en: "The initial payment has been received. Your case is now active.", es: "El pago inicial fue recibido. Tu caso está activo." },
      icon: "dollar-sign",
      color: "green",
    },
    "downpayment.confirmed.finance": {
      titleI18n: { en: "Initial payment confirmed", es: "Pago inicial confirmado" },
      bodyI18n: { en: "The initial payment was confirmed and the case is now active.", es: "Se confirmó el pago inicial y el caso quedó activo." },
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
    "appointment.no_show": {
      titleI18n: { en: "You missed your appointment", es: "No asististe a tu cita" },
      bodyI18n: { en: "You can reschedule later. If this was a mistake, let us know.", es: "Puedes reagendar más adelante. Si fue un error, avísanos." },
      icon: "calendar-x",
      color: "amber", // never red toward the client (RF-TRX-022)
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
    // F7 payments
    "installment.overdue": {
      titleI18n: { en: "Payment overdue", es: "Cuota vencida" },
      bodyI18n: { en: "An installment is past due. Please review your payments.", es: "Tienes una cuota vencida. Revisa tus pagos." },
      icon: "alert-circle",
      color: "amber", // never red toward the client (RF-TRX-022)
    },
    "installment.paid": {
      titleI18n: { en: "Payment received", es: "Pago recibido" },
      bodyI18n: { en: "We received your payment. Thank you!", es: "Recibimos tu pago. ¡Gracias!" },
      icon: "dollar-sign",
      color: "green",
    },
    "payment.proof_submitted": {
      titleI18n: { en: "Payment proof to verify", es: "Comprobante por verificar" },
      bodyI18n: { en: "A payment proof was submitted and is awaiting verification.", es: "Se envió un comprobante de pago pendiente de verificación." },
      icon: "file-check",
      color: "accent",
    },
    "payment.proof_submitted.sales": {
      titleI18n: { en: "Your client paid their initial installment via Zelle", es: "Tu cliente pagó su cuota inicial por Zelle" },
      bodyI18n: { en: "A proof is awaiting verification. Review and approve it in the case's Payments tab.", es: "Hay un comprobante esperando verificación. Revísalo y apruébalo en la pestaña Pagos del caso." },
      icon: "file-check",
      color: "accent",
    },
    "payment.refunded": {
      titleI18n: { en: "Payment refunded", es: "Pago reembolsado" },
      bodyI18n: { en: "A payment has been refunded.", es: "Se ha reembolsado un pago." },
      icon: "dollar-sign",
      color: "gold",
    },
    // Zelle reconciliation (0111)
    "zelle.match_suggested": {
      titleI18n: { en: "Zelle payment to reconcile", es: "Pago Zelle por conciliar" },
      bodyI18n: {
        en: "A bank alert arrived and needs your confirmation in the reconciliation inbox.",
        es: "Llegó una alerta del banco y necesita tu confirmación en la bandeja de conciliación.",
      },
      icon: "dollar-sign",
      color: "accent",
    },
    // Autopay (DOC-71 §2.4)
    "autopay.charge_failed": {
      titleI18n: { en: "Automatic payment failed", es: "El cobro automático falló" },
      bodyI18n: {
        en: "We could not charge your card for this installment. We will retry tomorrow, or you can pay now from your payments screen.",
        es: "No pudimos cobrar tu cuota a tu tarjeta. Reintentaremos mañana, o puedes pagarla ahora desde tu pantalla de pagos.",
      },
      icon: "alert-circle",
      color: "amber", // never red toward the client (RF-TRX-022)
    },
    "autopay.disabled": {
      titleI18n: { en: "Automatic payments turned off", es: "Cobro automático desactivado" },
      bodyI18n: {
        en: "Automatic card payments were turned off for your plan. Please pay your installments manually or re-enable automatic payments from your payments screen.",
        es: "Se desactivó el cobro automático de tu plan. Paga tus cuotas manualmente o vuelve a activarlo desde tu pantalla de pagos.",
      },
      icon: "credit-card",
      color: "amber",
    },
    // F7 message digest (anti-burst). Title carries the thread label; the body is
    // replaced by notifyMessageBurst with a counter on the 2nd+ message.
    "message.received": {
      titleI18n: { en: "New message", es: "Nuevo mensaje" },
      bodyI18n: { en: "You have a new message from your team.", es: "Tienes un nuevo mensaje de tu equipo." },
      icon: "message-circle",
      color: "accent",
    },
  };

  const base = contentMap[type] ?? {
    titleI18n: { en: type, es: type },
    bodyI18n: null,
    icon: "bell",
    color: "gray",
  };

  // Payment receipts: enrich the in-app body with the amount + remaining cuotas
  // from the (enriched) event payload (the email carries the full receipt).
  if (type === "installment.paid" && payload["amountCents"] != null) {
    const amount = fmtCents(payload["amountCents"]);
    const remaining = Number(payload["remainingCount"] ?? NaN);
    const remainingEs = Number.isFinite(remaining)
      ? remaining === 0
        ? " ¡Completaste tus pagos!"
        : ` Te ${remaining === 1 ? "falta 1 cuota" : `faltan ${remaining} cuotas`}.`
      : "";
    const remainingEn = Number.isFinite(remaining)
      ? remaining === 0
        ? " You're all paid up!"
        : ` ${remaining === 1 ? "1 installment" : `${remaining} installments`} left.`
      : "";
    return {
      ...base,
      bodyI18n: {
        es: `Recibimos tu pago de ${amount}.${remainingEs}`,
        en: `We received your ${amount} payment.${remainingEn}`,
      },
    };
  }

  return base;
}

// ---------------------------------------------------------------------------
// Build structured email data for rich templates (DOC-73 §2)
// ---------------------------------------------------------------------------

/**
 * Assembles the typed `emailData` a rich template needs, from the (enriched)
 * event payload + the resolved recipient profile. Returns undefined for
 * templateKeys that use the generic NotificationEmail (title/body only).
 */
function buildEmailData(
  templateKey: string,
  payload: Record<string, unknown>,
  recipient: RecipientProfile,
): EmailData | undefined {
  const clientName = recipient.fullName ?? null;
  const phone = recipient.phoneE164 ?? null;
  const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
  const str = (v: unknown): string | null => (v == null ? null : String(v));

  switch (templateKey) {
    case "welcome":
      return { kind: "welcome", clientName, phone };

    case "contract-ready": {
      const locale = recipient.locale === "en" ? "en" : "es";
      const labelI18n = payload["serviceLabelI18n"];
      const serviceName =
        labelI18n && typeof labelI18n === "object"
          ? String(
              (labelI18n as Record<string, unknown>)[locale] ??
                (labelI18n as Record<string, unknown>)["es"] ??
                (labelI18n as Record<string, unknown>)["en"] ??
                "",
            )
          : String(payload["serviceName"] ?? "");
      return {
        kind: "contract-ready",
        clientName,
        phone,
        serviceName,
        totalCents: num(payload["planTotalCents"]),
        downpaymentCents: num(payload["planDownpaymentCents"]),
        installmentCount: num(payload["planInstallmentCount"]),
        frequency: String(payload["planFrequency"] ?? "monthly"),
      };
    }

    case "installment-paid":
    case "downpayment-confirmed": {
      const isDownpayment =
        templateKey === "downpayment-confirmed" || payload["isDownpayment"] === true;
      const installmentNumber =
        payload["installmentNumber"] != null
          ? num(payload["installmentNumber"])
          : payload["number"] != null
            ? num(payload["number"])
            : isDownpayment
              ? 0
              : null;
      return {
        kind: "payment-receipt",
        clientName,
        amountCents: num(payload["amountCents"]),
        method: String(payload["method"] ?? ""),
        autopay: payload["autopay"] === true,
        cardLast4: str(payload["cardLast4"]),
        isDownpayment,
        installmentNumber,
        installmentCount: num(payload["installmentCount"]),
        paidCount: num(payload["paidCount"]),
        remainingCount: num(payload["remainingCount"]),
        remainingAmountCents: num(payload["remainingAmountCents"]),
        nextDueDate: str(payload["nextDueDate"]),
        nextDueAmountCents:
          payload["nextDueAmountCents"] != null ? num(payload["nextDueAmountCents"]) : null,
        caseNumber: str(payload["caseNumber"]),
      };
    }

    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// notifyMessageBurst — anti-burst digest for message.sent (DOC-47 §4.2 / §5.2)
// ---------------------------------------------------------------------------

const FIVE_MIN_MS = 5 * 60 * 1000;
const PUSH_GRACE_SECONDS = 5;

/** True if `iso` is within `ms` of now (sliding 5-min digest window). */
function withinWindow(iso: string, ms: number): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < ms;
}

/** Parses the leading count from a digest body ("3 mensajes nuevos…"); else 1. */
function parseDigestCount(bodyI18n: unknown): number {
  const es = (bodyI18n as { es?: string } | null)?.es ?? "";
  const m = es.match(/^(\d+)/);
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Anti-burst dispatcher for chat messages. The first unread message in a
 * conversation creates one in-app row + a push enqueued with a 5 s grace
 * (the handler re-verifies read_at IS NULL before sending — DOC-46 §5.3.2).
 * Subsequent messages within a 5-min sliding window bump the SAME unread row
 * ("N mensajes nuevos…") with NO new row and NO additional push.
 */
async function notifyMessageBurst(
  payload: Record<string, unknown>,
  recipientId: string,
  prefs: NotificationPreferences,
): Promise<void> {
  if (!prefs.messages) return; // category gate (messages off → nothing)

  const messageId = payload["messageId"] as string | undefined;
  if (!messageId) return;

  // Deep link must resolve to a real screen per the recipient kind: clients open
  // the case home (chat overlay reachable there), staff open the case detail with
  // the Mensajes tab. Per-recipient stable → also the digest scoping key.
  const caseId = payload["caseId"] as string | undefined;
  const recipient = await findUserById(recipientId);
  const actionUrl = caseId
    ? recipient?.kind === "client"
      ? `/caso/${caseId}/camino`
      : `/admin/casos/${caseId}`
    : "/";
  const threadTitle = { es: "tu equipo", en: "your team" };

  // Digest: bump an existing unread row for this conversation within the window.
  const open = await findUnreadMessageDigest(recipientId, actionUrl);
  if (open && withinWindow(open.created_at, FIVE_MIN_MS)) {
    const nextCount = Math.min(parseDigestCount(open.body_i18n) + 1, 999); // cap the display
    await bumpMessageDigest(open.id, recipientId, nextCount, threadTitle);
    return; // no new row, no push
  }

  const content = renderContent("message.received", payload);
  const result = await insertNotificationIdempotent({
    userId: recipientId,
    type: "message.received",
    titleI18n: content.titleI18n,
    bodyI18n: content.bodyI18n,
    icon: content.icon,
    color: content.color,
    actionUrl,
    dedupeKey: `message.sent:${messageId}:${recipientId}`,
  });
  if (!result.created) return; // idempotent re-delivery

  if (prefs.channels.push) {
    try {
      await enqueueJob(
        {
          jobKey: "deliver-notification",
          entityId: result.row.id,
          attempt: 1,
          dedupeId: `push:${result.row.id}`,
          channel: "push",
          notificationId: result.row.id,
        },
        { delay: PUSH_GRACE_SECONDS }, // grace period; handler re-checks read_at
      );
    } catch (err) {
      logger.warn({ err, notificationId: result.row.id }, "notifications: failed to enqueue message push — continuing");
    }
  }
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
    // Payload predicate gate (e.g. sales only notified for the downpayment proof)
    if (rule.when && !rule.when(payload)) continue;

    for (const recipientDef of rule.recipients) {
      const userIds = await resolveRecipients(recipientDef.resolverKey, payload);

      // An unsuppressible rule (e.g. contract.sent signing link, downpayment
      // welcome) that resolves to zero recipients silently drops a must-deliver
      // message — most often a contract sent before its case exists (caseId null).
      if (userIds.length === 0 && rule.unsuppressible) {
        logger.warn(
          { eventType: event.type, ruleType: rule.type, resolverKey: recipientDef.resolverKey },
          "notifications: unsuppressible rule resolved 0 recipients — deep-link/email may be lost",
        );
      }

      for (const userId of userIds) {
        const prefs = await repoGetPreferences(userId);

        // F7 anti-burst: message.sent → message.received (DOC-47 §5.2).
        // Handles its own digest/grace/channel logic.
        if (event.type === "message.sent") {
          await notifyMessageBurst(payload, userId, prefs);
          continue;
        }

        // Category gate (DOC-47 §4.1 step 4): a suppressible rule whose category
        // is turned off produces ZERO channels (RF-TRX-010 CA2) — including in-app.
        if (!rule.unsuppressible && !prefs[rule.category]) continue;

        // NOTE: the in-app row is the BASE channel (DOC-47 §4.1 step 6) and the
        // source-of-truth the deliver-notification job reads for push/email, so it
        // is always inserted once the category gate passes. `channels.inapp` is not
        // independently enforced here and is NOT exposed as a user toggle (the
        // preferences UI exposes the 4 categories + the push device subscription).

        // Build dedupe key — pick the most specific entity id available.
        // paymentId/installmentId come BEFORE caseId: payment events must dedupe
        // per payment (a re-submitted proof after a rejection is a NEW payment and
        // must re-notify), and each overdue installment notifies on its own.
        const entityId = (
          payload["appointmentId"] ??
          payload["newAppointmentId"] ??
          payload["paymentId"] ??
          payload["installmentId"] ??
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

        // Push channel — channel toggle applies unless the rule is unsuppressible
        if (rule.channels.push && (rule.unsuppressible || prefs.channels.push)) {
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
          const recipient = await findRecipientProfile(userId);
          const hasEmail = recipient?.email && !recipient.emailBouncedAt;
          // Channel gate (DOC-47 §4.1 step 4): unsuppressible rules always email;
          // suppressible rules respect the user's email channel toggle (the
          // category was already gated above). email also requires a non-bounced
          // address (DOC-73 §6.2) and a catalog template key.
          const shouldSendEmail = rule.unsuppressible || prefs.channels.email;
          if (shouldSendEmail && hasEmail && rule.emailTemplateKey) {
            // Rich templates (welcome, contract-ready, receipt) get structured
            // data; generic templates fall back to the notification title/body.
            const emailData = buildEmailData(rule.emailTemplateKey, payload, recipient!);
            try {
              await enqueueJob({
                jobKey: "deliver-notification",
                entityId: notificationId,
                attempt: 1,
                dedupeId: `email:${notificationId}`,
                channel: "email",
                notificationId,
                templateKey: rule.emailTemplateKey,
                recipientEmail: recipient!.email!,
                locale: recipient!.locale ?? "es",
                ...(emailData ? { emailData } : {}),
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

// ---------------------------------------------------------------------------
// markAllRead + unread badge (DOC-47 §5.3)
// ---------------------------------------------------------------------------

/** Marks every unread notification of the actor as read (bell "mark all"). */
export async function markAllRead(actor: Actor): Promise<void> {
  await markAllNotificationsRead(actor.userId);
}

/** Unread count for the bell/Avisos badge — consistent across surfaces (RF-TRX-014 CA3). */
export async function getUnreadCount(actor: Actor): Promise<{ total: number }> {
  return { total: await getUnreadCountForUser(actor.userId) };
}

// ---------------------------------------------------------------------------
// Preferences (DOC-47 §5.3) — read + update (no retroactive effect)
// ---------------------------------------------------------------------------

/** Returns the actor's notification preferences (all-true defaults if unset). */
export async function getPreferences(actor: Actor): Promise<NotificationPreferences> {
  return repoGetPreferences(actor.userId);
}

/**
 * Updates the actor's notification preferences. Unknown/missing fields fall back
 * to the current defaults so a partial update never drops a category silently.
 */
export async function updatePreferences(
  actor: Actor,
  input: Partial<NotificationPreferences> & { channels?: Partial<NotificationPreferences["channels"]> },
): Promise<NotificationPreferences> {
  const current = await repoGetPreferences(actor.userId);
  const next: NotificationPreferences = {
    messages: input.messages ?? current.messages,
    appointment_reminders: input.appointment_reminders ?? current.appointment_reminders,
    payment_reminders: input.payment_reminders ?? current.payment_reminders,
    case_updates: input.case_updates ?? current.case_updates,
    channels: {
      inapp: input.channels?.inapp ?? current.channels.inapp,
      push: input.channels?.push ?? current.channels.push,
      email: input.channels?.email ?? current.channels.email,
    },
  };
  await upsertPreferences(actor.userId, next);
  return next;
}

// ---------------------------------------------------------------------------
// Push subscriptions (DOC-47 §5.3 + DOC-24) — register / remove a device
// ---------------------------------------------------------------------------

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  platform?: string;
}

/** Registers (upserts by endpoint) a Web Push subscription for the actor's device. */
export async function registerPushSubscription(
  actor: Actor,
  input: PushSubscriptionInput,
): Promise<void> {
  await upsertPushSubscription({
    userId: actor.userId,
    endpoint: input.endpoint,
    keys: input.keys,
    platform: input.platform ?? "web",
  });
}

/** Removes a Web Push subscription owned by the actor (logout / opt-out). */
export async function removePushSubscription(
  actor: Actor,
  endpoint: string,
): Promise<void> {
  await removePushSubscriptionForUser(actor.userId, endpoint);
}

// Re-export types + defaults for the index boundary / actions.
export { DEFAULT_PREFERENCES };
export type { NotificationPreferences, NotificationCategory };
