"use client";

/**
 * Mi disponibilidad (DOC-52 §4, RF-VAN-032..035).
 *
 * Weekly recurrence grid (rules per weekday in local time + rule TZ), range
 * CRUD via a minimal modal (end>start, no overlap), settings (duration / min
 * notice / no-show penalty / reminders), exceptions with "affects N appts"
 * notice, and "lift rebooking block" button when a client is blocked.
 * Saving the weekly schedule is transactional → saveAvailabilityRules.
 */

import * as React from "react";
import { fromZonedTime } from "date-fns-tz";
import { addCalendarDays } from "@/shared/business-days";
import { MSym } from "../shared/msym";
import { Chip } from "../shared/ui";
import { Switch, Modal } from "@/frontend/components/desktop";
import { LexBubble } from "../shared/lex";
import { useToast } from "../shared/toast-bridge";

export interface DayRule {
  weekday: number; // 0=Sun..6=Sat (display order Mon..Sun)
  dayName: string;
  active: boolean;
  ranges: { start: string; end: string }[]; // "09:00"
}

export interface ExceptionVM {
  id: string;
  label: string;
  rangeLabel: string;
  affectedCount: number;
}

export interface DisponibilidadStrings {
  title: string;
  sub: string;
  tzChip: string;
  lexTipHtml: string;
  weeklyTitle: string;
  notAvailable: string;
  range: string;
  rulesTitle: string;
  duration: string;
  minNotice: string;
  videoLink: string;
  videoLinkPh: string;
  remindersTitle: string;
  autoReminders: string;
  autoRemindersSub: string;
  noShowNotice: string; // contains {days}
  blocksTitle: string;
  addBlock: string;
  save: string;
  saved: string;
  rangeModalTitle: string;
  startLabel: string;
  endLabel: string;
  crossMidnight: string;
  cancel: string;
  add: string;
  blockModalTitle: string;
  blockLabelField: string;
  blockReason: string;
  blockFromLabel: string;
  blockToLabel: string;
  blockAllDay: string;
  blockInvalidRange: string;
  blockAffectsConfirm: string; // contains {n}
  affectsNotice: string; // contains {n}
  liftBlock: string;
  liftBlockDone: string;
  invalidRange: string;
  lexEnabled: boolean;
}

export interface DisponibilidadActions {
  saveRules: (input: {
    rules: { weekday: number; startLocal: string; endLocal: string }[];
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  addException: (input: {
    label: string;
    fromIso: string;
    toIso: string;
    acknowledgeAffected?: boolean;
  }) => Promise<{ ok: boolean; affected?: number; error?: { code: string } }>;
  removeException: (input: { exceptionId: string }) => Promise<{ ok: boolean }>;
  updateSettings: (input: {
    defaultDurationMinutes: number;
    minNoticeHours: number;
    remindersEnabled: boolean;
    videoLink?: string | null;
  }) => Promise<{ ok: boolean }>;
  liftRebookingBlock: (input: { clientId: string }) => Promise<{ ok: boolean }>;
}

export interface DisponibilidadViewProps {
  days: DayRule[];
  exceptions: ExceptionVM[];
  defaultDuration: number;
  minNotice: number;
  remindersEnabled: boolean;
  noShowPenaltyDays: number;
  videoLink: string;
  /** Staff IANA timezone — block datetime-local inputs are interpreted in it. */
  staffTz: string;
  /**
   * Office IANA timezone (org canonical). All-day "holiday" blocks are anchored to
   * THIS zone, not the viewer's, so their 00:00→24:00 range aligns to the office
   * civil day the Calificación calculator reads (listOrgNonWorkingDays).
   */
  officeTz: string;
  blockedClient: { id: string; name: string } | null;
  strings: DisponibilidadStrings;
  actions: DisponibilidadActions;
}

export function DisponibilidadView(props: DisponibilidadViewProps) {
  const { strings, actions } = props;
  const toast = useToast();
  const [days, setDays] = React.useState(props.days);
  const [dur, setDur] = React.useState(props.defaultDuration);
  const [notice, setNotice] = React.useState(props.minNotice);
  const [reminders, setReminders] = React.useState(props.remindersEnabled);
  const [videoLink, setVideoLink] = React.useState(props.videoLink);
  const [rangeFor, setRangeFor] = React.useState<number | null>(null);
  const [rStart, setRStart] = React.useState("09:00");
  const [rEnd, setREnd] = React.useState("12:00");
  const [blockOpen, setBlockOpen] = React.useState(false);
  const [blockLabel, setBlockLabel] = React.useState("");
  const [blockFrom, setBlockFrom] = React.useState(""); // datetime-local "YYYY-MM-DDTHH:mm"
  const [blockTo, setBlockTo] = React.useState("");
  // All-day block = a holiday / office closure (00:00 → next 00:00). These are the
  // blocks the Calificación calculator treats as non-working days (a partial block,
  // e.g. a meeting, does not close the whole day).
  const [blockAllDay, setBlockAllDay] = React.useState(false);
  const [blockBusy, setBlockBusy] = React.useState(false);
  const [blockAffected, setBlockAffected] = React.useState<number | null>(null);
  const [blocked, setBlocked] = React.useState(props.blockedClient);

  const toggleDay = (i: number) =>
    setDays((ds) => ds.map((d, j) => (j === i ? { ...d, active: !d.active } : d)));
  const removeRange = (i: number, k: number) =>
    setDays((ds) =>
      ds.map((d, j) => (j === i ? { ...d, ranges: d.ranges.filter((_, x) => x !== k) } : d)),
    );

  /** Toggle "all day": full civil-day range (00:00 → next 00:00) vs working day. */
  function toggleBlockAllDay(on: boolean) {
    setBlockAllDay(on);
    setBlockAffected(null);
    const ymd = (blockFrom || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (on) {
      setBlockFrom(`${ymd}T00:00`);
      setBlockTo(`${addCalendarDays(ymd, 1)}T00:00`);
    } else {
      setBlockFrom(`${ymd}T09:00`);
      setBlockTo(`${ymd}T18:00`);
    }
  }
  /** All-day date picker → full civil-day range. */
  function setBlockAllDayDate(d: string) {
    setBlockAffected(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    setBlockFrom(`${d}T00:00`);
    setBlockTo(`${addCalendarDays(d, 1)}T00:00`);
  }

  const addRange = () => {
    if (rangeFor === null) return;
    if (rStart >= rEnd) {
      // cross-midnight allowed only when end <= start by spec; here keep simple: end>start
      toast.error(strings.invalidRange);
      return;
    }
    setDays((ds) =>
      ds.map((d, j) =>
        j === rangeFor ? { ...d, ranges: [...d.ranges, { start: rStart, end: rEnd }] } : d,
      ),
    );
    setRangeFor(null);
  };

  const save = async () => {
    const rules = days
      .filter((d) => d.active)
      .flatMap((d) => d.ranges.map((r) => ({ weekday: d.weekday, startLocal: r.start, endLocal: r.end })));
    const res = await actions.saveRules({ rules });
    await actions.updateSettings({
      defaultDurationMinutes: dur,
      minNoticeHours: notice,
      remindersEnabled: reminders,
      videoLink: videoLink.trim() || null,
    });
    if (res.ok) toast.success(strings.saved);
  };

  const lift = async () => {
    if (!blocked) return;
    const res = await actions.liftRebookingBlock({ clientId: blocked.id });
    if (res.ok) {
      setBlocked(null);
      toast.success(strings.liftBlockDone);
    }
  };

  // Block range is valid when both ends are set and end > start.
  const blockRangeValid = Boolean(blockFrom && blockTo && blockFrom < blockTo);

  const submitBlock = async (acknowledgeAffected: boolean) => {
    if (!blockRangeValid || !blockLabel.trim() || blockBusy) return;
    setBlockBusy(true);
    try {
      // The datetime-local values are wall-times; convert to UTC for storage
      // (availability_exceptions is UTC — DOC-23 §6.1). All-day "holiday" blocks
      // anchor to the OFFICE zone so their civil-day boundaries match what the
      // Calificación calculator reads; partial blocks stay in the viewer's zone.
      const tz = blockAllDay ? props.officeTz : props.staffTz;
      const fromIso = fromZonedTime(blockFrom, tz).toISOString();
      const toIso = fromZonedTime(blockTo, tz).toISOString();
      const res = await actions.addException({
        label: blockLabel.trim(),
        fromIso,
        toIso,
        acknowledgeAffected,
      });
      if (res.ok) {
        setBlockOpen(false);
        setBlockAffected(null);
        toast.success(strings.addBlock);
        return;
      }
      // Block overlaps existing citas → surface an in-modal confirmation; the
      // primary button then re-submits with acknowledgeAffected=true.
      if (res.error?.code === "EXCEPTION_AFFECTS_APPOINTMENTS") {
        setBlockAffected(res.affected ?? 0);
        return;
      }
      toast.error(strings.blockInvalidRange);
    } finally {
      setBlockBusy(false);
    }
  };

  const fmtRange = (r: { start: string; end: string }) => `${r.start}–${r.end}`;

  return (
    <div className="fade-up">
      <div className="v-head">
        <div>
          <h1 className="v-title">{strings.title}</h1>
          <div className="v-sub">{strings.sub}</div>
        </div>
        <Chip tone="blue" icon="schedule">{strings.tzChip}</Chip>
      </div>

      <LexBubble dismissKey="disp-tip" orb={30} enabled={strings.lexEnabled} html={strings.lexTipHtml} />

      {blocked && (
        <div className="info-note" style={{ marginBottom: 16, justifyContent: "space-between" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
            <MSym name="block" size={18} />
            {blocked.name}
          </span>
          <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={lift}>
            <MSym name="lock_open" size={16} />
            {strings.liftBlock}
          </button>
        </div>
      )}

      <div className="grid2" style={{ alignItems: "start" }}>
        {/* Weekly schedule */}
        <div className="vcard vcard-pad">
          <div className="vcard-title" style={{ marginBottom: 8 }}>
            <MSym name="date_range" size={20} />
            {strings.weeklyTitle}
          </div>
          {days.map((d, i) => (
            <div className="day-row" key={d.weekday}>
              <div className="day-name">
                <Switch checked={d.active} onCheckedChange={() => toggleDay(i)} aria-label={d.dayName} />
                {d.dayName}
              </div>
              {d.active ? (
                <div className="ranges">
                  {d.ranges.map((r, k) => (
                    <span className="range-pill" key={k}>
                      {fmtRange(r)}
                      <button type="button" onClick={() => removeRange(i, k)} aria-label="Quitar rango">
                        <MSym name="close" size={15} />
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    className="range-add"
                    onClick={() => {
                      setRangeFor(i);
                      setRStart("09:00");
                      setREnd("12:00");
                    }}
                  >
                    <MSym name="add" size={16} />
                    {strings.range}
                  </button>
                </div>
              ) : (
                <span className="day-off">{strings.notAvailable}</span>
              )}
            </div>
          ))}
        </div>

        {/* Settings */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="vcard vcard-pad">
            <div className="vcard-title" style={{ marginBottom: 16 }}>
              <MSym name="tune" size={20} />
              {strings.rulesTitle}
            </div>
            <div className="vfield" style={{ marginBottom: 16 }}>
              <label>{strings.duration}</label>
              <div className="seg" style={{ display: "flex" }}>
                {[30, 45, 60].map((v) => (
                  <button key={v} type="button" className={dur === v ? "on" : ""} style={{ flex: 1 }} onClick={() => setDur(v)}>
                    {v} min
                  </button>
                ))}
              </div>
            </div>
            <div className="vfield" style={{ marginBottom: 16 }}>
              <label htmlFor="min-notice">{strings.minNotice}</label>
              <select id="min-notice" value={notice} onChange={(e) => setNotice(Number(e.target.value))}>
                <option value={12}>12 h</option>
                <option value={24}>24 h</option>
                <option value={48}>48 h</option>
              </select>
            </div>
            <div className="vfield" style={{ marginBottom: 0 }}>
              <label htmlFor="video-link">{strings.videoLink}</label>
              <input
                id="video-link"
                value={videoLink}
                onChange={(e) => setVideoLink(e.target.value)}
                placeholder={strings.videoLinkPh}
                inputMode="url"
              />
            </div>
          </div>

          <div className="vcard vcard-pad">
            <div className="vcard-title" style={{ marginBottom: 14 }}>
              <MSym name="notifications_active" size={20} />
              {strings.remindersTitle}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 14, borderBottom: "1px solid var(--line-2)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5, color: "var(--ink)" }}>{strings.autoReminders}</div>
                <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 700 }}>{strings.autoRemindersSub}</div>
              </div>
              <Switch checked={reminders} onCheckedChange={setReminders} aria-label={strings.autoReminders} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingTop: 14 }}>
              <MSym name="info" size={20} color="#F59E0B" />
              <div
                style={{ fontSize: 12.5, color: "var(--ink-2)", fontWeight: 700, lineHeight: 1.45 }}
                dangerouslySetInnerHTML={{
                  __html: strings.noShowNotice.replace("{days}", `<b style="color:var(--ink)">${props.noShowPenaltyDays}</b>`),
                }}
              />
            </div>
          </div>

          <div className="vcard vcard-pad">
            <div className="vcard-title" style={{ marginBottom: 12 }}>
              <MSym name="event_busy" size={20} />
              {strings.blocksTitle}
            </div>
            {props.exceptions.map((ex) => (
              <div
                key={ex.id}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: 12, background: "var(--panel-2)", border: "1px solid var(--line)", marginBottom: 8 }}
              >
                <Chip tone="amber">{ex.label}</Chip>
                <span style={{ fontWeight: 800, fontSize: 13.5, color: "var(--ink)" }}>{ex.rangeLabel}</span>
                <button type="button" className="kcol-menu" style={{ marginLeft: "auto" }} onClick={() => actions.removeException({ exceptionId: ex.id })} aria-label="Opciones del bloqueo">
                  <MSym name="more_horiz" size={18} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="range-add"
              style={{ marginTop: 4, width: "100%", justifyContent: "center", height: 40 }}
              onClick={() => {
                // Seed with today's date (staff-local), a full working day.
                const today = new Date();
                const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
                setBlockOpen(true);
                setBlockLabel("");
                setBlockAllDay(false);
                setBlockFrom(`${ymd}T09:00`);
                setBlockTo(`${ymd}T18:00`);
                setBlockAffected(null);
              }}
            >
              <MSym name="add" size={17} />
              {strings.addBlock}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
        <button type="button" className="vbtn vbtn-primary" onClick={save}>
          <MSym name="check" size={20} />
          {strings.save}
        </button>
      </div>

      {/* Range modal */}
      <Modal
        open={rangeFor !== null}
        onOpenChange={(o) => !o && setRangeFor(null)}
        title={strings.rangeModalTitle}
        width={420}
        footer={
          <>
            <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={() => setRangeFor(null)}>{strings.cancel}</button>
            <button type="button" className="vbtn vbtn-primary vbtn-sm" onClick={addRange}>
              <MSym name="check" size={18} />
              {strings.add}
            </button>
          </>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="vfield" style={{ marginBottom: 0 }}>
            <label htmlFor="r-start">{strings.startLabel}</label>
            <input id="r-start" type="time" value={rStart} onChange={(e) => setRStart(e.target.value)} />
          </div>
          <div className="vfield" style={{ marginBottom: 0 }}>
            <label htmlFor="r-end">{strings.endLabel}</label>
            <input id="r-end" type="time" value={rEnd} onChange={(e) => setREnd(e.target.value)} />
          </div>
        </div>
        {rEnd <= rStart && (
          <div className="dup-warn" style={{ marginTop: 12 }}>
            <MSym name="info" size={16} />
            {strings.crossMidnight}
          </div>
        )}
      </Modal>

      {/* Block modal */}
      <Modal
        open={blockOpen}
        onOpenChange={setBlockOpen}
        title={strings.blockModalTitle}
        width={460}
        footer={
          <>
            <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={() => setBlockOpen(false)}>{strings.cancel}</button>
            <button
              type="button"
              className="vbtn vbtn-primary vbtn-sm"
              disabled={!blockLabel.trim() || !blockRangeValid || blockBusy}
              onClick={() => submitBlock(blockAffected !== null)}
            >
              <MSym name="check" size={18} />
              {strings.add}
            </button>
          </>
        }
      >
        <div className="vfield" style={{ marginBottom: 14 }}>
          <label htmlFor="block-label">{strings.blockLabelField}</label>
          <input
            id="block-label"
            value={blockLabel}
            onChange={(e) => { setBlockLabel(e.target.value); setBlockAffected(null); }}
            placeholder={strings.blockReason}
          />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={blockAllDay} onChange={(e) => toggleBlockAllDay(e.target.checked)} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{strings.blockAllDay}</span>
        </label>
        {blockAllDay ? (
          <div className="vfield" style={{ marginBottom: 0 }}>
            <label htmlFor="block-day">{strings.blockFromLabel}</label>
            <input
              id="block-day"
              type="date"
              value={blockFrom.slice(0, 10)}
              onChange={(e) => setBlockAllDayDate(e.target.value)}
            />
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="vfield" style={{ marginBottom: 0 }}>
              <label htmlFor="block-from">{strings.blockFromLabel}</label>
              <input
                id="block-from"
                type="datetime-local"
                value={blockFrom}
                onChange={(e) => { setBlockFrom(e.target.value); setBlockAffected(null); }}
              />
            </div>
            <div className="vfield" style={{ marginBottom: 0 }}>
              <label htmlFor="block-to">{strings.blockToLabel}</label>
              <input
                id="block-to"
                type="datetime-local"
                value={blockTo}
                onChange={(e) => { setBlockTo(e.target.value); setBlockAffected(null); }}
              />
            </div>
          </div>
        )}
        {blockFrom && blockTo && !blockRangeValid && (
          <div className="dup-warn" style={{ marginTop: 12 }}>
            <MSym name="info" size={16} />
            {strings.blockInvalidRange}
          </div>
        )}
        {blockAffected !== null && (
          <div className="dup-warn" style={{ marginTop: 12 }}>
            <MSym name="info" size={16} />
            {strings.blockAffectsConfirm.replace("{n}", String(blockAffected))}
          </div>
        )}
      </Modal>
    </div>
  );
}
