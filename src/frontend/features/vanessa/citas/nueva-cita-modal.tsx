"use client";

/**
 * Nueva cita modal (DOC-52 §3.6, RF-VAN-028..030) — Cliente / Prospecto.
 *
 * Dual hours ("2:00 PM · 12:00 PM en Utah") are computed REAL via the datetime
 * lib (formatInTimeZone over the chosen UTC instant) — never fixed offsets.
 * Non-blocking warnings (overlap / outside availability) flip the primary CTA to
 * "Crear igualmente" (force=true). Submit → bookAppointment / createProspect.
 */

import * as React from "react";
import { MSym } from "../shared/msym";
import { Chip, sourceMeta } from "../shared/ui";
import { useToast } from "../shared/toast-bridge";
import { Modal } from "@/frontend/components/desktop";
import { fmtTime, fmtTimeZoned } from "@/frontend/lib/datetime";
import type {
  NuevaCitaModalProps,
  ApptKind,
  ClientSearchResult,
} from "./types";

export function NuevaCitaModal({
  open,
  onOpenChange,
  staffTz,
  slots,
  daysOptions,
  clientResults,
  prospectResults,
  apptTypeOptions,
  prospectDuration,
  strings,
  actions,
}: NuevaCitaModalProps) {
  const toast = useToast();
  const [mode, setMode] = React.useState<"client" | "prospect">("client");
  const [query, setQuery] = React.useState("");
  const [chosenCase, setChosenCase] = React.useState<ClientSearchResult | null>(null);
  const [chosenLead, setChosenLead] = React.useState<string | null>(null);
  const [apptType, setApptType] = React.useState<ApptKind>(apptTypeOptions[0]?.value ?? "c1");
  const [day, setDay] = React.useState(daysOptions[0]?.value ?? "");
  const [slot, setSlot] = React.useState(slots[0] ?? "");
  const [duration, setDuration] = React.useState(prospectDuration ?? 45);
  const [modality, setModality] = React.useState<"video" | "phone">("video");
  const [r1d, setR1d] = React.useState(true);
  const [r1h, setR1h] = React.useState(true);
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // Non-blocking warnings are surfaced by the server attempt; for the prefilled
  // case we keep a simple local heuristic placeholder (always false here — the
  // real overlap is enforced by the DB EXCLUDE and reported on submit).
  const [warning, setWarning] = React.useState<null | "overlap" | "outside">(null);

  const filteredClients = clientResults.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.phone.includes(query) ||
      c.serviceLabel.toLowerCase().includes(query.toLowerCase()),
  );
  const filteredProspects = prospectResults.filter(
    (p) =>
      (p.name ?? p.phone).toLowerCase().includes(query.toLowerCase()) ||
      p.phone.includes(query),
  );

  // Dual hour from the chosen UTC slot.
  const dual = React.useMemo(() => {
    if (!slot) return null;
    const staffHour = fmtTimeZoned(slot, staffTz);
    const clientTz = chosenCase?.clientTz ?? null;
    if (!clientTz || clientTz === staffTz) return { staffHour, clientHour: null };
    const clientHour = fmtTime(slot, clientTz);
    return { staffHour, clientHour };
  }, [slot, staffTz, chosenCase]);

  const canSubmit =
    mode === "client" ? chosenCase !== null && !!slot : chosenLead !== null && !!slot;

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    if (mode === "client" && chosenCase) {
      const res = await actions.bookAppointment({
        caseId: chosenCase.caseId,
        apptType,
        startsAtIso: slot,
        durationMinutes: duration,
        modality,
        reminder1d: r1d,
        reminder1h: r1h,
        note,
        force: warning !== null,
      });
      setSubmitting(false);
      if (res.ok) {
        onOpenChange(false);
        toast.success(
          strings.createdClient
            .replace("{name}", chosenCase.name)
            .replace("{type}", apptTypeOptions.find((t) => t.value === apptType)?.label ?? ""),
        );
      } else if (res.error?.code === "SLOT_CONFLICT" || res.error?.code === "SLOT_TAKEN") {
        setWarning("overlap");
      } else if (res.error?.code === "OUTSIDE_AVAILABILITY" || res.error?.code === "OUTSIDE_WINDOW") {
        setWarning("outside");
      }
    } else if (mode === "prospect" && chosenLead) {
      const res = await actions.createProspectAppointment({
        leadId: chosenLead,
        startsAtIso: slot,
        durationMinutes: duration,
        modality,
        note,
      });
      setSubmitting(false);
      if (res.ok) {
        onOpenChange(false);
        const lead = prospectResults.find((p) => p.leadId === chosenLead);
        toast.success(strings.createdProspect.replace("{name}", lead?.name ?? lead?.phone ?? ""));
      }
    } else {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={strings.title}
      description={strings.sub}
      width={540}
      footer={
        <>
          <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={() => onOpenChange(false)}>
            {strings.cancel}
          </button>
          <button type="button" className="vbtn vbtn-primary vbtn-sm" disabled={!canSubmit || submitting} onClick={submit}>
            <MSym name="check" size={18} />
            {warning ? strings.createAnyway : strings.create}
          </button>
        </>
      }
    >
      <div style={{ marginBottom: 14 }}>
        <Chip tone="blue" icon="schedule">{strings.tzChip}</Chip>
      </div>

      {/* Mode segmented */}
      <div className="seg" style={{ display: "flex", width: "100%", marginBottom: 6 }}>
        <button type="button" className={mode === "client" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("client")}>
          <MSym name="workspace_premium" size={17} />
          {strings.modeClient}
        </button>
        <button type="button" className={mode === "prospect" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("prospect")}>
          <MSym name="person_search" size={17} />
          {strings.modeProspect}
        </button>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 700, marginBottom: 16 }}>
        {mode === "client" ? strings.clientHint : strings.prospectHint}
      </div>

      {/* Search */}
      {mode === "client" ? (
        <>
          {!chosenCase ? (
            <div className="vfield">
              <label htmlFor="cita-search">{strings.searchClient}</label>
              <input id="cita-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={strings.searchClientPh} autoFocus />
              <div style={{ marginTop: 8 }}>
                {filteredClients.length === 0 && (
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700, padding: "8px 2px" }}>{strings.emptyClients}</div>
                )}
                {filteredClients.map((c) => (
                  <button key={c.caseId} type="button" className="pick-row" onClick={() => setChosenCase(c)}>
                    <div className="pick-av">{c.name.slice(0, 2).toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 13.5, color: "var(--ink)" }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 700 }}>
                        <span style={{ color: "var(--accent)" }}>{c.serviceLabel}</span> · {c.seqLabel} · {c.phone}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="pick-row sel" style={{ cursor: "default" }}>
              <div className="pick-av" style={{ width: 44, height: 44 }}>{chosenCase.name.slice(0, 2).toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: 15, color: "var(--ink)" }}>{chosenCase.name}</div>
                <Chip tone="blue" style={{ marginTop: 4 }}>{chosenCase.seqLabel}</Chip>
              </div>
              <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={() => setChosenCase(null)}>
                <MSym name="swap_horiz" size={16} />
                {strings.change}
              </button>
            </div>
          )}

          {chosenCase && (
            <div className="vfield" style={{ marginTop: 14 }}>
              <label htmlFor="appt-type">{strings.apptType}</label>
              <select id="appt-type" value={apptType} onChange={(e) => setApptType(e.target.value as ApptKind)}>
                {apptTypeOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--accent)", fontWeight: 700, marginTop: 6 }}>
                <MSym name="auto_awesome" size={14} />
                {strings.apptTypeHint}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {!chosenLead ? (
            <div className="vfield">
              <label htmlFor="prospect-search">{strings.searchProspect}</label>
              <input id="prospect-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={strings.searchProspectPh} autoFocus />
              <div style={{ marginTop: 8 }}>
                {filteredProspects.map((p) => {
                  const sm = sourceMeta(p.source);
                  return (
                    <button key={p.leadId} type="button" className="pick-row" onClick={() => setChosenLead(p.leadId)}>
                      <div className={`src-ico ${sm.cls}`} style={{ width: 32, height: 32 }}>
                        <MSym name={sm.icon} size={15} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 13.5, color: "var(--ink)" }}>{p.name ?? p.phone}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 700 }}>{p.sourceLabel} · {p.phone}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="pick-row sel" style={{ cursor: "default" }}>
              <div style={{ flex: 1, fontWeight: 800, color: "var(--ink)" }}>
                {prospectResults.find((p) => p.leadId === chosenLead)?.name ??
                  prospectResults.find((p) => p.leadId === chosenLead)?.phone}
              </div>
              <Chip tone="blue" icon="check">{strings.modeProspect}</Chip>
            </div>
          )}
          {chosenLead && (
            <div className="vfield" style={{ marginTop: 14 }}>
              <label>{strings.apptType}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 11, background: "var(--panel-2)", border: "1px solid var(--line)" }}>
                <span className="legend-sw evt-call" />
                <span style={{ fontWeight: 800, fontSize: 13.5, color: "var(--ink)" }}>{strings.callType}</span>
                <Chip tone="amber" style={{ marginLeft: "auto" }}>Amarillo</Chip>
              </div>
            </div>
          )}
        </>
      )}

      {/* Common fields */}
      <div style={{ borderTop: "1px solid var(--line)", margin: "16px 0", paddingTop: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="vfield" style={{ marginBottom: 0 }}>
            <label htmlFor="cita-day">{strings.date}</label>
            <select id="cita-day" value={day} onChange={(e) => setDay(e.target.value)}>
              {daysOptions.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>
          <div className="vfield" style={{ marginBottom: 0 }}>
            <label htmlFor="cita-slot">{strings.hour}</label>
            <select id="cita-slot" value={slot} onChange={(e) => setSlot(e.target.value)}>
              {slots.map((s) => (
                <option key={s} value={s}>{fmtTime(s, staffTz)}</option>
              ))}
            </select>
          </div>
        </div>

        {dual?.clientHour && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)", fontWeight: 700, marginTop: 10 }}>
            <MSym name="public" size={15} />
            {strings.clientEquiv.replace("{hour}", `${dual.staffHour} · ${dual.clientHour}`)}
          </div>
        )}

        {warning && (
          <div className="dup-warn" style={{ marginTop: 12 }}>
            <MSym name="error" size={16} />
            {warning === "overlap" ? strings.overlapWarn : strings.outsideWarn}
          </div>
        )}

        <div className="vfield" style={{ marginTop: 16, marginBottom: 0 }}>
          <label>{strings.duration}</label>
          <div className="seg" style={{ display: "flex" }}>
            {[30, 45, 60].map((v) => (
              <button key={v} type="button" className={duration === v ? "on" : ""} style={{ flex: 1 }} onClick={() => setDuration(v)}>
                {v} min
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 700, marginTop: 6 }}>{strings.durationHint}</div>
        </div>

        <div className="vfield" style={{ marginTop: 16, marginBottom: 0 }}>
          <label>{strings.modality}</label>
          <div className="seg" style={{ display: "flex" }}>
            <button type="button" className={modality === "video" ? "on" : ""} style={{ flex: 1 }} onClick={() => setModality("video")}>
              <MSym name="videocam" size={17} />
              {strings.video}
            </button>
            <button type="button" className={modality === "phone" ? "on" : ""} style={{ flex: 1 }} onClick={() => setModality("phone")}>
              <MSym name="call" size={17} />
              {strings.phone}
            </button>
          </div>
          {modality === "video" && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--ink-3)", fontWeight: 700, marginTop: 6 }}>
              <MSym name="link" size={14} />
              {strings.videoHint}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 18, marginTop: 16, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "var(--ink-2)", cursor: "pointer" }}>
            <input type="checkbox" checked={r1d} onChange={(e) => setR1d(e.target.checked)} />
            {strings.remind1d}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "var(--ink-2)", cursor: "pointer" }}>
            <input type="checkbox" checked={r1h} onChange={(e) => setR1h(e.target.checked)} />
            {strings.remind1h}
          </label>
        </div>

        <div className="vfield" style={{ marginTop: 16, marginBottom: 0 }}>
          <label htmlFor="cita-note">{strings.note}</label>
          <textarea id="cita-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={strings.notePh} rows={2} />
        </div>
      </div>
    </Modal>
  );
}
