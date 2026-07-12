/**
 * Historial del caso — `/caso/[caseId]/historial` · nivel CASO — DOC-51 §23.
 *
 * Server component. Reads the client-visible timeline (getTimeline → only
 * visible_to_client). Groups events by day in the user's timezone and maps
 * event_type → filter category + the DB lucide icon → the brand icon set.
 */

import { notFound, redirect } from "next/navigation";
import { getLocale, getTimeZone, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getTimeline } from "@/backend/modules/cases";
import { getClientCaseNotes } from "@/backend/modules/notes";
import { type IconName } from "@/frontend/components/brand/icon";
import { pickLocale, coerceIcon, type Locale } from "@/frontend/features/cliente/shared/i18n";
import {
  HistorialScreen,
  type HistorialDay,
  type HistorialEvent,
} from "@/frontend/features/cliente/historial/historial-screen";

// event_type → filter category (DOC-51 §23 mapping).
function categoryFor(eventType: string): HistorialEvent["category"] {
  if (eventType.startsWith("document")) return "doc";
  if (eventType.startsWith("appointment")) return "cita";
  if (eventType.startsWith("form")) return "form";
  if (eventType.startsWith("payment") || eventType.startsWith("downpayment"))
    return "pago";
  if (eventType.startsWith("message") || eventType.startsWith("call")) return "msg";
  return "doc";
}

// DB lucide icon names → brand icon set names.
const LUCIDE_TO_BRAND: Record<string, IconName> = {
  "check-circle": "check",
  "alert-circle": "info",
  upload: "upload",
  "file-check": "check",
  "file-plus": "doc",
  "dollar-sign": "wallet",
  "chevrons-right": "star",
  "refresh-cw": "info",
  "file-signature": "edit",
};

// DB color token → brand CSS var.
const COLOR_MAP: Record<string, string> = {
  green: "var(--green)",
  amber: "var(--gold-deep)",
  gold: "var(--gold-deep)",
  blue: "var(--accent)",
  gray: "var(--ink-3)",
  red: "var(--red)",
};

export default async function HistorialPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const tz = await getTimeZone();
  const t = await getTranslations("cliente.historial");

  let page;
  try {
    page = await getTimeline(actor, caseId, { limit: 50 });
  } catch {
    notFound();
  }

  // General notes surface in the client's case history (RLS returns only general
  // notes of a case the client belongs to). Degrade to none on failure.
  const generalNotes = await getClientCaseNotes(actor, caseId).catch(() => []);

  const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayLabelFmt = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    day: "numeric",
    month: "long",
  });
  const timeFmt = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  const today = dayKeyFmt.format(new Date());
  const yesterday = dayKeyFmt.format(new Date(Date.now() - 86400000));

  // Merge the client-visible timeline with general notes into one date-sorted
  // stream, then group by day (in user TZ), preserving desc order.
  const entries: { at: string; ev: HistorialEvent }[] = [];

  for (const row of page.items) {
    entries.push({
      at: row.occurred_at,
      ev: {
        id: row.id,
        category: categoryFor(row.event_type),
        icon: LUCIDE_TO_BRAND[row.icon] ?? coerceIcon(row.icon, "info"),
        color: COLOR_MAP[row.color] ?? "var(--ink-3)",
        text:
          pickLocale(
            {
              es: (row.title_i18n as { es?: string })?.es ?? "",
              en: (row.title_i18n as { en?: string })?.en ?? "",
            },
            locale,
          ) || row.event_type,
        body:
          pickLocale(
            {
              es: (row.body_i18n as { es?: string })?.es ?? "",
              en: (row.body_i18n as { en?: string })?.en ?? "",
            },
            locale,
          ) || null,
        time: timeFmt.format(new Date(row.occurred_at)),
        team: row.actor_kind !== "client",
      },
    });
  }

  for (const n of generalNotes) {
    entries.push({
      at: n.createdAt,
      ev: {
        id: n.id,
        category: "nota",
        icon: "doc",
        color: "var(--accent)",
        text: n.body,
        body: null,
        time: timeFmt.format(new Date(n.createdAt)),
        team: true,
      },
    });
  }

  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const groups = new Map<string, HistorialDay>();
  for (const { at, ev } of entries) {
    const date = new Date(at);
    const key = dayKeyFmt.format(date);
    const label =
      key === today ? t("today") : key === yesterday ? t("yesterday") : dayLabelFmt.format(date);
    if (!groups.has(key)) groups.set(key, { label, events: [] });
    groups.get(key)!.events.push(ev);
  }

  const days: HistorialDay[] = Array.from(groups.values());

  return (
    <HistorialScreen
      caseId={caseId}
      days={days}
      labels={{
        back: t("back"),
        title: t("title"),
        subtitle: t("subtitle"),
        filterAll: t("filterAll"),
        filterDocs: t("filterDocs"),
        filterMeetings: t("filterMeetings"),
        filterForms: t("filterForms"),
        filterPayments: t("filterPayments"),
        filterMessages: t("filterMessages"),
        filterNotes: t("filterNotes"),
        you: t("you"),
        team: t("team"),
        emptyFilter: t("emptyFilter"),
      }}
    />
  );
}
