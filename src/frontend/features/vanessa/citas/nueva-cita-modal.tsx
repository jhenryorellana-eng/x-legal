"use client";

/**
 * Nueva cita modal (DOC-52 §3.6, RF-VAN-028..030) — Cliente / Prospecto.
 *
 * Search-driven and on-demand: typing queries cases/leads via server actions;
 * picking one loads its booking CONTEXT (available slots + the DERIVED duration,
 * modality, sequence and route). Duration / modality / reminders are NOT editable
 * — they come from the service route (client) or org settings (prospect) and are
 * shown read-only. The staff only chooses date + hour (+ optional note).
 * Dual hours are computed REAL via the datetime lib over the chosen UTC instant.
 */

import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { MSym } from "../shared/msym";
import { Chip } from "../shared/ui";
import { useToast } from "../shared/toast-bridge";
import { Modal } from "@/frontend/components/desktop";
import { fmtTime, fmtTimeZoned, fmtDateShort } from "@/frontend/lib/datetime";
import type {
  NuevaCitaModalProps,
  ClientSearchResult,
  ProspectSearchResult,
  CaseBookingContext,
  ProspectSlotsContext,
  ApptModality,
} from "./types";

export function NuevaCitaModal({
  open,
  onOpenChange,
  staffTz,
  locale,
  strings,
  actions,
  presetProspect,
}: NuevaCitaModalProps) {
  const toast = useToast();
  // `actions` is rebuilt inline by the parent each render; pin to a ref so the
  // debounced search effect depends on stable values, not the object identity.
  const actionsRef = React.useRef(actions);
  actionsRef.current = actions;
  const [mode, setMode] = React.useState<"client" | "prospect">("client");
  const [query, setQuery] = React.useState("");
  const [clientResults, setClientResults] = React.useState<ClientSearchResult[]>([]);
  const [prospectResults, setProspectResults] = React.useState<ProspectSearchResult[]>([]);

  const [chosenCase, setChosenCase] = React.useState<ClientSearchResult | null>(null);
  const [chosenLead, setChosenLead] = React.useState<ProspectSearchResult | null>(null);

  const [ctx, setCtx] = React.useState<CaseBookingContext | ProspectSlotsContext | null>(null);
  const [ctxLoading, setCtxLoading] = React.useState(false);
  const [ctxError, setCtxError] = React.useState<string | null>(null);

  const [day, setDay] = React.useState("");
  const [slot, setSlot] = React.useState("");
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [warning, setWarning] = React.useState<null | "overlap" | "outside">(null);

  // Inline prospect creation
  const [showCreate, setShowCreate] = React.useState(false);
  const [newPhone, setNewPhone] = React.useState("");
  const [newName, setNewName] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const reset = React.useCallback(() => {
    setMode("client");
    setQuery("");
    setClientResults([]);
    setProspectResults([]);
    setChosenCase(null);
    setChosenLead(null);
    setCtx(null);
    setCtxError(null);
    setDay("");
    setSlot("");
    setNote("");
    setWarning(null);
    setShowCreate(false);
    setNewPhone("");
    setNewName("");
  }, []);

  React.useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  // Switching mode clears any selection/search.
  const switchMode = (m: "client" | "prospect") => {
    setMode(m);
    setQuery("");
    setChosenCase(null);
    setChosenLead(null);
    setCtx(null);
    setCtxError(null);
    setDay("");
    setSlot("");
    setWarning(null);
    setShowCreate(false);
  };

  // Debounced search while no selection is made.
  React.useEffect(() => {
    if (!open) return;
    if (mode === "client" && chosenCase) return;
    if (mode === "prospect" && chosenLead) return;
    let active = true;
    const handle = setTimeout(async () => {
      if (mode === "client") {
        const res = await actionsRef.current.searchCases(query);
        if (active) setClientResults(res.ok && res.results ? res.results : []);
      } else {
        const res = await actionsRef.current.searchProspects(query);
        if (active) setProspectResults(res.ok && res.results ? res.results : []);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [query, mode, open, chosenCase, chosenLead]);

  const initDaySlot = (slots: string[], tzx: string) => {
    if (slots.length === 0) {
      setDay("");
      setSlot("");
      return;
    }
    setDay(formatInTimeZone(slots[0], tzx, "yyyy-MM-dd"));
    setSlot(slots[0]);
  };

  const loadCaseContext = async (c: ClientSearchResult) => {
    setChosenCase(c);
    setCtx(null);
    setCtxError(null);
    setCtxLoading(true);
    setWarning(null);
    const res = await actions.getCaseContext(c.caseId);
    setCtxLoading(false);
    if (res.ok && res.context) {
      setCtx(res.context);
      initDaySlot(res.context.slots, res.context.staffTimezone);
    } else {
      setCtxError(res.error?.code ?? "internal");
    }
  };

  const loadProspectContext = async (lead: ProspectSearchResult) => {
    setChosenLead(lead);
    setCtx(null);
    setCtxError(null);
    setCtxLoading(true);
    setWarning(null);
    const res = await actions.getProspectSlots();
    setCtxLoading(false);
    if (res.ok && res.context) {
      setCtx(res.context);
      initDaySlot(res.context.slots, res.context.staffTimezone);
    } else {
      setCtxError(res.error?.code ?? "internal");
    }
  };

  const submitCreateProspect = async () => {
    const phone = newPhone.trim();
    if (!phone || creating) return;
    setCreating(true);
    const res = await actions.createProspectInline({ phone, name: newName.trim() || null });
    setCreating(false);
    if (res.ok && res.leadId) {
      setShowCreate(false);
      await loadProspectContext({ leadId: res.leadId, name: newName.trim() || null, phone, source: "manual" });
    } else {
      toast.error(strings.createProspect);
    }
  };

  // Opened from a lead card "Agendar cita": jump straight to Prospecto mode with
  // the lead pre-selected and its slots loaded (once per open, per lead). Kept
  // self-contained (refs + setters only) so it has no unstable function deps.
  const presetLoadedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open) {
      presetLoadedFor.current = null;
      return;
    }
    if (!presetProspect || presetLoadedFor.current === presetProspect.leadId) return;
    presetLoadedFor.current = presetProspect.leadId;
    setMode("prospect");
    setChosenLead(presetProspect);
    setCtx(null);
    setCtxError(null);
    setCtxLoading(true);
    setWarning(null);
    let active = true;
    void actionsRef.current.getProspectSlots().then((res) => {
      if (!active) return;
      setCtxLoading(false);
      if (res.ok && res.context) {
        setCtx(res.context);
        const slots = res.context.slots;
        if (slots.length === 0) {
          setDay("");
          setSlot("");
        } else {
          setDay(formatInTimeZone(slots[0], res.context.staffTimezone, "yyyy-MM-dd"));
          setSlot(slots[0]);
        }
      } else {
        setCtxError(res.error?.code ?? "internal");
      }
    });
    return () => {
      active = false;
    };
  }, [open, presetProspect]);

  const tz = ctx?.staffTimezone ?? staffTz;

  const days = React.useMemo(() => {
    if (!ctx) return [] as { value: string; label: string }[];
    const seen = new Map<string, string>();
    for (const iso of ctx.slots) {
      const key = formatInTimeZone(iso, ctx.staffTimezone, "yyyy-MM-dd");
      if (!seen.has(key)) seen.set(key, fmtDateShort(iso, ctx.staffTimezone, locale));
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [ctx, locale]);

  const daySlots = React.useMemo(() => {
    if (!ctx || !day) return [] as string[];
    return ctx.slots.filter((iso) => formatInTimeZone(iso, ctx.staffTimezone, "yyyy-MM-dd") === day);
  }, [ctx, day]);

  const onDayChange = (value: string) => {
    setDay(value);
    setWarning(null);
    if (!ctx) return;
    const first = ctx.slots.find((iso) => formatInTimeZone(iso, ctx.staffTimezone, "yyyy-MM-dd") === value);
    setSlot(first ?? "");
  };

  // The "Hora" select already shows the office time; this line shows ONLY the
  // client's equivalent in their own timezone (single hour — never two), and
  // only when the client's TZ differs from the office TZ.
  const clientHour = React.useMemo(() => {
    if (!slot) return null;
    const ctz = chosenCase?.clientTz;
    if (!ctz || ctz === tz) return null;
    return fmtTimeZoned(slot, ctz);
  }, [slot, tz, chosenCase]);

  const modalityLabel = (kind: ApptModality): string =>
    kind === "phone" ? strings.modalityPhone : kind === "presencial" ? strings.modalityPresencial : strings.modalityVideo;
  const modalityIcon = (kind: ApptModality): string =>
    kind === "phone" ? "call" : kind === "presencial" ? "place" : "videocam";

  // Read-only "what will be booked" summary.
  const summary = React.useMemo(() => {
    if (!ctx) return null;
    let title: string;
    if (mode === "client" && "seqLabel" in ctx) {
      const [n, total] = ctx.seqLabel.split("/");
      title = strings.citaLabel.replace("{n}", n ?? "").replace("{m}", total ?? "");
    } else {
      title = strings.prospectCita;
    }
    return { title, duration: ctx.durationMinutes, kind: ctx.kind };
  }, [ctx, mode, strings]);

  const canSubmit =
    mode === "client" ? chosenCase !== null && !!slot : chosenLead !== null && !!slot;

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    if (mode === "client" && chosenCase) {
      const res = await actions.bookAppointment({
        caseId: chosenCase.caseId,
        startsAtIso: slot,
        note,
        force: warning !== null,
      });
      setSubmitting(false);
      handleBookResult(res, () => toast.success(strings.createdClient.replace("{name}", chosenCase.name)));
    } else if (mode === "prospect" && chosenLead && "durationMinutes" in (ctx ?? {})) {
      const res = await actions.createProspectAppointment({
        leadId: chosenLead.leadId,
        startsAtIso: slot,
        durationMinutes: ctx!.durationMinutes,
        note,
        force: warning !== null,
      });
      setSubmitting(false);
      handleBookResult(res, () =>
        toast.success(strings.createdProspect.replace("{name}", chosenLead.name ?? chosenLead.phone)),
      );
    } else {
      setSubmitting(false);
    }
  };

  const handleBookResult = (
    res: { ok: boolean; error?: { code: string } },
    onOk: () => void,
  ) => {
    if (res.ok) {
      onOpenChange(false);
      onOk();
    } else if (res.error?.code === "SLOT_CONFLICT" || res.error?.code === "SLOT_TAKEN") {
      setWarning("overlap");
    } else if (res.error?.code === "OUTSIDE_AVAILABILITY" || res.error?.code === "OUTSIDE_WINDOW") {
      setWarning("outside");
    } else {
      toast.error(strings.create);
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
        <button type="button" className={mode === "client" ? "on" : ""} style={{ flex: 1 }} onClick={() => switchMode("client")}>
          <MSym name="workspace_premium" size={17} />
          {strings.modeClient}
        </button>
        <button type="button" className={mode === "prospect" ? "on" : ""} style={{ flex: 1 }} onClick={() => switchMode("prospect")}>
          <MSym name="person_search" size={17} />
          {strings.modeProspect}
        </button>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 700, marginBottom: 16 }}>
        {mode === "client" ? strings.clientHint : strings.prospectHint}
      </div>

      {/* CLIENT */}
      {mode === "client" ? (
        <>
          {!chosenCase ? (
            <div className="vfield">
              <label htmlFor="cita-search">{strings.searchClient}</label>
              <input id="cita-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={strings.searchClientPh} autoFocus />
              <div style={{ marginTop: 8 }}>
                {clientResults.length === 0 && (
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700, padding: "8px 2px" }}>{strings.emptyClients}</div>
                )}
                {clientResults.map((c) => (
                  <button key={c.caseId} type="button" className="pick-row" onClick={() => void loadCaseContext(c)}>
                    <div className="pick-av">{c.name.slice(0, 2).toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 13.5, color: "var(--ink)" }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 700 }}>
                        <span style={{ color: "var(--accent)" }}>{c.serviceLabel}</span>
                        {c.phone ? ` · ${c.phone}` : ""}
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
                <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 700 }}>{chosenCase.serviceLabel}</div>
              </div>
              <button
                type="button"
                className="vbtn vbtn-ghost vbtn-sm"
                onClick={() => {
                  setChosenCase(null);
                  setCtx(null);
                  setCtxError(null);
                }}
              >
                <MSym name="swap_horiz" size={16} />
                {strings.change}
              </button>
            </div>
          )}
        </>
      ) : (
        /* PROSPECT */
        <>
          {!chosenLead ? (
            <div className="vfield">
              <label htmlFor="prospect-search">{strings.searchProspect}</label>
              <input id="prospect-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={strings.searchProspectPh} autoFocus />
              <div style={{ marginTop: 8 }}>
                {prospectResults.map((p) => (
                  <button key={p.leadId} type="button" className="pick-row" onClick={() => void loadProspectContext(p)}>
                    <div className="pick-av">{(p.name ?? p.phone).slice(0, 2).toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 13.5, color: "var(--ink)" }}>{p.name ?? p.phone}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 700 }}>{p.phone}</div>
                    </div>
                  </button>
                ))}
                {prospectResults.length === 0 && !showCreate && (
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700, padding: "8px 2px" }}>{strings.emptyProspects}</div>
                )}

                {!showCreate ? (
                  <button type="button" className="vbtn vbtn-ghost vbtn-sm" style={{ marginTop: 8 }} onClick={() => setShowCreate(true)}>
                    <MSym name="person_add" size={16} />
                    {strings.createProspect}
                  </button>
                ) : (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 11, background: "var(--panel-2)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
                    <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder={strings.prospectPhonePh} autoFocus />
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={strings.prospectNamePh} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" className="vbtn vbtn-primary vbtn-sm" disabled={!newPhone.trim() || creating} onClick={() => void submitCreateProspect()}>
                        <MSym name="check" size={16} />
                        {strings.createProspectConfirm}
                      </button>
                      <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={() => setShowCreate(false)}>
                        {strings.cancel}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="pick-row sel" style={{ cursor: "default" }}>
              <div className="pick-av" style={{ width: 44, height: 44 }}>{(chosenLead.name ?? chosenLead.phone).slice(0, 2).toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: 15, color: "var(--ink)" }}>{chosenLead.name ?? chosenLead.phone}</div>
                <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 700 }}>{chosenLead.phone}</div>
              </div>
              <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={() => { setChosenLead(null); setCtx(null); setCtxError(null); }}>
                <MSym name="swap_horiz" size={16} />
                {strings.change}
              </button>
            </div>
          )}
        </>
      )}

      {/* Route summary (client only) */}
      {mode === "client" && chosenCase && ctx && "ruta" in ctx && ctx.ruta.length > 0 && (
        <div className="vfield" style={{ marginTop: 14 }}>
          <label>{strings.rutaTitle}</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {ctx.ruta.map((r) => (
              <div
                key={r.number}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: r.status === "current" ? "var(--ink)" : "var(--ink-3)",
                }}
              >
                <span
                  className="legend-sw"
                  style={{
                    background:
                      r.status === "completed" ? "var(--brand-green)" : r.status === "current" ? "var(--accent)" : "var(--line)",
                  }}
                />
                {strings.citaLabel.replace("{n}", String(r.number)).replace("{m}", String(ctx.ruta.length))}
                {r.label ? ` · ${r.label}` : ""}
                {r.status === "completed" && <MSym name="check" size={14} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Context loading / error */}
      {ctxLoading && (
        <div style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700, marginTop: 14 }}>{strings.loadingSlots}</div>
      )}
      {ctxError && (
        <div className="dup-warn" style={{ marginTop: 14 }}>
          <MSym name="error" size={16} />
          {strings.noSlots}
        </div>
      )}

      {/* Date + hour (only after a selection with slots) */}
      {ctx && !ctxLoading && (
        <div style={{ borderTop: "1px solid var(--line)", margin: "16px 0 0", paddingTop: 16 }}>
          {ctx.slots.length === 0 ? (
            <div className="dup-warn">
              <MSym name="event_busy" size={16} />
              {strings.noSlots}
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="vfield" style={{ marginBottom: 0 }}>
                  <label htmlFor="cita-day">{strings.date}</label>
                  <select id="cita-day" value={day} onChange={(e) => onDayChange(e.target.value)}>
                    {days.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
                <div className="vfield" style={{ marginBottom: 0 }}>
                  <label htmlFor="cita-slot">{strings.hour}</label>
                  <select id="cita-slot" value={slot} onChange={(e) => { setSlot(e.target.value); setWarning(null); }}>
                    {daySlots.map((s) => (
                      <option key={s} value={s}>{fmtTime(s, tz)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {clientHour && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)", fontWeight: 700, marginTop: 10 }}>
                  <MSym name="public" size={15} />
                  {strings.clientEquiv.replace("{hour}", clientHour)}
                </div>
              )}
            </>
          )}

          {/* Read-only derived info */}
          {summary && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
              <Chip tone="blue" icon="event">{summary.title}</Chip>
              <Chip tone="neutral" icon="timer">{`${summary.duration} ${strings.min}`}</Chip>
              <Chip tone="neutral" icon={modalityIcon(summary.kind)}>{modalityLabel(summary.kind)}</Chip>
              <Chip tone="neutral" icon="notifications">{strings.remindersInfo}</Chip>
            </div>
          )}

          {warning && (
            <div className="dup-warn" style={{ marginTop: 12 }}>
              <MSym name="error" size={16} />
              {warning === "overlap" ? strings.overlapWarn : strings.outsideWarn}
            </div>
          )}

          <div className="vfield" style={{ marginTop: 16, marginBottom: 0 }}>
            <label htmlFor="cita-note">{strings.note}</label>
            <textarea id="cita-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={strings.notePh} rows={2} />
          </div>
        </div>
      )}
    </Modal>
  );
}
