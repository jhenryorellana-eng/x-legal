/**
 * Pagos y cuotas — `/finanzas/pagos` (Andrium · finance).
 *
 * Server component: loads gate items + tab data from the billing module, then
 * mounts <PagosGlobalView/> with serialisable VMs.
 *
 * Sources of truth:
 *  - DOC-55-UI-ANDRIUM §3 (§3.1–3.11)
 *  - PROMPT-AND-03 §3
 *  - RF-AND-007–022 / RF-AND-014 (Calendario) / RF-AND-020 (Morosidad)
 */

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getActor, can } from "@/backend/modules/identity";
import {
  listDueCalendar,
  listOverdueForCollections,
  BillingError,
} from "@/backend/modules/billing";
import { getReconInbox } from "@/backend/modules/zelle-recon";
import type { Locale } from "@/shared/i18n";
import {
  PagosGlobalView,
  type PagosGlobalVM,
  type GateItemVM,
  type DueCalendarItemVM,
  type DueCalendarGroupVM,
  type OverdueGroupVM,
} from "@/frontend/features/andrium/pagos/pagos-global-view";
import type { ReconInboxVMShape } from "@/frontend/features/andrium/pagos/conciliacion-tab";
import {
  confirmZelleMatchAction,
  reassignZelleNotificationAction,
  dismissZelleNotificationAction,
  getZelleEvidenceUrlAction,
  searchReconTargetsAction,
} from "./actions";

import esMessages from "@/frontend/i18n/messages/es.json";
import enMessages from "@/frontend/i18n/messages/en.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** staff.finanzas.pagos is a nested object in the messages JSON (flat label map). */
function pagosLabels(msgs: unknown): Record<string, string> {
  const staff = (msgs as { staff?: { finanzas?: { pagos?: Record<string, string> } } })
    .staff?.finanzas?.pagos;
  return staff ?? {};
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  try {
    can(actor, "billing", "view");
  } catch {
    redirect("/finanzas");
  }

  const locale = (await getLocale()) as Locale;
  const { tab } = await searchParams;

  let gateItems: GateItemVM[] = [];
  let calendarGroups: DueCalendarGroupVM[] = [];
  let overdueGroups: OverdueGroupVM[] = [];
  let reconVM: ReconInboxVMShape | null = null;

  try {
    const now = new Date();
    const from = isoDate(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()));
    const to = isoDate(new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()));

    const [calendar, overdue] = await Promise.all([
      listDueCalendar(actor, { from, to }),
      listOverdueForCollections(actor),
    ]);

    // Calendar grouped by due date (ascending)
    const byDate = new Map<string, DueCalendarGroupVM>();
    for (const item of calendar) {
      let group = byDate.get(item.dueDate);
      if (!group) {
        group = { date: item.dueDate, items: [] };
        byDate.set(item.dueDate, group);
      }
      group.items.push({ ...item, status: item.status as DueCalendarItemVM["status"] });
    }
    calendarGroups = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

    // Gate: pending/overdue downpayment installments (payment_pending cases).
    // The downpayment due_date is the signing anchor, so we use it as signedAt.
    gateItems = calendar
      .filter(
        (i) =>
          i.isDownpayment &&
          (i.status === "pending" || i.status === "overdue" || i.status === "processing"),
      )
      .map((i): GateItemVM => ({
        installmentId: i.installmentId,
        caseId: i.caseId,
        caseNumber: i.caseNumber,
        clientName: i.clientName,
        serviceName: "",
        amountCents: i.amountCents,
        signedAt: i.dueDate,
        isDownpayment: true,
      }));

    // Morosidad grouped by case
    const byCase = new Map<string, OverdueGroupVM>();
    for (const item of overdue) {
      let group = byCase.get(item.caseId);
      if (!group) {
        group = {
          caseId: item.caseId,
          caseNumber: item.caseNumber,
          clientName: item.clientName,
          totalOverdueCents: 0,
          maxDaysLate: 0,
          items: [],
        };
        byCase.set(item.caseId, group);
      }
      group.items.push(item);
      group.totalOverdueCents += item.amountCents;
      group.maxDaysLate = Math.max(group.maxDaysLate, item.daysLate);
    }
    overdueGroups = [...byCase.values()].sort((a, b) => b.maxDaysLate - a.maxDaysLate);
  } catch (err) {
    // Known billing errors degrade to empty state; anything else too (no 500).
    if (!(err instanceof BillingError)) {
      console.error("[/finanzas/pagos] load failed:", err);
    }
  }

  // Zelle reconciliation inbox (0111). Degrades to null (fallback card) —
  // before the migration is applied the zelle_* tables don't exist yet.
  try {
    reconVM = await getReconInbox(actor);
  } catch (err) {
    console.error("[/finanzas/pagos] recon inbox load failed:", err);
  }

  const vm: PagosGlobalVM = {
    gateItems,
    calendarGroups,
    overdueGroups,
    locale: locale === "en" ? "en" : "es",
    reconVM,
  };

  return (
    <div>
      <PagosGlobalView
        vm={vm}
        tEs={pagosLabels(esMessages)}
        tEn={pagosLabels(enMessages)}
        reconActions={{
          confirmZelleMatch: confirmZelleMatchAction,
          reassignZelleNotification: reassignZelleNotificationAction,
          dismissZelleNotification: dismissZelleNotificationAction,
          getZelleEvidenceUrl: getZelleEvidenceUrlAction,
          searchReconTargets: searchReconTargetsAction,
        }}
        initialTab={tab === "conciliacion" ? "conciliacion" : undefined}
      />
    </div>
  );
}
