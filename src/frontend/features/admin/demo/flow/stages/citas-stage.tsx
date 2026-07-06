"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { es as esLocale, enUS } from "date-fns/locale";
import { GradientBtn, Icon, IconTile } from "@/frontend/components/brand";
import { ScreenHead } from "@/frontend/components/mobile";
import type { DemoFlow } from "../use-demo-flow";

/**
 * CitasStage — replica of the client "Agendar cita" screen (DOC-51 §18) as a
 * demo stage: monthly calendar (only future weekdays are tappable) + a 2-column
 * slot grid with the dual hour (client TZ big / staff TZ small "… en Utah"),
 * reminders and the cancellation-penalty notice. Everything is pure UI — booking
 * raises the `citaSuccess` overlay and persists `bookedCita` in the state machine,
 * which flips this stage to its confirmed "cita agendada" state.
 *
 * Availability is derived from the real "now" (day-granular) so the demo never
 * shows a past month; it is computed after mount to avoid a hydration mismatch.
 */

interface DemoSlot {
  id: string;
  /** Client-local time shown large, e.g. "9:00 AM". */
  primary: string;
  /** Staff-local time shown small (suffix added from i18n), e.g. "7:00 AM". */
  utah: string;
}

/** Fixed slot menu offered on every available day (Florida ET vs Utah MT, −2h). */
const SLOTS: readonly DemoSlot[] = [
  { id: "0900", primary: "9:00 AM", utah: "7:00 AM" },
  { id: "1000", primary: "10:00 AM", utah: "8:00 AM" },
  { id: "1100", primary: "11:00 AM", utah: "9:00 AM" },
  { id: "1400", primary: "2:00 PM", utah: "12:00 PM" },
  { id: "1500", primary: "3:00 PM", utah: "1:00 PM" },
];

/** Max number of upcoming weekdays lit up as "available" in the current month. */
const MAX_AVAILABLE_DAYS = 8;

function dfLocale(locale: string) {
  return locale === "en" ? enUS : esLocale;
}

function dayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The upcoming weekdays (Mon–Fri) of the current month, starting tomorrow,
 * capped at MAX_AVAILABLE_DAYS — a deterministic, always-fresh availability set.
 */
function buildAvailableDays(now: Date): Set<string> {
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = new Set<string>();
  for (let d = now.getDate() + 1; d <= daysInMonth && days.size < MAX_AVAILABLE_DAYS; d++) {
    const weekday = new Date(year, month, d).getDay();
    if (weekday >= 1 && weekday <= 5) days.add(dayKey(year, month, d));
  }
  return days;
}

export function CitasStage({ flow, advisorName }: { flow: DemoFlow; advisorName: string }) {
  const { state, actions } = flow;

  // Confirmed state — the Citas tab's default view once a cita exists (RF-CLI-041).
  if (state.bookedCita) {
    return (
      <BookedView
        dateLabel={state.bookedCita.dateLabel}
        hourLabel={state.bookedCita.hourLabel}
        advisorName={advisorName}
      />
    );
  }

  return <AgendarView advisorName={advisorName} onBook={actions.bookCita} />;
}

/* ------------------------------------------------------------------ agendar */

function AgendarView({
  advisorName,
  onBook,
}: {
  advisorName: string;
  onBook: (cita: { dateLabel: string; hourLabel: string }) => void;
}) {
  const t = useTranslations("staff.demo.citas");
  const locale = useLocale();

  // Capture "now" only on the client to avoid an SSR/CSR hydration mismatch.
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => setNow(new Date()), []);

  const [selectedDay, setSelectedDay] = React.useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = React.useState<string | null>(null);
  const [reminderDay, setReminderDay] = React.useState(true);
  const [reminderHour, setReminderHour] = React.useState(false);

  const availableDays = React.useMemo(() => (now ? buildAvailableDays(now) : new Set<string>()), [now]);

  const grid = React.useMemo(() => {
    if (!now) return [] as Array<{ day: number; key: string } | null>;
    const year = now.getFullYear();
    const month = now.getMonth();
    const first = new Date(year, month, 1).getDay(); // 0 = Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ day: number; key: string } | null> = [];
    for (let i = 0; i < first; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, key: dayKey(year, month, d) });
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [now]);

  const monthLabel = React.useMemo(() => {
    if (!now) return "";
    const s = format(now, "LLLL yyyy", { locale: dfLocale(locale) });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }, [now, locale]);

  const selectedDayLabel = React.useMemo(() => {
    if (!selectedDay) return "";
    const [y, m, d] = selectedDay.split("-").map(Number);
    return format(new Date(y, m - 1, d), locale === "en" ? "MMMM d" : "d 'de' MMMM", {
      locale: dfLocale(locale),
    });
  }, [selectedDay, locale]);

  const weekdayCells = t("weekdays").split(" ");
  const chosen = selectedSlot ? SLOTS.find((s) => s.id === selectedSlot) ?? null : null;

  const confirm = () => {
    if (!chosen || !selectedDay) return;
    onBook({ dateLabel: selectedDayLabel, hourLabel: chosen.primary });
  };

  return (
    <div style={{ minHeight: "100%", padding: "16px 20px 130px" }}>
      <ScreenHead title={t("title")} sub={t("subtitle", { advisor: advisorName })} lexMood="calma" />

      {/* Zona horaria */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--blue-soft)",
          borderRadius: 18,
          padding: "13px 15px",
          marginBottom: 16,
        }}
      >
        <IconTile name="globe" color="var(--accent)" size={38} radius={999} iconSize={21} />
        <div style={{ fontSize: 14, color: "var(--navy)", fontWeight: 600, lineHeight: 1.4 }}>
          {t("tzBanner")}
        </div>
      </div>

      {/* Calendario */}
      <div
        style={{
          background: "var(--card)",
          borderRadius: 24,
          padding: 16,
          boxShadow: "var(--shadow-soft)",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span aria-hidden style={navBtnStyle}>
            <Icon name="chevL" size={20} color="var(--ink-3)" />
          </span>
          <div className="t-title" style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)" }}>
            {monthLabel || "—"}
          </div>
          <span aria-hidden style={navBtnStyle}>
            <Icon name="chevR" size={20} color="var(--ink-3)" />
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 6 }}>
          {weekdayCells.map((w, i) => (
            <div key={i} aria-hidden style={{ textAlign: "center", fontSize: 12, fontWeight: 800, color: "var(--ink-3)" }}>
              {w}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {grid.map((cell, i) => {
            if (!cell) return <div key={i} aria-hidden />;
            const has = availableDays.has(cell.key);
            const isSelected = selectedDay === cell.key;
            return (
              <div key={i} style={{ display: "flex", justifyContent: "center" }}>
                <button
                  type="button"
                  disabled={!has}
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelectedDay(cell.key);
                    setSelectedSlot(null);
                  }}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 999,
                    border: "none",
                    cursor: has ? "pointer" : "default",
                    fontFamily: "var(--font-title)",
                    fontWeight: 700,
                    fontSize: 15,
                    transition: "transform 0.15s var(--ease), background 0.18s ease",
                    background: isSelected ? "var(--accent)" : has ? "var(--blue-soft)" : "transparent",
                    color: isSelected ? "#fff" : has ? "var(--accent)" : "var(--ink-3)",
                    opacity: has ? 1 : 0.4,
                    boxShadow: isSelected ? "0 8px 18px color-mix(in srgb, var(--accent) 38%, transparent)" : "none",
                  }}
                >
                  {cell.day}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Horarios */}
      <div className="t-title" style={{ fontSize: 17, fontWeight: 800, color: "var(--navy)", margin: "4px 2px 12px" }}>
        {t("slotsTitle", { date: selectedDay ? selectedDayLabel : "…" })}
      </div>

      {!selectedDay ? (
        <HintCard text={t("pickDayFirst")} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
          {SLOTS.map((s) => {
            const isSel = selectedSlot === s.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={isSel}
                onClick={() => setSelectedSlot(s.id)}
                className="mp-pop"
                style={{
                  minHeight: 58,
                  borderRadius: 16,
                  border: isSel ? "none" : "1.5px solid var(--line)",
                  background: isSel ? "var(--accent)" : "var(--card)",
                  cursor: "pointer",
                  padding: "8px 10px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 1,
                  boxShadow: isSel ? "0 10px 22px color-mix(in srgb, var(--accent) 32%, transparent)" : "var(--shadow-soft)",
                  transition: "transform 0.15s var(--ease), background 0.18s ease",
                }}
              >
                <span className="t-title" style={{ fontSize: 16, fontWeight: 800, color: isSel ? "#fff" : "var(--navy)" }}>
                  {s.primary}
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: isSel ? "rgba(255,255,255,0.82)" : "var(--ink-3)" }}>
                  {s.utah} {t("utahSuffix")}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Recordatorios */}
      <div style={{ background: "var(--card)", borderRadius: 20, padding: "8px 16px", boxShadow: "var(--shadow-soft)", marginBottom: 14 }}>
        <CheckRow label={t("reminderDay")} checked={reminderDay} onToggle={() => setReminderDay((v) => !v)} />
        <div style={{ height: 1, background: "var(--line)" }} />
        <CheckRow label={t("reminderHour")} checked={reminderHour} onToggle={() => setReminderHour((v) => !v)} />
      </div>

      {/* Aviso de penalización */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          background: "var(--gold-soft)",
          borderRadius: 18,
          padding: "13px 16px",
          marginBottom: 18,
        }}
      >
        <Icon name="info" size={20} color="var(--gold-deep)" stroke={2.4} />
        <span style={{ fontSize: 13.5, color: "var(--gold-deep)", fontWeight: 700, lineHeight: 1.4 }}>{t("penalty")}</span>
      </div>

      {/* CTA */}
      <GradientBtn icon={chosen ? "check" : "calendar"} size="lg" disabled={!chosen} onClick={confirm}>
        {chosen ? t("ctaReady") : t("ctaEmpty")}
      </GradientBtn>
    </div>
  );
}

/* --------------------------------------------------------------- confirmada */

function BookedView({ dateLabel, hourLabel, advisorName }: { dateLabel: string; hourLabel: string; advisorName: string }) {
  const t = useTranslations("staff.demo.citas");
  return (
    <div style={{ minHeight: "100%", padding: "16px 20px 130px" }}>
      <ScreenHead title={t("bookedTitle")} sub={t("bookedSub")} lexMood="feliz" />

      <div
        className="demo-pop"
        style={{ background: "var(--card)", borderRadius: 24, padding: 22, boxShadow: "var(--shadow-soft)", marginBottom: 16 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <IconTile name="calendar" color="var(--green)" size={46} radius={13} iconSize={24} />
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--navy)" }}>{t("bookedHeadline")}</div>
        </div>

        <InfoRow label={t("bookedDate")} value={dateLabel} />
        <InfoRow label={t("bookedHour")} value={hourLabel} />
        <InfoRow label={t("bookedWith")} value={advisorName} last />
      </div>

      <GradientBtn icon="video" size="lg">
        {t("joinCall")}
      </GradientBtn>
      <p style={{ margin: "12px 2px 0", fontSize: 13, color: "var(--ink-3)", fontWeight: 600, textAlign: "center", lineHeight: 1.5 }}>
        {t("joinNote")}
      </p>
    </div>
  );
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 0",
        borderBottom: last ? "none" : "1px solid var(--line)",
      }}
    >
      <span style={{ fontSize: 13.5, color: "var(--ink-2)", fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 14.5, color: "var(--navy)", fontWeight: 800, textAlign: "right" }}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------- pieces */

const navBtnStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 999,
  display: "grid",
  placeItems: "center",
  background: "var(--bg)",
};

function HintCard({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        background: "var(--blue-soft)",
        borderRadius: 18,
        padding: "16px 18px",
        marginBottom: 18,
      }}
    >
      <Icon name="clock" size={20} color="var(--accent)" stroke={2.2} />
      <span style={{ fontSize: 13.5, color: "var(--ink-2)", fontWeight: 600, lineHeight: 1.4 }}>{text}</span>
    </div>
  );
}

function CheckRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "12px 0",
        textAlign: "left",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 24,
          height: 24,
          borderRadius: 8,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          background: checked ? "var(--accent)" : "transparent",
          border: checked ? "none" : "1.5px solid var(--line)",
          transition: "background 0.18s ease",
        }}
      >
        {checked && <Icon name="check" size={16} color="#fff" stroke={3} />}
      </span>
      <span style={{ flex: 1, fontSize: 14.5, color: "var(--navy)", fontWeight: 600 }}>{label}</span>
    </button>
  );
}
