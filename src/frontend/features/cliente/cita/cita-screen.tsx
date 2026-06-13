"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/frontend/components/brand/icon";
import { IconTile } from "@/frontend/components/brand/icon-tile";
import { Lex } from "@/frontend/components/brand/lex";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { StatusPill } from "@/frontend/components/brand/status-pill";
import { BottomSheet, Confetti, playChime } from "@/frontend/components/mobile";

/**
 * Cancel action result shape — structurally identical to the app server action
 * (passed in as a prop). Defined HERE because `frontend` may not import `app`
 * (boundary R5).
 */
export interface CancelAppointmentActionResult {
  ok: boolean;
  error?: { code: string };
}

/**
 * CitaScreen — `/caso/[caseId]/cita/[appointmentId]` (DOC-51 §19, prototype
 * `screens3.jsx → ConfirmedScreen`, prompt cliente/19).
 *
 * Confirmed-appointment detail: green confirmation card with the dual hour
 * (client TZ + staff TZ "… en Utah", both derived server-side from the same UTC
 * instant), advisor, and a "Entrar a la videollamada" button. LiveKit is F7, so
 * the button stays VISIBLE but disabled with a "Pronto" note (never hidden — a
 * disabled action must look disabled, not vanish).
 *
 * Cancel goes through a confirmation dialog that RECUERDA the 7-day penalty
 * (never one-tap). Reschedule is allowed only outside the 24h window (the domain
 * enforces OUTSIDE_WINDOW; we surface it as an amber message). When the caller
 * arrives from a fresh booking (`?nueva=1`) we fire the confetti + chime.
 */

export interface CitaLabels {
  title: string;
  dateLabel: string;
  timeLabel: string;
  withLabel: string;
  objectiveLabel: string;
  joinCall: string;
  callSoon: string;
  callSoonNote: string;
  typePhone: string;
  typePresencial: string;
  reminderNote: string;
  backHome: string;
  reschedule: string;
  cancel: string;
  completedChip: string;
  completedTitle: string;
  completedBody: string;
  staffNoteLabel: string;
  cancelTitle: string;
  cancelBody: string;
  cancelReasonPlaceholder: string;
  cancelKeep: string;
  cancelConfirm: string;
  cancelling: string;
  errCancel: string;
  errReschedule: string;
  errWindow: string;
}

export interface CitaScreenProps {
  caseId: string;
  appointmentId: string;
  /** Pre-formatted, server-side, locale + dual-TZ aware (DOC-23 §6.5). */
  dateText: string;
  /** "2:00 PM (Florida) · 12:00 PM en Utah" — already dual + region tagged. */
  timeText: string;
  /** Advisor display value, e.g. "Diana Restrepo, tu asesora". */
  advisorText: string;
  /** Advisor avatar initial (or "•" when unknown). */
  advisorInitial: string;
  /** Optional appointment goal (from notes). */
  objectiveText: string | null;
  kind: "video" | "phone" | "presencial";
  status: "scheduled" | "completed" | "cancelled" | "no_show" | "rescheduled";
  /** Staff note shown when the appointment is completed. */
  staffNote: string | null;
  /** Fire the confetti (the client just booked it). */
  celebrate: boolean;
  labels: CitaLabels;
  cancelAppointment: (input: {
    appointmentId: string;
    reason: string;
  }) => Promise<CancelAppointmentActionResult>;
}

export function CitaScreen({
  caseId,
  appointmentId,
  dateText,
  timeText,
  advisorText,
  advisorInitial,
  objectiveText,
  kind,
  status,
  staffNote,
  celebrate,
  labels,
  cancelAppointment,
}: CitaScreenProps) {
  const router = useRouter();
  const [run, setRun] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [cancelling, setCancelling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const completed = status === "completed";

  React.useEffect(() => {
    if (!celebrate || completed) return;
    const tmr = setTimeout(() => {
      setRun(true);
      playChime();
    }, 200);
    return () => clearTimeout(tmr);
  }, [celebrate, completed]);

  async function doCancel() {
    if (cancelling) return;
    setCancelling(true);
    setError(null);
    const res = await cancelAppointment({
      appointmentId,
      reason: reason.trim() || "client_cancelled",
    });
    if (res.ok) {
      setCancelOpen(false);
      // The Citas tab re-resolves (block screen after a late cancellation).
      router.replace(`/caso/${caseId}/agendar`);
      router.refresh();
      return;
    }
    setCancelling(false);
    setError(labels.errCancel);
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        position: "relative",
        overflow: "hidden",
        padding: "44px 22px 124px",
        background:
          "radial-gradient(120% 70% at 50% 0%, var(--card) 0%, var(--bg) 52%, var(--blue-soft) 100%)",
      }}
    >
      {!completed && <Confetti run={run} />}

      {/* Zona 1 — Lex */}
      <div style={{ display: "flex", justifyContent: "center", position: "relative", zIndex: 2 }}>
        <Lex size={120} mood={completed ? "calma" : "feliz"} />
      </div>

      {/* Zona 2 — Confirmation card */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          marginTop: 8,
          borderRadius: 26,
          padding: "26px 20px 22px",
          background: completed
            ? "var(--card)"
            : "linear-gradient(180deg, var(--green-soft) 0%, var(--card) 62%)",
          border: completed
            ? "1.5px solid var(--line)"
            : "1.5px solid color-mix(in srgb, var(--green) 13%, transparent)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        {completed ? (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
            <StatusPill kind="aprobado">{labels.completedChip}</StatusPill>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 999,
                background: "var(--green)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow:
                  "0 10px 24px color-mix(in srgb, var(--green) 38%, transparent), 0 0 0 7px color-mix(in srgb, var(--green) 13%, transparent)",
                animation: "checkPop 0.6s 0.2s cubic-bezier(.2,1.3,.4,1) both",
              }}
            >
              <Icon name="check" size={28} color="#fff" stroke={3.4} />
            </div>
          </div>
        )}

        <h1
          className="t-black"
          style={{
            margin: "0 0 18px",
            fontSize: 25,
            color: "var(--navy)",
            textAlign: "center",
            textWrap: "balance",
          }}
        >
          {completed ? labels.completedTitle : labels.title}
        </h1>

        {/* Detail rows */}
        <DetailRow icon="calendar" label={labels.dateLabel} value={dateText} />
        <DetailRow icon="clock" label={labels.timeLabel} value={timeText} />
        <DetailRow icon="user" label={labels.withLabel} value={advisorText} avatarInitial={advisorInitial} />
        {objectiveText && (
          <DetailRow icon="info" label={labels.objectiveLabel} value={objectiveText} />
        )}

        {/* Join / type CTA */}
        {!completed && kind === "video" && (
          <div style={{ marginTop: 18 }}>
            <GradientBtn icon="video" disabled>
              {labels.joinCall} · {labels.callSoon}
            </GradientBtn>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                marginTop: 9,
                fontSize: 12.5,
                color: "var(--ink-3)",
                fontWeight: 600,
              }}
            >
              <Icon name="clock" size={15} color="var(--ink-3)" />
              {labels.callSoonNote}
            </div>
          </div>
        )}
        {!completed && kind !== "video" && (
          <div
            style={{
              marginTop: 16,
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "var(--blue-soft)",
              borderRadius: 14,
              padding: "12px 14px",
            }}
          >
            <Icon name={kind === "phone" ? "phone" : "map"} size={20} color="var(--accent)" />
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--navy)", lineHeight: 1.4 }}>
              {kind === "phone" ? labels.typePhone : labels.typePresencial}
            </div>
          </div>
        )}

        {/* Completed staff note */}
        {completed && (
          <div style={{ marginTop: 6 }}>
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 14.5,
                color: "var(--ink-2)",
                fontWeight: 500,
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              {labels.completedBody}
            </p>
            {staffNote && (
              <div
                style={{
                  background: "var(--green-soft)",
                  borderRadius: 14,
                  padding: "13px 15px",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--green-deep, var(--green))", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {labels.staffNoteLabel}
                </div>
                <div style={{ fontSize: 14.5, color: "var(--navy)", fontWeight: 500, lineHeight: 1.5 }}>
                  {staffNote}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Zona 3 — Reminder note (only for upcoming) */}
      {!completed && (
        <div
          style={{
            position: "relative",
            zIndex: 2,
            marginTop: 14,
            display: "flex",
            alignItems: "flex-start",
            gap: 11,
            background: "var(--blue-soft)",
            borderRadius: 16,
            padding: "13px 15px",
          }}
        >
          <Icon name="bell" size={20} color="var(--accent)" />
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--navy)", lineHeight: 1.45 }}>
            {labels.reminderNote}
          </div>
        </div>
      )}

      {/* Mutation error */}
      {error && (
        <div
          role="alert"
          style={{
            position: "relative",
            zIndex: 2,
            marginTop: 12,
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            background: "var(--gold-soft)",
            borderRadius: 14,
            padding: "12px 14px",
          }}
        >
          <Icon name="info" size={19} color="var(--gold-deep)" />
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--gold-deep)", lineHeight: 1.4 }}>
            {error}
          </div>
        </div>
      )}

      {/* Zona 4 — Secondary actions */}
      <div style={{ position: "relative", zIndex: 2, marginTop: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <GhostBtn icon="home" onClick={() => router.push(`/caso/${caseId}/camino`)}>
          {labels.backHome}
        </GhostBtn>

        {!completed && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, marginTop: 2 }}>
            <button
              type="button"
              onClick={() =>
                router.push(`/caso/${caseId}/agendar?reschedule=${appointmentId}`)
              }
              style={textActionStyle("var(--accent)")}
            >
              {labels.reschedule}
            </button>
            <span aria-hidden="true" style={{ width: 1, height: 16, background: "var(--line)" }} />
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              style={textActionStyle("var(--red)")}
            >
              {labels.cancel}
            </button>
          </div>
        )}
      </div>

      {/* Cancel confirmation dialog (never one-tap; recalls the 7-day rule) */}
      <BottomSheet
        open={cancelOpen}
        onClose={() => (cancelling ? undefined : setCancelOpen(false))}
        title={labels.cancelTitle}
        subtitle={labels.cancelBody}
      >
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={labels.cancelReasonPlaceholder}
          rows={3}
          style={{
            width: "100%",
            resize: "vertical",
            minHeight: 70,
            borderRadius: 14,
            border: "1.5px solid var(--line)",
            background: "var(--card)",
            padding: "11px 13px",
            fontFamily: "var(--font-body)",
            fontSize: 15,
            color: "var(--ink)",
            outline: "none",
            marginBottom: 16,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            type="button"
            disabled={cancelling}
            onClick={doCancel}
            style={{
              height: 54,
              borderRadius: 999,
              border: "none",
              cursor: cancelling ? "default" : "pointer",
              background: "var(--red)",
              color: "#fff",
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 16,
              opacity: cancelling ? 0.6 : 1,
              boxShadow: "0 10px 24px color-mix(in srgb, var(--red) 30%, transparent)",
            }}
          >
            {cancelling ? labels.cancelling : labels.cancelConfirm}
          </button>
          <GhostBtn onClick={() => (cancelling ? undefined : setCancelOpen(false))}>
            {labels.cancelKeep}
          </GhostBtn>
        </div>
      </BottomSheet>
    </div>
  );
}

function textActionStyle(color: string): React.CSSProperties {
  return {
    background: "none",
    border: "none",
    cursor: "pointer",
    color,
    fontFamily: "var(--font-title)",
    fontWeight: 700,
    fontSize: 15,
    padding: "8px 0",
  };
}

function DetailRow({
  icon,
  label,
  value,
  avatarInitial,
}: {
  icon: "calendar" | "clock" | "user" | "info";
  label: string;
  value: string;
  avatarInitial?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "9px 0" }}>
      {avatarInitial ? (
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 13,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, var(--accent), var(--brand-navy))",
            color: "#fff",
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 18,
          }}
        >
          {avatarInitial}
        </div>
      ) : (
        <IconTile name={icon} color="var(--green)" size={44} radius={13} iconSize={22} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-3)", marginBottom: 1 }}>
          {label}
        </div>
        <div
          className="t-title"
          style={{ fontSize: 16.5, fontWeight: 800, color: "var(--navy)", lineHeight: 1.3 }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}
