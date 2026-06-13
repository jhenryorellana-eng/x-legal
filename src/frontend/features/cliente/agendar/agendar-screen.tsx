"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { format } from "date-fns";
import { es as esLocale, enUS } from "date-fns/locale";
import { Icon } from "@/frontend/components/brand/icon";
import { IconTile } from "@/frontend/components/brand/icon-tile";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { ScreenHead } from "@/frontend/components/mobile";
import { clientDualHour, type Locale } from "@/frontend/lib/datetime";

/**
 * Action result shapes. Structurally identical to the app-layer server actions
 * (passed in as props); defined HERE because `frontend` may not import `app`
 * (boundary R5). They pass type-structurally when the page wires the real action.
 */
export interface SlotWire {
  startUtc: string;
  endUtc: string;
}
export interface GetSlotsActionResult {
  ok: boolean;
  slots?: SlotWire[];
  durationMinutes?: number;
  kind?: "video" | "phone" | "presencial";
  sequenceNumber?: number;
  staffTimezone?: string;
  error?: { code: string; blockedUntil?: string | null };
}
export interface BookAppointmentActionResult {
  ok: boolean;
  appointmentId?: string;
  error?: { code: string; blockedUntil?: string | null };
}
export interface RescheduleAppointmentActionResult {
  ok: boolean;
  appointmentId?: string;
  error?: { code: string };
}

/**
 * AgendarScreen — `/caso/[caseId]/agendar` (DOC-51 §18, prototype `screens3.jsx
 * → ScheduleScreen`, prompt cliente/18).
 *
 * Monthly calendar (only days WITH real availability are tappable) + a 2-column
 * slot grid showing the dual hour (client TZ big / staff TZ small "… en Utah").
 * Both hours derive from the same UTC instant via date-fns-tz — never a fixed
 * offset table (DOC-23 §6.4). The CTA is inert without a chosen slot.
 *
 * Slots come pre-materialised for an initial window from the server page; moving
 * the calendar to another month refetches via `getSlots` (a thin wrapper over
 * API-SCH-01). Booking goes through `bookAppointment` (API-SCH-02): SLOT_TAKEN
 * refetches the grid; REBOOKING_BLOCKED is handled upstream (the page renders the
 * block screen), but we also guard it here for live cancellations.
 */

export interface AgendarLabels {
  title: string;
  subtitle: string;
  bannerTz: string; // "...tu hora local ({region})."
  region: string;
  monthAria: string;
  prevMonth: string;
  nextMonth: string;
  weekdays: string; // "D L M M J V S"
  slotsTitle: string; // "...para el {date}"
  slotsLoading: string;
  pickDayFirst: string;
  noSlotsDay: string;
  remindersTitle: string;
  reminder1d: string;
  reminder1h: string;
  noteLabel: string;
  notePlaceholder: string;
  penaltyNotice: string;
  ctaIdle: string;
  ctaReady: string;
  ctaReschedule: string;
  ctaBooking: string;
  inOffice: string; // "{hora} en Utah"
  seqLabel: string; // "Cita {n} de {total}"
  errSlotTaken: string;
  errNoLeft: string;
  errGeneric: string;
  errWindow: string;
  back: string;
}

export interface AgendarScreenProps {
  caseId: string;
  /** Client timezone (the user that looks). */
  clientTimezone: string;
  /** Staff timezone, for the small dual hour. */
  staffTimezone: string;
  /** Initial slots (UTC ISO) for the first month, materialised server-side. */
  initialSlots: SlotWire[];
  durationMinutes: number;
  /** "Cita {n} de {total}" context (when the phase allows several). */
  sequenceNumber: number;
  appointmentCount: number;
  locale: Locale;
  labels: AgendarLabels;
  /** When set, the screen reschedules this appointment instead of booking new. */
  rescheduleAppointmentId?: string | null;
  /** Thin wrappers (passed as props — frontend never imports app actions). */
  getSlots: (input: {
    caseId: string;
    windowFromUtc: string;
    windowToUtc: string;
  }) => Promise<GetSlotsActionResult>;
  book: (input: {
    caseId: string;
    startsAtUtc: string;
    reminder1d: boolean;
    reminder1h: boolean;
    notes?: string | null;
  }) => Promise<BookAppointmentActionResult>;
  reschedule?: (input: {
    appointmentId: string;
    newStartsAtUtc: string;
    reminder1d?: boolean;
    reminder1h?: boolean;
  }) => Promise<RescheduleAppointmentActionResult>;
}

function dfLocale(locale: Locale) {
  return locale === "en" ? enUS : esLocale;
}

/** Local civil date key (YYYY-MM-DD) of a UTC instant in a given TZ. */
function dayKeyInTz(instant: Date, tz: string): string {
  return format(toZonedTime(instant, tz), "yyyy-MM-dd");
}

/** UTC window covering a whole local month (with 1-day padding both sides). */
function monthWindowUtc(year: number, month: number, tz: string): {
  fromUtc: string;
  toUtc: string;
} {
  const first = fromZonedTime(
    `${year}-${String(month + 1).padStart(2, "0")}-01T00:00:00`,
    tz,
  );
  const from = new Date(first.getTime() - 86_400_000);
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  const firstNext = fromZonedTime(
    `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-01T00:00:00`,
    tz,
  );
  const to = new Date(firstNext.getTime() + 86_400_000);
  return { fromUtc: from.toISOString(), toUtc: to.toISOString() };
}

export function AgendarScreen({
  caseId,
  clientTimezone,
  staffTimezone,
  initialSlots,
  sequenceNumber,
  appointmentCount,
  locale,
  labels,
  rescheduleAppointmentId,
  getSlots,
  book,
  reschedule,
}: AgendarScreenProps) {
  const router = useRouter();
  const isReschedule = Boolean(rescheduleAppointmentId && reschedule);

  // Current visible month (anchored on "now" in the client TZ).
  const nowZoned = React.useMemo(
    () => toZonedTime(new Date(), clientTimezone),
    [clientTimezone],
  );
  const [viewYear, setViewYear] = React.useState(nowZoned.getFullYear());
  const [viewMonth, setViewMonth] = React.useState(nowZoned.getMonth());

  const [slots, setSlots] = React.useState<SlotWire[]>(initialSlots);
  const [loadingSlots, setLoadingSlots] = React.useState(false);
  const [selectedDay, setSelectedDay] = React.useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = React.useState<string | null>(null);
  const [reminder1d, setReminder1d] = React.useState(true);
  const [reminder1h, setReminder1h] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [booking, setBooking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Which initial month did we already load? (avoid refetch on first paint)
  const loadedMonth = React.useRef(`${nowZoned.getFullYear()}-${nowZoned.getMonth()}`);

  // Map of available local-day → slots (in the client TZ).
  const slotsByDay = React.useMemo(() => {
    const m = new Map<string, SlotWire[]>();
    for (const s of slots) {
      const key = dayKeyInTz(new Date(s.startUtc), clientTimezone);
      const arr = m.get(key);
      if (arr) arr.push(s);
      else m.set(key, [s]);
    }
    return m;
  }, [slots, clientTimezone]);

  const monthLabel = React.useMemo(() => {
    const s = format(new Date(viewYear, viewMonth, 1), "LLLL yyyy", {
      locale: dfLocale(locale),
    });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }, [viewYear, viewMonth, locale]);

  // Refetch slots when the visible month changes.
  const goToMonth = React.useCallback(
    async (year: number, month: number) => {
      setViewYear(year);
      setViewMonth(month);
      setSelectedDay(null);
      setSelectedSlot(null);
      const key = `${year}-${month}`;
      if (key === loadedMonth.current) return;
      loadedMonth.current = key;
      setLoadingSlots(true);
      setError(null);
      const win = monthWindowUtc(year, month, clientTimezone);
      const res = await getSlots({
        caseId,
        windowFromUtc: win.fromUtc,
        windowToUtc: win.toUtc,
      });
      setLoadingSlots(false);
      if (res.ok && res.slots) setSlots(res.slots);
      else setSlots([]);
    },
    [caseId, clientTimezone, getSlots],
  );

  const prevMonth = () =>
    goToMonth(viewMonth === 0 ? viewYear - 1 : viewYear, viewMonth === 0 ? 11 : viewMonth - 1);
  const nextMonth = () =>
    goToMonth(viewMonth === 11 ? viewYear + 1 : viewYear, viewMonth === 11 ? 0 : viewMonth + 1);

  // Build the 6-week calendar grid (Sunday-first, matching "D L M M J V S").
  const grid = React.useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startWeekday = first.getDay(); // 0 = Sunday
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: Array<{ day: number; key: string } | null> = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ day: d, key });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewYear, viewMonth]);

  const daySlots = selectedDay ? (slotsByDay.get(selectedDay) ?? []) : [];

  const selectedDayLabel = React.useMemo(() => {
    if (!selectedDay) return "";
    const [y, m, d] = selectedDay.split("-").map(Number);
    return format(new Date(y, m - 1, d), locale === "en" ? "MMMM d" : "d 'de' MMMM", {
      locale: dfLocale(locale),
    });
  }, [selectedDay, locale]);

  const weekdayCells = labels.weekdays.split(" ");

  async function confirm() {
    if (!selectedSlot || booking) return;
    setBooking(true);
    setError(null);

    let res: BookAppointmentActionResult | RescheduleAppointmentActionResult;
    if (isReschedule && reschedule && rescheduleAppointmentId) {
      res = await reschedule({
        appointmentId: rescheduleAppointmentId,
        newStartsAtUtc: selectedSlot,
        reminder1d,
        reminder1h,
      });
    } else {
      res = await book({
        caseId,
        startsAtUtc: selectedSlot,
        reminder1d,
        reminder1h,
        notes: note.trim() ? note.trim() : null,
      });
    }

    if (res.ok && res.appointmentId) {
      const suffix = isReschedule ? "" : "?nueva=1";
      router.push(`/caso/${caseId}/cita/${res.appointmentId}${suffix}`);
      return;
    }
    setBooking(false);
    const code = res.error?.code;
    if (code === "OUTSIDE_WINDOW") {
      setError(labels.errWindow);
    } else if (code === "SLOT_TAKEN") {
      // Refetch the current month so the taken slot disappears.
      setError(labels.errSlotTaken);
      setSelectedSlot(null);
      const win = monthWindowUtc(viewYear, viewMonth, clientTimezone);
      const refetch = await getSlots({
        caseId,
        windowFromUtc: win.fromUtc,
        windowToUtc: win.toUtc,
      });
      if (refetch.ok && refetch.slots) setSlots(refetch.slots);
    } else if (code === "NO_APPOINTMENTS_LEFT") {
      setError(labels.errNoLeft);
    } else {
      setError(labels.errGeneric);
    }
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "54px 20px 124px",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      <ScreenHead
        title={labels.title}
        sub={labels.subtitle}
        lexMood="calma"
        onBack={() => router.push(`/caso/${caseId}/camino`)}
        backLabel={labels.back}
      />

      {/* Zona 2 — TZ banner */}
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
        <div style={{ fontSize: 14.5, color: "var(--navy)", fontWeight: 600, lineHeight: 1.4 }}>
          {renderEmphasis(labels.bannerTz.replace("{region}", labels.region), labels.region)}
        </div>
      </div>

      {/* Zona 3 — Calendar */}
      <div
        style={{
          background: "var(--card)",
          borderRadius: 24,
          padding: 16,
          boxShadow: "var(--shadow-soft)",
          marginBottom: 16,
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}
          role="group"
          aria-label={labels.monthAria}
        >
          <button
            type="button"
            onClick={prevMonth}
            aria-label={labels.prevMonth}
            style={navBtnStyle}
          >
            <Icon name="chevL" size={20} color="var(--navy)" />
          </button>
          <div className="t-title" style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)" }}>
            {monthLabel}
          </div>
          <button
            type="button"
            onClick={nextMonth}
            aria-label={labels.nextMonth}
            style={navBtnStyle}
          >
            <Icon name="chevR" size={20} color="var(--navy)" />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 6 }}>
          {weekdayCells.map((w, i) => (
            <div
              key={i}
              aria-hidden="true"
              style={{ textAlign: "center", fontSize: 12, fontWeight: 800, color: "var(--ink-3)" }}
            >
              {w}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {grid.map((cell, i) => {
            if (!cell) return <div key={i} aria-hidden="true" />;
            const has = slotsByDay.has(cell.key);
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
                    setError(null);
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
                    background: isSelected
                      ? "var(--accent)"
                      : has
                        ? "var(--blue-soft)"
                        : "transparent",
                    color: isSelected
                      ? "#fff"
                      : has
                        ? "var(--accent)"
                        : "var(--ink-3)",
                    opacity: has ? 1 : 0.4,
                    boxShadow: isSelected
                      ? "0 8px 18px color-mix(in srgb, var(--accent) 38%, transparent)"
                      : "none",
                  }}
                >
                  {cell.day}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Zona 4 — Slots */}
      <div className="t-title" style={{ fontSize: 17, fontWeight: 800, color: "var(--navy)", margin: "4px 2px 12px" }}>
        {selectedDay
          ? labels.slotsTitle.replace("{date}", selectedDayLabel)
          : labels.slotsTitle.replace("{date}", "…")}
      </div>

      {loadingSlots ? (
        <SlotsSkeleton label={labels.slotsLoading} />
      ) : !selectedDay ? (
        <HintCard text={labels.pickDayFirst} />
      ) : daySlots.length === 0 ? (
        <HintCard text={labels.noSlotsDay} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
          {daySlots.map((s) => {
            const dual = clientDualHour(s.startUtc, clientTimezone, staffTimezone, locale);
            const isSel = selectedSlot === s.startUtc;
            return (
              <button
                key={s.startUtc}
                type="button"
                aria-pressed={isSel}
                onClick={() => {
                  setSelectedSlot(s.startUtc);
                  setError(null);
                }}
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
                  boxShadow: isSel
                    ? "0 10px 22px color-mix(in srgb, var(--accent) 32%, transparent)"
                    : "var(--shadow-soft)",
                  transition: "transform 0.15s var(--ease), background 0.18s ease",
                }}
              >
                <span
                  className="t-title"
                  style={{ fontSize: 16, fontWeight: 800, color: isSel ? "#fff" : "var(--navy)" }}
                >
                  {dual.primary}
                </span>
                {dual.secondary && (
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: isSel ? "rgba(255,255,255,0.82)" : "var(--ink-3)",
                    }}
                  >
                    {dual.secondary}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Zona 5 — Reminders */}
      <div
        style={{
          background: "var(--card)",
          borderRadius: 20,
          padding: 16,
          boxShadow: "var(--shadow-soft)",
          marginBottom: 14,
        }}
      >
        <div className="t-title" style={{ fontSize: 15, fontWeight: 800, color: "var(--navy)", marginBottom: 12 }}>
          {labels.remindersTitle}
        </div>
        <CheckRow checked={reminder1d} onToggle={() => setReminder1d((v) => !v)} label={labels.reminder1d} />
        <div style={{ height: 10 }} />
        <CheckRow checked={reminder1h} onToggle={() => setReminder1h((v) => !v)} label={labels.reminder1h} />
      </div>

      {/* Optional note */}
      <div style={{ marginBottom: 14 }}>
        <label
          htmlFor="appt-note"
          className="t-title"
          style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--navy)", margin: "0 2px 8px" }}
        >
          {labels.noteLabel}
        </label>
        <textarea
          id="appt-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={labels.notePlaceholder}
          rows={3}
          style={{
            width: "100%",
            resize: "vertical",
            minHeight: 76,
            borderRadius: 16,
            border: "1.5px solid var(--line)",
            background: "var(--card)",
            padding: "12px 14px",
            fontFamily: "var(--font-body)",
            fontSize: 15,
            color: "var(--ink)",
            lineHeight: 1.45,
            outline: "none",
            boxShadow: "var(--shadow-soft)",
          }}
        />
      </div>

      {/* Sequence context (when several appointments in the phase) */}
      {appointmentCount > 1 && (
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-3)", margin: "0 2px 14px" }}>
          {labels.seqLabel
            .replace("{n}", String(sequenceNumber))
            .replace("{total}", String(appointmentCount))}
        </div>
      )}

      {/* Zona 6 — Amber penalty notice (always visible before confirm) */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 11,
          background: "var(--gold-soft)",
          borderRadius: 16,
          padding: "13px 15px",
          marginBottom: 18,
        }}
      >
        <Icon name="info" size={20} color="var(--gold-deep)" />
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--gold-deep)", lineHeight: 1.4 }}>
          {labels.penaltyNotice}
        </div>
      </div>

      {/* Mutation error (amber, non-culpabilising) */}
      {error && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            background: "var(--gold-soft)",
            borderRadius: 14,
            padding: "12px 14px",
            marginBottom: 14,
          }}
        >
          <Icon name="info" size={19} color="var(--gold-deep)" />
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--gold-deep)", lineHeight: 1.4 }}>
            {error}
          </div>
        </div>
      )}

      {/* Zona 7 — Dynamic CTA */}
      <GradientBtn icon="check" disabled={!selectedSlot || booking} onClick={confirm}>
        {booking
          ? labels.ctaBooking
          : !selectedSlot
            ? labels.ctaIdle
            : isReschedule
              ? labels.ctaReschedule
              : labels.ctaReady}
      </GradientBtn>
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 999,
  border: "none",
  background: "var(--blue-soft)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

function CheckRow({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          borderRadius: 9,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: checked ? "var(--green)" : "var(--card)",
          border: checked ? "none" : "2px solid var(--line)",
          transition: "background 0.18s ease, border 0.18s ease",
          boxShadow: checked
            ? "0 6px 14px color-mix(in srgb, var(--green) 30%, transparent)"
            : "none",
        }}
      >
        {checked && <Icon name="check" size={18} color="#fff" stroke={3} />}
      </span>
      <span style={{ fontSize: 15.5, fontWeight: 600, color: "var(--navy)" }}>{label}</span>
    </button>
  );
}

function HintCard({ text }: { text: string }) {
  return (
    <div
      style={{
        background: "var(--card)",
        borderRadius: 18,
        padding: "18px 16px",
        textAlign: "center",
        fontSize: 14.5,
        fontWeight: 600,
        color: "var(--ink-2)",
        boxShadow: "var(--shadow-soft)",
        marginBottom: 18,
      }}
    >
      {text}
    </div>
  );
}

function SlotsSkeleton({ label }: { label: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            aria-hidden="true"
            style={{
              height: 58,
              borderRadius: 16,
              background: "var(--card-alt)",
              animation: "shimmer 1.4s ease-in-out infinite",
            }}
          />
        ))}
      </div>
      <div role="status" aria-live="polite" style={{ marginTop: 10, textAlign: "center", fontSize: 13, color: "var(--ink-3)", fontWeight: 600 }}>
        {label}
      </div>
    </div>
  );
}

/** Bolds the {region} clause inside the TZ banner (the prototype emphasises it). */
function renderEmphasis(text: string, emphasis: string): React.ReactNode {
  const idx = text.indexOf(emphasis);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <strong style={{ fontWeight: 800 }}>{emphasis}</strong>
      {text.slice(idx + emphasis.length)}
    </>
  );
}
