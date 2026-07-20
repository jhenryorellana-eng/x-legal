"use client";

/**
 * Citas — calendar & scheduling (DOC-52 §3, RF-VAN-025..031, 036..038).
 *
 * CalendarGrid (week/day/list), events colored by type per DOC (video #2F6BFF
 * c1 / #8B5CF6 c2 / #1BB673 c3 / call amber), legend, filter Todas/Citas/
 * Llamadas, "Florida (ET)" chip. SidePanel detail (Reprogramar/Completada/
 * Cancelar/NoShow). Nueva cita modal (Cliente/Prospecto) with dual hours
 * computed via the datetime lib (formatInTimeZone — never fixed offsets).
 *
 * Positions are pre-resolved into grid coordinates by the RSC (TZ-aware).
 */

import * as React from "react";
import { fromZonedTime } from "date-fns-tz";
import { MSym } from "../shared/msym";
import { Chip } from "../shared/ui";
import { SidePanel, Modal, Switch } from "@/frontend/components/desktop";
import { getBridge } from "@/frontend/platform-bridge";
import { useToast } from "../shared/toast-bridge";
import type { CitaDetail, CitaEvent, NuevaCitaModalProps } from "./types";
import { NuevaCitaModal } from "./nueva-cita-modal";

export interface CalDay {
  weekdayLabel: string; // "LUN"
  dayNumber: number;
  isToday: boolean;
}

export interface CitasStrings {
  title: string;
  sub: string; // "Semana del …"
  newAppt: string;
  tzChip: string;
  day: string;
  week: string;
  list: string;
  legend: { c1: string; c2: string; c3: string; call: string };
  filterAll: string;
  filterAppts: string;
  filterCalls: string;
  emptyGrid: string;
  enterCall: string;
  reschedule: string;
  complete: string;
  cancel: string;
  noShow: string;
  objectiveTitle: string;
  completedToast: string;
  scheduledChip: string;
  completedChip: string;
  // Complete-with-objectives modal
  completeModalTitle: string;
  completeModalSub: string;
  achieved: string;
  notAchieved: string;
  completeNote: string;
  completeNotePh: string;
  confirmComplete: string;
  noObjectives: string;
  outcomeTitle: string;
  // Reschedule modal
  rescheduleModalTitle: string;
  rescheduleNewLabel: string;
  rescheduleConfirm: string;
  rescheduledToast: string;
  noVideoLink: string;
  // Client note + staff internal log + status pill
  clientNoteTitle: string;
  staffNotesTitle: string;
  noShowChip: string;
  // Cancel-with-reason modal
  cancelModalTitle: string;
  cancelModalSub: string;
  cancelReasonLabel: string;
  cancelReasonPh: string;
  cancelConfirm: string;
  cancelKeep: string;
  cancelledToast: string;
  // No-show modal
  noShowModalTitle: string;
  noShowModalSub: string;
  noShowConfirm: string;
  noShowToast: string;
  // Complete gating + error feedback (silent-failure fix)
  completeNotStartedWarn: string;
  errApptNotStarted: string;
  errApptInvalidTransition: string;
  errGeneric: string;
}

/** Maps a scheduling error code to a user-facing message (never fail silently). */
function apptErrorMsg(code: string | undefined, strings: CitasStrings): string {
  switch (code) {
    case "APPT_NOT_STARTED":
      return strings.errApptNotStarted;
    case "APPT_INVALID_TRANSITION":
      return strings.errApptInvalidTransition;
    default:
      return strings.errGeneric;
  }
}

export interface CitasViewProps {
  calDays: CalDay[];
  hours: string[]; // ["9:00","10:00",...]
  events: CitaEvent[]; // already positioned (dayIndex, slotIndex)
  listItems: CitaEvent[];
  staffTz: string;
  strings: CitasStrings;
  detailFor: (id: string) => CitaDetail | null;
  newApptModal: Omit<NuevaCitaModalProps, "open" | "onOpenChange">;
  onComplete: (input: {
    id: string;
    outcome: { id: string; text: string; achieved: boolean }[];
    notes: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  onReschedule: (input: {
    id: string;
    startsAtIso: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  onCancel: (input: { id: string; reason: string }) => Promise<{ ok: boolean; error?: { code: string } }>;
  onNoShow: (id: string) => Promise<{ ok: boolean; error?: { code: string } }>;
  presetLeadId?: string | null;
}

type ViewMode = "day" | "week" | "list";
type Filter = "all" | "appts" | "calls";

const KIND_CLASS: Record<string, string> = {
  c1: "evt-c1",
  c2: "evt-c2",
  c3: "evt-c3",
  call: "evt-call",
};

export function CitasView(props: CitasViewProps) {
  const { strings } = props;
  const toast = useToast();
  const [mode, setMode] = React.useState<ViewMode>("week");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);

  // Complete-with-objectives modal state.
  const [completeId, setCompleteId] = React.useState<string | null>(null);
  const [achievedMap, setAchievedMap] = React.useState<Record<string, boolean>>({});
  const [completeNote, setCompleteNote] = React.useState("");
  const [completeBusy, setCompleteBusy] = React.useState(false);

  // Reschedule modal state.
  const [rescheduleId, setRescheduleId] = React.useState<string | null>(null);
  const [rescheduleWhen, setRescheduleWhen] = React.useState(""); // datetime-local
  const [rescheduleBusy, setRescheduleBusy] = React.useState(false);

  // Cancel-with-reason modal state (destructive — reason required, DOC-53 §0.5).
  const [cancelId, setCancelId] = React.useState<string | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const [cancelBusy, setCancelBusy] = React.useState(false);

  // No-show confirmation modal state (applies the 7-day rebooking penalty).
  const [noShowId, setNoShowId] = React.useState<string | null>(null);
  const [noShowBusy, setNoShowBusy] = React.useState(false);

  const passesFilter = (e: CitaEvent) =>
    filter === "all" || (filter === "calls" ? e.kind === "call" : e.kind !== "call");

  const visibleEvents = props.events.filter(passesFilter);
  const visibleList = props.listItems.filter(passesFilter);
  const detail = openId ? props.detailFor(openId) : null;
  const completeDetail = completeId ? props.detailFor(completeId) : null;
  // Gate: the backend rejects completing a cita before it starts (APPT_NOT_STARTED,
  // DOC-43 §2.1). Reflect it in the UI so the action never fails silently.
  const canComplete =
    !completeDetail || new Date(completeDetail.startsAtIso).getTime() <= Date.now();
  const dayCount = mode === "day" ? 1 : props.calDays.length;

  const joinCall = (link: string | null) => {
    if (link) getBridge().share.openExternal(link);
  };

  // Open the completion modal pre-seeding every objective as achieved.
  const openComplete = (d: CitaDetail) => {
    setCompleteId(d.id);
    setAchievedMap(Object.fromEntries(d.objectives.map((o) => [o.id, true])));
    setCompleteNote("");
  };

  const submitComplete = async () => {
    if (!completeDetail || completeBusy) return;
    setCompleteBusy(true);
    try {
      const outcome = completeDetail.objectives.map((o) => ({
        id: o.id,
        text: o.text,
        achieved: achievedMap[o.id] ?? false,
      }));
      const res = await props.onComplete({ id: completeDetail.id, outcome, notes: completeNote.trim() });
      if (res.ok) {
        setCompleteId(null);
        setOpenId(null);
        toast.success(strings.completedToast);
      } else {
        toast.error(apptErrorMsg(res.error?.code, strings));
      }
    } finally {
      setCompleteBusy(false);
    }
  };

  const submitReschedule = async () => {
    if (!rescheduleId || !rescheduleWhen || rescheduleBusy) return;
    setRescheduleBusy(true);
    try {
      const startsAtIso = fromZonedTime(rescheduleWhen, props.staffTz).toISOString();
      const res = await props.onReschedule({ id: rescheduleId, startsAtIso });
      if (res.ok) {
        setRescheduleId(null);
        setOpenId(null);
        toast.success(strings.rescheduledToast);
      } else {
        toast.error(apptErrorMsg(res.error?.code, strings));
      }
    } finally {
      setRescheduleBusy(false);
    }
  };

  const submitCancel = async () => {
    if (!cancelId || !cancelReason.trim() || cancelBusy) return;
    setCancelBusy(true);
    try {
      const res = await props.onCancel({ id: cancelId, reason: cancelReason.trim() });
      if (res.ok) {
        setCancelId(null);
        setOpenId(null);
        toast.success(strings.cancelledToast);
      } else {
        toast.error(apptErrorMsg(res.error?.code, strings));
      }
    } finally {
      setCancelBusy(false);
    }
  };

  const submitNoShow = async () => {
    if (!noShowId || noShowBusy) return;
    setNoShowBusy(true);
    try {
      const res = await props.onNoShow(noShowId);
      if (res.ok) {
        setNoShowId(null);
        setOpenId(null);
        toast.success(strings.noShowToast);
      } else {
        toast.error(apptErrorMsg(res.error?.code, strings));
      }
    } finally {
      setNoShowBusy(false);
    }
  };

  return (
    <div className="fade-up">
      <div className="v-head">
        <div>
          <h1 className="v-title">{strings.title}</h1>
          <div className="v-sub">{strings.sub}</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="vbtn vbtn-primary vbtn-sm" onClick={() => setModalOpen(true)}>
            <MSym name="add" size={18} />
            {strings.newAppt}
          </button>
          <Chip tone="blue" icon="schedule">{strings.tzChip}</Chip>
          <div className="seg">
            <button type="button" className={mode === "day" ? "on" : ""} onClick={() => setMode("day")}>{strings.day}</button>
            <button type="button" className={mode === "week" ? "on" : ""} onClick={() => setMode("week")}>{strings.week}</button>
            <button type="button" className={mode === "list" ? "on" : ""} onClick={() => setMode("list")}>{strings.list}</button>
          </div>
        </div>
      </div>

      {/* legend + filter */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div className="legend">
          <span className="legend-item"><span className="legend-sw evt-c1" />{strings.legend.c1}</span>
          <span className="legend-item"><span className="legend-sw evt-c2" />{strings.legend.c2}</span>
          <span className="legend-item"><span className="legend-sw evt-c3" />{strings.legend.c3}</span>
          <span className="legend-item"><span className="legend-sw evt-call" />{strings.legend.call}</span>
        </div>
        <div className="seg">
          <button type="button" className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>{strings.filterAll}</button>
          <button type="button" className={filter === "appts" ? "on" : ""} onClick={() => setFilter("appts")}>{strings.filterAppts}</button>
          <button type="button" className={filter === "calls" ? "on" : ""} onClick={() => setFilter("calls")}>{strings.filterCalls}</button>
        </div>
      </div>

      {mode === "list" ? (
        <div className="vcard vcard-pad">
          {visibleList.length === 0 && <div className="kcol-empty" style={{ padding: "26px" }}>{strings.emptyGrid}</div>}
          {visibleList.map((e) => (
            <button
              key={e.id}
              type="button"
              className="attend-row"
              style={{ width: "100%", textAlign: "left" }}
              onClick={() => setOpenId(e.id)}
            >
              <div style={{ width: 70, flex: "none" }}>
                <div style={{ fontWeight: 900, fontSize: 13, color: "var(--ink)" }}>{e.dayLabel}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 800 }}>{e.time} {e.tzAbbr}</div>
              </div>
              <div className="attend-main">
                <div className="attend-name">{e.name}</div>
                <div className="attend-meta">{e.seqLabel}</div>
              </div>
              <Chip tone={e.done ? "green" : "blue"}>{e.done ? strings.completedChip : strings.scheduledChip}</Chip>
            </button>
          ))}
        </div>
      ) : (
        <div className="scroll-x">
          <div
            className="cal-grid"
            style={{ gridTemplateColumns: `64px repeat(${dayCount}, 1fr)`, minWidth: dayCount > 1 ? 720 : undefined }}
          >
            <div className="cal-corner" />
            {props.calDays.slice(0, dayCount).map((d, i) => (
              <div key={i} className={`cal-dayhead${d.isToday ? " today" : ""}`}>
                <div className="d">{d.weekdayLabel}</div>
                <div className="n">{d.dayNumber}</div>
              </div>
            ))}
            {props.hours.map((h, slot) => (
              <React.Fragment key={h}>
                <div className="cal-time">{h}</div>
                {props.calDays.slice(0, dayCount).map((d, dayIdx) => {
                  const ev = visibleEvents.find((e) => e.dayIndex === dayIdx && e.slotIndex === slot);
                  if (ev) {
                    return (
                      <div key={dayIdx} className="cal-cell">
                        <button
                          type="button"
                          className={`cal-evt ${KIND_CLASS[ev.kind]}${ev.done ? " evt-done" : ""}`}
                          style={{ top: 3, bottom: 3 }}
                          onClick={() => setOpenId(ev.id)}
                        >
                          {ev.name}
                          {ev.done ? " · ✓" : ""}
                          <small>{ev.seqLabel}</small>
                        </button>
                      </div>
                    );
                  }
                  return (
                    <button
                      key={dayIdx}
                      type="button"
                      className="cal-cell empty"
                      style={{ textAlign: "inherit" }}
                      aria-label={`${strings.newAppt}: ${d.weekdayLabel} ${d.dayNumber}, ${h}`}
                      onClick={() => setModalOpen(true)}
                    >
                      <span className="cell-add">
                        <MSym name="add" size={22} />
                      </span>
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Detail SidePanel */}
      <SidePanel
        open={detail !== null}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={detail?.name ?? ""}
        subtitle={detail ? `${detail.dayTime}${detail.clientHour ? ` · ${detail.clientHour}` : ""}` : ""}
        footer={
          detail && detail.status === "scheduled" ? (
            <>
              <button
                type="button"
                className="vbtn vbtn-ghost vbtn-sm"
                onClick={() => {
                  setRescheduleId(detail.id);
                  setRescheduleWhen("");
                }}
              >
                <MSym name="event_repeat" size={18} />
                {strings.reschedule}
              </button>
              <button type="button" className="vbtn vbtn-green vbtn-sm" onClick={() => openComplete(detail)}>
                <MSym name="check_circle" size={18} />
                {strings.complete}
              </button>
            </>
          ) : undefined
        }
      >
        {detail && (
          <>
            {/* Status + type — state first, read at a glance. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <Chip tone={detail.status === "completed" ? "green" : detail.status === "no_show" ? "red" : "blue"}>
                {detail.status === "completed"
                  ? strings.completedChip
                  : detail.status === "no_show"
                    ? strings.noShowChip
                    : strings.scheduledChip}
              </Chip>
              <Chip tone="neutral">{detail.typeLabel}</Chip>
            </div>

            {detail.isVideo && (
              <button
                type="button"
                className="vbtn vbtn-primary"
                style={{ width: "100%", marginBottom: 16, justifyContent: "center", opacity: detail.videoLink ? 1 : 0.5 }}
                disabled={!detail.videoLink}
                onClick={() => joinCall(detail.videoLink)}
              >
                <MSym name="videocam" size={20} />
                {detail.videoLink ? strings.enterCall : strings.noVideoLink}
              </button>
            )}

            {/* Client note — what the client wrote for their advisor at booking. */}
            {detail.clientNote && (
              <div
                className="vcard"
                style={{ padding: 14, background: "var(--accent-soft)", border: "none", marginBottom: 16 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
                  <MSym name="chat_bubble" size={17} color="var(--accent)" />
                  <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--accent)" }}>
                    {strings.clientNoteTitle}
                  </span>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.5, color: "var(--ink)", whiteSpace: "pre-wrap" }}>
                  {detail.clientNote}
                </div>
              </div>
            )}

            {/* Completed: show the recorded outcome (read-only). */}
            {detail.status === "completed" && detail.objectivesOutcome && detail.objectivesOutcome.length > 0 ? (
              <div style={{ borderTop: "1px solid var(--line-2, var(--line))", paddingTop: 14 }}>
                <div className="vcard-title" style={{ fontSize: 14, marginBottom: 10 }}>{strings.outcomeTitle}</div>
                {detail.objectivesOutcome.map((o) => (
                  <div key={o.id} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "7px 0", fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
                    <MSym
                      name={o.achieved ? "check_circle" : "cancel"}
                      size={18}
                      color={o.achieved ? "var(--green)" : "var(--ink-3)"}
                    />
                    {o.text}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ borderTop: "1px solid var(--line-2, var(--line))", paddingTop: 14 }}>
                <div className="vcard-title" style={{ fontSize: 14, marginBottom: 10 }}>{strings.objectiveTitle}</div>
                {detail.objectives.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 600 }}>{strings.noObjectives}</div>
                ) : (
                  detail.objectives.map((o) => (
                    <div key={o.id} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "7px 0", fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
                      <MSym name="radio_button_unchecked" size={18} color="var(--ink-3)" />
                      {o.text}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Staff internal log (bitácora) — secondary, only when present. */}
            {detail.notes && (
              <div style={{ borderTop: "1px solid var(--line-2, var(--line))", paddingTop: 14, marginTop: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
                  <MSym name="sticky_note_2" size={17} color="var(--ink-3)" />
                  <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                    {strings.staffNotesTitle}
                  </span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.5, color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>
                  {detail.notes}
                </div>
              </div>
            )}

            {/* Destructive actions — open a confirmation modal (never instant). */}
            {detail.status === "scheduled" && (
              <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
                <button type="button" className="flag-btn" onClick={() => { setCancelReason(""); setCancelId(detail.id); }}>
                  <MSym name="cancel" size={16} />
                  {strings.cancel}
                </button>
                <button type="button" className="flag-btn" onClick={() => setNoShowId(detail.id)}>
                  <MSym name="person_off" size={16} />
                  {strings.noShow}
                </button>
              </div>
            )}
          </>
        )}
      </SidePanel>

      {/* Complete-with-objectives modal */}
      <Modal
        open={completeId !== null}
        onOpenChange={(o) => !o && setCompleteId(null)}
        title={strings.completeModalTitle}
        width={460}
        footer={
          <>
            <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={() => setCompleteId(null)}>{strings.cancel}</button>
            <button type="button" className="vbtn vbtn-green vbtn-sm" disabled={completeBusy || !canComplete} onClick={submitComplete}>
              <MSym name="check_circle" size={18} />
              {strings.confirmComplete}
            </button>
          </>
        }
      >
        {completeDetail && (
          <>
            {!canComplete && (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "var(--gold-soft)",
                  border: "1px solid color-mix(in srgb, var(--gold-deep) 35%, transparent)",
                  marginBottom: 14,
                }}
              >
                <MSym name="schedule" size={18} color="var(--gold-deep)" />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--gold-deep)", lineHeight: 1.45 }}>
                    {strings.completeNotStartedWarn}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)", marginTop: 3 }}>
                    {completeDetail.dayTime}
                  </div>
                </div>
              </div>
            )}
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontWeight: 700, marginBottom: 14 }}>{strings.completeModalSub}</div>
            {completeDetail.objectives.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 600, marginBottom: 8 }}>{strings.noObjectives}</div>
            ) : (
              completeDetail.objectives.map((o) => (
                <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--line-2)" }}>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{o.text}</div>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: achievedMap[o.id] ? "var(--green)" : "var(--ink-3)" }}>
                    {achievedMap[o.id] ? strings.achieved : strings.notAchieved}
                  </span>
                  <Switch
                    checked={achievedMap[o.id] ?? false}
                    onCheckedChange={(v) => setAchievedMap((m) => ({ ...m, [o.id]: v }))}
                    aria-label={o.text}
                  />
                </div>
              ))
            )}
            <div className="vfield" style={{ marginTop: 14, marginBottom: 0 }}>
              <label htmlFor="complete-note">{strings.completeNote}</label>
              <textarea
                id="complete-note"
                rows={3}
                value={completeNote}
                onChange={(e) => setCompleteNote(e.target.value)}
                placeholder={strings.completeNotePh}
              />
            </div>
          </>
        )}
      </Modal>

      {/* Reschedule modal */}
      <Modal
        open={rescheduleId !== null}
        onOpenChange={(o) => !o && setRescheduleId(null)}
        title={strings.rescheduleModalTitle}
        width={420}
        footer={
          <>
            <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={() => setRescheduleId(null)}>{strings.cancel}</button>
            <button type="button" className="vbtn vbtn-primary vbtn-sm" disabled={!rescheduleWhen || rescheduleBusy} onClick={submitReschedule}>
              <MSym name="event_repeat" size={18} />
              {strings.rescheduleConfirm}
            </button>
          </>
        }
      >
        <div className="vfield" style={{ marginBottom: 0 }}>
          <label htmlFor="reschedule-when">{strings.rescheduleNewLabel}</label>
          <input
            id="reschedule-when"
            type="datetime-local"
            value={rescheduleWhen}
            onChange={(e) => setRescheduleWhen(e.target.value)}
          />
        </div>
      </Modal>

      {/* Cancel-with-reason modal (destructive — reason required, DOC-53 §0.5) */}
      <Modal
        open={cancelId !== null}
        onOpenChange={(o) => !o && setCancelId(null)}
        title={strings.cancelModalTitle}
        tone="var(--brand-red)"
        width={440}
        footer={
          <>
            <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={() => setCancelId(null)}>
              {strings.cancelKeep}
            </button>
            <button
              type="button"
              className="vbtn vbtn-sm"
              style={{
                background: "var(--brand-red)",
                color: "#fff",
                opacity: !cancelReason.trim() || cancelBusy ? 0.5 : 1,
              }}
              disabled={!cancelReason.trim() || cancelBusy}
              onClick={submitCancel}
            >
              <MSym name="cancel" size={18} />
              {strings.cancelConfirm}
            </button>
          </>
        }
      >
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontWeight: 700, marginBottom: 14, lineHeight: 1.5 }}>
          {strings.cancelModalSub}
        </div>
        <div className="vfield" style={{ marginBottom: 0 }}>
          <label htmlFor="cancel-reason">{strings.cancelReasonLabel}</label>
          <textarea
            id="cancel-reason"
            rows={3}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder={strings.cancelReasonPh}
          />
        </div>
      </Modal>

      {/* No-show confirmation modal (applies the 7-day rebooking penalty) */}
      <Modal
        open={noShowId !== null}
        onOpenChange={(o) => !o && setNoShowId(null)}
        title={strings.noShowModalTitle}
        tone="var(--brand-red)"
        width={440}
        footer={
          <>
            <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={() => setNoShowId(null)}>
              {strings.cancelKeep}
            </button>
            <button
              type="button"
              className="vbtn vbtn-sm"
              style={{ background: "var(--brand-red)", color: "#fff", opacity: noShowBusy ? 0.5 : 1 }}
              disabled={noShowBusy}
              onClick={submitNoShow}
            >
              <MSym name="person_off" size={18} />
              {strings.noShowConfirm}
            </button>
          </>
        }
      >
        <div style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 600, lineHeight: 1.5 }}>
          {strings.noShowModalSub}
        </div>
      </Modal>

      <NuevaCitaModal open={modalOpen} onOpenChange={setModalOpen} {...props.newApptModal} />
    </div>
  );
}
