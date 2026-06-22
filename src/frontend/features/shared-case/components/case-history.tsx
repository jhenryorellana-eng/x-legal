import * as React from "react";
import { Icon, type IconName } from "@/frontend/components/brand/icon";
import type { TimelineEventVM } from "../types";

/**
 * Case timeline rendered with the `.casetl` design classes (vanessa.css).
 * Groups events by day; maps the DB `icon` string to a brand Icon + color.
 */
const ICON_MAP: { test: RegExp; icon: IconName; color: string }[] = [
  { test: /check|approve|complete|sign|verified/i, icon: "check", color: "var(--brand-green)" },
  { test: /upload|file|attach/i, icon: "upload", color: "var(--accent)" },
  { test: /event|calendar|cita|appoint|schedul/i, icon: "calendar", color: "#8B5CF6" },
  { test: /mail|letter|carta/i, icon: "send", color: "var(--brand-gold)" },
  { test: /forum|chat|message|msg/i, icon: "chat", color: "var(--accent)" },
  { test: /edit|form|note/i, icon: "form", color: "#06B6D4" },
  { test: /flag|milestone|hito|phase/i, icon: "star", color: "var(--brand-green)" },
  { test: /dollar|pay|zelle|billing|contract/i, icon: "dollar", color: "var(--brand-green)" },
  { test: /error|reject|correg|warn/i, icon: "info", color: "var(--brand-gold)" },
  { test: /doc/i, icon: "doc", color: "var(--accent)" },
];

function look(dbIcon: string): { icon: IconName; color: string } {
  for (const m of ICON_MAP) if (m.test.test(dbIcon)) return { icon: m.icon, color: m.color };
  return { icon: "info", color: "var(--accent)" };
}

function fmt(iso: string, locale: "es" | "en", opts: Intl.DateTimeFormatOptions): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Pin the timezone (org default, ET) so the server and client render the SAME
  // text — otherwise the per-runtime default timezone differs and React throws a
  // hydration mismatch (#418) on the timeline.
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-ES", {
    ...opts,
    timeZone: "America/New_York",
  }).format(d);
}

export function CaseHistory({
  events,
  locale,
}: {
  events: TimelineEventVM[];
  locale: "es" | "en";
}) {
  // Group by day, preserving incoming order (events arrive newest-first).
  const groups: { day: string; items: TimelineEventVM[] }[] = [];
  for (const ev of events) {
    const day = fmt(ev.occurredAt, locale, { day: "numeric", month: "long" });
    const g = groups.find((x) => x.day === day);
    if (g) g.items.push(ev);
    else groups.push({ day, items: [ev] });
  }

  return (
    <div className="casetl">
      {groups.map((g) => (
        <div key={g.day}>
          <div className="casetl-day">
            <Icon name="calendar" size={15} color="var(--ink-3)" />
            {g.day}
          </div>
          {g.items.map((ev) => {
            const v = look(ev.icon);
            return (
              <div className="htl-item" key={ev.id}>
                <div className="htl-rail">
                  <div className="htl-dot" style={{ background: v.color }}>
                    <Icon name={v.icon} size={18} color="#fff" />
                  </div>
                </div>
                <div className="htl-card">
                  <div className="htl-top">
                    <span className="htl-title">{ev.title}</span>
                    <span className="htl-time">{fmt(ev.occurredAt, locale, { hour: "numeric", minute: "2-digit" })}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
