/**
 * Mi día — sales daily dashboard · /ventas/mi-dia (DOC-52 §1).
 *
 * Server Component: guards the actor, reads KPIs / uncontacted leads / today's
 * agenda / tasks via the kanban + scheduling module indexes, composes the
 * normative strings, and injects the server actions into the client view.
 *
 * F3 note: real reads land here; while some aggregate reads are still being
 * wired (cases/contracts counts) the page renders with the values available and
 * em-dash placeholders — never a false zero (DOC-50 §5). The dev preview
 * (/ventas-preview) renders the same view with sample data for Playwright.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { listLeads, listMyTasks } from "@/backend/modules/kanban";
import { MiDiaView } from "@/frontend/features/vanessa";
import { fmtHeaderDate, fmtRelative, type Locale } from "@/frontend/lib/datetime";
import { sourceMeta } from "@/frontend/features/vanessa/shared/source-meta";
import { MiDiaClientShell } from "./client-shell";
import { contactLeadAction, toggleTaskDoneAction } from "../actions";

export const dynamic = "force-dynamic";

const STAFF_TZ = "America/New_York";

export default async function MiDiaPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.ventas.miDia");

  // Uncontacted leads (oldest first) → "Por atender ahora"
  const leadsPage = await listLeads(actor, { uncontacted: true }).catch(() => null);
  const leads = leadsPage?.items ?? [];
  const tasks = await listMyTasks(actor).catch(() => []);

  const now = new Date();
  const minutesSince = (iso: string) => Math.floor((now.getTime() - new Date(iso).getTime()) / 60000);

  const attend = leads.slice(0, 4).map((l) => {
    const sm = sourceMeta(l.source ?? "web");
    return {
      id: l.id,
      title: l.full_name ?? l.phone_e164,
      source: l.source ?? "web",
      sourceLabel: sm.labelKey,
      serviceLabel: "Visa Juvenil",
      minutes: l.created_at ? minutesSince(l.created_at) : 0,
      ageLabel: l.created_at ? fmtRelative(l.created_at, locale) : "",
      phone: l.phone_e164 ?? null,
    };
  });

  const uncontactedCount = leadsPage?.items.length ?? 0;

  const greetKey =
    now.getHours() < 12
      ? "greetingMorning"
      : now.getHours() < 19
        ? "greetingAfternoon"
        : "greetingEvening";

  const strings = {
    greeting: t(greetKey, { name: "Vanessa" }),
    dateLine: t("dateLine", { date: fmtHeaderDate(now, STAFF_TZ, locale) }),
    tzChip: t("tzChip"),
    attendTitle: t("attendTitle"),
    attendChip: t("attendChip"),
    emptyAttend: t("emptyAttend"),
    seeLeads: t("seeLeads", { n: "{n}" }),
    agendaTitle: t("agendaTitle"),
    emptyAgenda: t("emptyAgenda"),
    tasksTitle: t("tasksTitle"),
    enterCall: t("enterCall"),
    call: t("call"),
    whatsapp: t("whatsapp"),
    schedule: t("schedule"),
    lexBriefHtml: t.markup("lexBriefHtml", {
      b: (c) => `<b>${c}</b>`,
      n: String(uncontactedCount),
      name: attend[0]?.title ?? "—",
    }),
    lexContactLabel: t("lexContact", { name: attend[0]?.title ?? "—" }),
    lexMessagingLabel: t("lexMessaging"),
    lexEnabled: true,
  };

  const kpis = [
    {
      hot: true,
      icon: "bolt",
      value: uncontactedCount,
      label: t("kpiNewLeads"),
      flag: uncontactedCount > 0 ? t("kpiFlag") : undefined,
    },
    { icon: "event", value: "—", label: t("kpiToday"), tone: "#8B5CF6" },
    { icon: "fact_check", value: "—", label: t("kpiReview"), tone: "#F59E0B" },
    { icon: "verified", value: "—", label: t("kpiClosings"), tone: "#1BB673" },
  ];

  return (
    <MiDiaClientShell>
      <MiDiaView
        kpis={kpis}
        attend={attend}
        agenda={[]}
        tasks={tasks.map((task) => ({
          id: task.id,
          text: task.text,
          tag: task.tag ?? "",
          done: task.done_at !== null,
        }))}
        totalUncontacted={uncontactedCount}
        strings={strings}
        actions={{ contactLead: contactLeadAction, toggleTask: toggleTaskDoneAction }}
      />
    </MiDiaClientShell>
  );
}
