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
import { MSym } from "../shared/msym";
import { Chip } from "../shared/ui";
import { SidePanel } from "@/frontend/components/desktop";
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
}

export interface CitasViewProps {
  calDays: CalDay[];
  hours: string[]; // ["9:00","10:00",...]
  events: CitaEvent[]; // already positioned (dayIndex, slotIndex)
  listItems: CitaEvent[];
  strings: CitasStrings;
  detailFor: (id: string) => CitaDetail | null;
  newApptModal: Omit<NuevaCitaModalProps, "open" | "onOpenChange">;
  onComplete: (id: string) => Promise<{ ok: boolean }>;
  onReschedule: (id: string) => void;
  onCancel: (id: string) => Promise<{ ok: boolean }>;
  onNoShow: (id: string) => Promise<{ ok: boolean }>;
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

  const passesFilter = (e: CitaEvent) =>
    filter === "all" || (filter === "calls" ? e.kind === "call" : e.kind !== "call");

  const visibleEvents = props.events.filter(passesFilter);
  const visibleList = props.listItems.filter(passesFilter);
  const detail = openId ? props.detailFor(openId) : null;
  const dayCount = mode === "day" ? 1 : props.calDays.length;

  const complete = async (id: string) => {
    const res = await props.onComplete(id);
    if (res.ok) {
      setOpenId(null);
      toast.success(strings.completedToast);
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
        <div className="cal-grid" style={{ gridTemplateColumns: `64px repeat(${dayCount}, 1fr)` }}>
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
              {props.calDays.slice(0, dayCount).map((_, dayIdx) => {
                const ev = visibleEvents.find((e) => e.dayIndex === dayIdx && e.slotIndex === slot);
                return (
                  <div key={dayIdx} className={`cal-cell${ev ? "" : " empty"}`} onClick={ev ? undefined : () => setModalOpen(true)}>
                    {!ev && (
                      <span className="cell-add">
                        <MSym name="add" size={22} />
                      </span>
                    )}
                    {ev && (
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
                    )}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Detail SidePanel */}
      <SidePanel
        open={detail !== null}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={detail?.name ?? ""}
        subtitle={detail ? `${detail.dayTime}${detail.clientHour ? ` · ${detail.clientHour}` : ""}` : ""}
        footer={
          detail && (
            <>
              <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={() => detail && props.onReschedule(detail.id)}>
                <MSym name="event_repeat" size={18} />
                {strings.reschedule}
              </button>
              <button type="button" className="vbtn vbtn-green vbtn-sm" onClick={() => detail && complete(detail.id)}>
                <MSym name="check_circle" size={18} />
                {strings.complete}
              </button>
            </>
          )
        }
      >
        {detail && (
          <>
            <Chip tone="blue" style={{ marginBottom: 14 }}>{detail.typeLabel}</Chip>
            {detail.isVideo && (
              <button type="button" className="vbtn vbtn-primary" style={{ width: "100%", marginBottom: 16, justifyContent: "center" }}
                onClick={() => toast.success(`${strings.enterCall} · ${detail.name}`)}>
                <MSym name="videocam" size={20} />
                {strings.enterCall}
              </button>
            )}
            <div className="vcard" style={{ padding: 14, background: "var(--accent-soft)", border: "none", marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }} dangerouslySetInnerHTML={{ __html: detail.lexHtml }} />
            </div>
            <div className="vcard-title" style={{ fontSize: 14, marginBottom: 10 }}>{strings.objectiveTitle}</div>
            {detail.objectiveItems.map((it, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "7px 0", fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
                <MSym name="radio_button_unchecked" size={18} color="var(--ink-3)" />
                {it}
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              <button type="button" className="flag-btn" onClick={async () => { const r = await props.onCancel(detail.id); if (r.ok) setOpenId(null); }}>
                <MSym name="cancel" size={16} />
                {strings.cancel}
              </button>
              <button type="button" className="flag-btn" onClick={async () => { const r = await props.onNoShow(detail.id); if (r.ok) setOpenId(null); }}>
                <MSym name="person_off" size={16} />
                {strings.noShow}
              </button>
            </div>
          </>
        )}
      </SidePanel>

      <NuevaCitaModal open={modalOpen} onOpenChange={setModalOpen} {...props.newApptModal} presetLeadId={props.presetLeadId} />
    </div>
  );
}
