"use client";

/**
 * ValidacionesDetailView — per-case validation loop for paralegal Diana.
 *
 * Zones 1–4 from spec PROMPT-DIA-06:
 *   1. Active attempt card (stepper, StatusPill, semáforo, banner, send btn, error)
 *   2. Validated verdict card (green + checkPop)
 *   3. Returned verdict (findings by severity + correction modal)
 *   4. Timeline of all attempts
 *
 * Pattern: mirrors ensamblador-view.tsx (inline styles, CSS vars, brand
 * components only, window.location.reload() after mutations).
 */

import * as React from "react";
import Link from "next/link";
import {
  Card,
  GradientBtn,
  GhostBtn,
  StatusPill,
  Chip,
  Lex,
  Stepper,
  Timeline,
  type StatusKind,
  type Step,
  type TimelineGroup,
} from "@/frontend/components/brand";
import { toast } from "@/frontend/components/desktop";
// ---------------------------------------------------------------------------
// Inline types (mirrors backend types — frontend MUST NOT import from @/backend)
// ---------------------------------------------------------------------------

/** Mirrors LegalValidationRow from integrations module. */
export interface ValidationRowVM {
  id: string;
  case_id: string;
  expediente_id: string;
  attempt_no: number;
  status: "pending" | "sent" | "queued" | "in_review" | "validated" | "needs_corrections" | "cancelled" | "error";
  semaforo: string | null;
  ai_score: number | null;
  verdict: string | null;
  verdict_notes: string | null;
  verdict_findings: unknown;
  verdict_at: string | null;
  return_to: string | null;
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

/** Mirrors AbogadosFinding from integrations/domain. */
export interface FindingVM {
  severity: string;
  category?: string;
  location?: string;
  description: string;
  recommendation?: string;
}

// ---------------------------------------------------------------------------
// VM types (fed from server component)
// ---------------------------------------------------------------------------

export interface ValidacionesDetailVM {
  caseId: string;
  /** All validations for this case, DESC by attempt_no. Typed as ValidationRowVM[] (no backend import). */
  validations: ValidationRowVM[];
  /** The compiled expediente id (for sendToLawyer gate). Null if none. */
  compiledExpedienteId: string | null;
}

// ---------------------------------------------------------------------------
// Actions (injected from server component)
// ---------------------------------------------------------------------------

export interface ValidacionesDetailActions {
  sendToLawyer: (input: {
    caseId: string;
    expedienteId: string;
  }) => Promise<{ ok: boolean; data?: { validationId: string; external: string | null }; error?: { code: string } }>;
  createCorrectionAttempt: (input: {
    expedienteId: string;
  }) => Promise<{ ok: boolean; data?: { id: string; attempt_no: number }; error?: { code: string } }>;
}

export interface ValidacionesDetailViewProps {
  vm: ValidacionesDetailVM;
  actions: ValidacionesDetailActions;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

type ValidationStatus = ValidationRowVM["status"];
type Semaforo = "green" | "amber" | "red" | null;

const STATUS_PILL: Record<ValidationStatus, { kind: StatusKind; label: string }> = {
  pending:           { kind: "pendiente", label: "Enviando…" },
  sent:              { kind: "pendiente", label: "Enviando…" },
  queued:            { kind: "revision",  label: "En cola del abogado" },
  in_review:         { kind: "revision",  label: "En revisión" },
  validated:         { kind: "aprobado",  label: "Validado" },
  needs_corrections: { kind: "corregir",  label: "Devuelto con correcciones" },
  cancelled:         { kind: "pendiente", label: "Cancelada en el SaaS" },
  error:             { kind: "corregir",  label: "Error de envío" },
};

const IN_PROGRESS_STATUSES = new Set<ValidationStatus>([
  "pending", "sent", "queued", "in_review",
]);

// ---------------------------------------------------------------------------
// Stepper builder
// ---------------------------------------------------------------------------

function buildStepperSteps(status: ValidationStatus): Step[] {
  type StepKey = "sent" | "queued" | "in_review" | "verdict";

  const order: StepKey[] = ["sent", "queued", "in_review", "verdict"];

  const currentIndex = ((): number => {
    if (status === "pending" || status === "sent") return 0;
    if (status === "queued") return 1;
    if (status === "in_review") return 2;
    // validated, needs_corrections, cancelled, error → verdict reached
    return 3;
  })();

  const labels: Record<StepKey, string> = {
    sent:      "Enviado",
    queued:    "En cola",
    in_review: "En revisión",
    verdict:   "Veredicto",
  };

  return order.map((key, idx): Step => {
    let state: "done" | "current" | "upcoming";
    if (idx < currentIndex) state = "done";
    else if (idx === currentIndex) state = "current";
    else state = "upcoming";
    return { id: key, label: labels[key], state };
  });
}

// ---------------------------------------------------------------------------
// Semáforo chip
// ---------------------------------------------------------------------------

function SemaforoChip({ value }: { value: Semaforo }) {
  if (!value) return null;
  const tone = value === "green" ? "green" : value === "amber" ? "amber" : "red";
  const label = value === "green" ? "Semáforo verde" : value === "amber" ? "Semáforo ámbar" : "Semáforo rojo";
  const dotColor = value === "green" ? "var(--green)" : value === "amber" ? "var(--gold-deep)" : "var(--red)";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: dotColor,
          flexShrink: 0,
        }}
      />
      <Chip tone={tone}>{label}</Chip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error code → friendly message
// ---------------------------------------------------------------------------

function errorMessage(code: string): string {
  switch (code) {
    case "PLAN_NOT_WITH_LAWYER":       return "Este caso no tiene plan con abogado.";
    case "EXPEDIENTE_NOT_COMPILED":    return "El expediente no está compilado.";
    case "VALIDATION_ALREADY_ACTIVE":  return "Ya hay una validación activa para este caso.";
    case "ABOGADOS_API_ERROR":         return "Error al comunicarse con el SaaS. Intenta de nuevo.";
    case "ABOGADOS_API_UNAUTHORIZED":  return "Error de configuración. Requiere atención del administrador.";
    case "ABOGADOS_API_BAD_REQUEST":   return "Los datos enviados no son válidos. Revisa el expediente.";
    case "CASE_NOT_FOUND":             return "Caso no encontrado.";
    case "EXPEDIENTE_NOT_FOUND":       return "Expediente no encontrado.";
    case "EXPEDIENTE_NOT_EDITABLE":    return "El expediente ya no es editable.";
    case "EXPEDIENTE_DRAFT_EXISTS":    return "Ya existe un borrador de corrección.";
    default:                           return "Algo salió mal. Intenta de nuevo.";
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Finding severity helpers
// ---------------------------------------------------------------------------

type FindingSeverity = "critical" | "moderate" | "suggestion" | string;

function severityLabel(s: FindingSeverity): string {
  if (s === "critical") return "Crítico";
  if (s === "moderate") return "Moderado";
  if (s === "suggestion") return "Sugerencia";
  return String(s);
}

function severityBorderColor(s: FindingSeverity): string {
  if (s === "critical") return "var(--red)";
  if (s === "moderate") return "var(--gold-deep)";
  return "var(--accent)";
}

function severityChipTone(s: FindingSeverity): "red" | "gold" | "blue" {
  if (s === "critical") return "red";
  if (s === "moderate") return "gold";
  return "blue";
}

// ---------------------------------------------------------------------------
// FindingCard sub-component
// ---------------------------------------------------------------------------

interface FindingCardProps {
  finding: FindingVM;
  index: number;
  caseId: string;
}

function FindingCard({ finding, index, caseId }: FindingCardProps) {
  const [attended, setAttended] = React.useState(false);

  const borderColor = severityBorderColor(finding.severity);
  const chipTone = severityChipTone(finding.severity);

  // Contextual shortcut based on category
  const shortcuts: Record<string, { label: string; href: string }> = {
    "Marcador sin resolver":  { label: "Ir a Cartas", href: "/legal/expediente/" + caseId },
    "Dato inconsistente":     { label: "Ir a Información", href: "/admin/casos/" + caseId },
    "Orden de evidencia":     { label: "Abrir PDF del intento", href: "#pdf-" + String(index) },
  };
  const shortcut = shortcuts[finding.category ?? ""] ?? { label: "Ir a expediente", href: "/legal/expediente/" + caseId };

  return (
    <div
      style={{
        borderLeft: "4px solid " + borderColor,
        borderRadius: "0 12px 12px 0",
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderLeftWidth: 4,
        borderLeftColor: borderColor,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        opacity: attended ? 0.6 : 1,
        transition: "opacity 0.2s var(--ease)",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <StatusPill kind={chipTone === "red" ? "corregir" : chipTone === "gold" ? "revision" : "pendiente"}>
          {severityLabel(finding.severity)}
        </StatusPill>
        {finding.category && (
          <Chip tone={chipTone}>{finding.category}</Chip>
        )}
        {finding.location && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              color: "var(--ink-2)",
              fontWeight: 700,
              background: "var(--blue-soft)",
              borderRadius: 999,
              padding: "2px 10px",
            }}
          >
            {/* Map pin icon (SVG inline) */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
            {"Ubicación: " + finding.location}
          </span>
        )}
      </div>

      {/* Description */}
      <p style={{ fontSize: 13, color: "var(--ink)", margin: 0, lineHeight: 1.6 }}>
        {finding.description}
      </p>

      {/* Recommendation block */}
      {finding.recommendation && (
        <div
          style={{
            background: "var(--blue-soft)",
            borderRadius: 8,
            padding: "10px 14px",
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
          }}
        >
          {/* Sparkle icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
            <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" />
          </svg>
          <p style={{ fontSize: 12.5, color: "var(--accent)", margin: 0, fontWeight: 700, lineHeight: 1.5 }}>
            <strong style={{ display: "block", marginBottom: 2, color: "var(--ink)" }}>Recomendación</strong>
            {finding.recommendation}
          </p>
        </div>
      )}

      {/* Actions row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Link
          href={shortcut.href}
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--accent)",
            textDecoration: "none",
            border: "1.5px solid var(--line)",
            borderRadius: 8,
            padding: "5px 12px",
            background: "var(--card)",
            display: "inline-block",
          }}
        >
          {shortcut.label} →
        </Link>

        {/* Attended checkbox */}
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 700,
            color: attended ? "var(--green)" : "var(--ink-2)",
          }}
        >
          <input
            type="checkbox"
            checked={attended}
            onChange={(e) => setAttended(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "var(--green)", cursor: "pointer" }}
            aria-label="Marcar hallazgo como atendido"
          />
          Atendido
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Correction modal
// ---------------------------------------------------------------------------

interface CorrectionModalProps {
  attemptNo: number;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  busy: boolean;
}

function CorrectionModal({ attemptNo, onConfirm, onClose, busy }: CorrectionModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(7, 14, 28, 0.55)",
          backdropFilter: "blur(4px)",
        }}
      />

      {/* Dialog */}
      <div
        style={{
          position: "relative",
          background: "var(--card)",
          borderRadius: 20,
          border: "1px solid var(--line)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.2)",
          padding: 28,
          width: "100%",
          maxWidth: 460,
        }}
      >
        <h2
          id="modal-title"
          style={{
            fontSize: 18,
            fontWeight: 900,
            color: "var(--ink)",
            marginBottom: 10,
            fontFamily: "var(--font-title)",
          }}
        >
          Crear intento {String(attemptNo + 1)} de corrección
        </h2>
        <p style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.6, marginBottom: 20 }}>
          Se creará el intento {String(attemptNo + 1)} clonando los ítems del intento {String(attemptNo)}.
          El intento {String(attemptNo)} queda congelado como historial.
        </p>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <GhostBtn size="md" full={false} onClick={onClose} disabled={busy}>
            Cancelar
          </GhostBtn>
          <GradientBtn size="md" full={false} disabled={busy} onClick={onConfirm}>
            {busy ? "Creando…" : "Confirmar y continuar"}
          </GradientBtn>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ValidacionesDetailView({ vm, actions }: ValidacionesDetailViewProps) {
  const [busySend, setBusySend] = React.useState(false);
  const [showCorrectionModal, setShowCorrectionModal] = React.useState(false);
  const [busyCorrection, setBusyCorrection] = React.useState(false);

  const { caseId, validations, compiledExpedienteId } = vm;

  // The current (latest) validation
  const current = validations[0] ?? null;

  // ---- sendToLawyer ----
  async function handleSendToLawyer() {
    if (!compiledExpedienteId) {
      toast.error("No hay expediente compilado para este caso.");
      return;
    }
    setBusySend(true);
    const r = await actions.sendToLawyer({ caseId, expedienteId: compiledExpedienteId });
    setBusySend(false);
    if (r.ok) {
      toast.success("Expediente enviado al abogado.");
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED"));
    }
  }

  // ---- createCorrectionAttempt ----
  async function handleCreateCorrection() {
    if (!current) return;
    setBusyCorrection(true);
    // The expedienteId to correct is the one from the current validation
    const r = await actions.createCorrectionAttempt({
      expedienteId: current.expediente_id,
    });
    setBusyCorrection(false);
    if (r.ok) {
      toast.success("Nuevo intento de corrección creado. Redirigiendo…");
      setShowCorrectionModal(false);
      // Navigate to ensamblador
      window.location.href = "/legal/expediente/" + caseId;
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED"));
    }
  }

  // ---- Gate checks for "Enviar a abogado" button ----
  const canSend = ((): { allowed: boolean; reason: string } => {
    if (!compiledExpedienteId) {
      return { allowed: false, reason: "Sin expediente compilado" };
    }
    if (current && IN_PROGRESS_STATUSES.has(current.status)) {
      return { allowed: false, reason: "Ya hay una validación activa" };
    }
    return { allowed: true, reason: "" };
  })();

  // ---- Timeline data from all attempts ----
  const timelineGroups = buildTimelineGroups(validations);

  // ---- No validations yet ----
  if (!current) {
    return (
      <div>
        <BackLink />
        <Card>
          <div style={{ textAlign: "center", padding: "48px 20px" }}>
            <Lex mood="calma" size={110} />
            <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", marginTop: 12 }}>
              Sin validaciones todavía
            </h3>
            <p style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 6, marginBottom: 20 }}>
              {compiledExpedienteId
                ? "El expediente está compilado y listo para enviar."
                : "Primero compila el expediente para enviarlo al abogado."}
            </p>
            {compiledExpedienteId ? (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <GradientBtn
                  size="md"
                  full={false}
                  disabled={busySend}
                  onClick={handleSendToLawyer}
                >
                  {busySend ? "Enviando…" : "Enviar a abogado"}
                </GradientBtn>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <Link
                  href={"/legal/expediente/" + caseId}
                  style={{
                    fontSize: 13.5,
                    fontWeight: 700,
                    color: "var(--accent)",
                    textDecoration: "underline",
                  }}
                >
                  Compila el expediente para enviarlo
                </Link>
              </div>
            )}
          </div>
        </Card>
      </div>
    );
  }

  const pill = STATUS_PILL[current.status] ?? { kind: "pendiente" as StatusKind, label: current.status };
  const steps = buildStepperSteps(current.status);
  const inProgress = IN_PROGRESS_STATUSES.has(current.status);
  const isValidated = current.status === "validated";
  const isReturned = current.status === "needs_corrections";
  const isError = current.status === "error";

  // Parse findings (stored as JSON in DB)
  const findings: FindingVM[] = Array.isArray(current.verdict_findings)
    ? (current.verdict_findings as FindingVM[])
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {showCorrectionModal && (
        <CorrectionModal
          attemptNo={current.attempt_no}
          onConfirm={handleCreateCorrection}
          onClose={() => setShowCorrectionModal(false)}
          busy={busyCorrection}
        />
      )}

      <BackLink />

      {/* ------------------------------------------------------------------ */}
      {/* ZONA 1 — Active attempt card                                         */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <div style={{ padding: 4, display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Header row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 900,
                    color: "var(--ink)",
                    fontFamily: "var(--font-title)",
                  }}
                >
                  Validación
                </span>
                <Chip tone="blue">{"Intento " + String(current.attempt_no)}</Chip>
                <StatusPill kind={pill.kind}>{pill.label}</StatusPill>
                {current.semaforo && <SemaforoChip value={current.semaforo as Semaforo} />}
                {current.ai_score !== null && current.ai_score !== undefined && (
                  <Chip tone="gold">{"IA: " + String(current.ai_score) + "/100"}</Chip>
                )}
              </div>
            </div>

            {/* Send to lawyer — first send (no verdict yet) OR resend a freshly
                recompiled correction attempt (returned + a NEWER compiled expediente). */}
            {((!inProgress && !isValidated && !isReturned) ||
              (isReturned && !!compiledExpedienteId && compiledExpedienteId !== current.expediente_id)) && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <GradientBtn
                  size="md"
                  full={false}
                  disabled={!canSend.allowed || busySend}
                  onClick={handleSendToLawyer}
                  title={canSend.allowed ? undefined : canSend.reason}
                >
                  {busySend ? "Enviando…" : isReturned ? "Reenviar intento corregido" : "Enviar a abogado"}
                </GradientBtn>
              </div>
            )}
          </div>

          {/* Stepper */}
          <Stepper steps={steps} orientation="horizontal" />

          {/* Timestamps */}
          {current.sent_at && (
            <p style={{ fontSize: 12, color: "var(--ink-3)", margin: 0 }}>
              {"Enviado el " + formatDate(current.sent_at) + " a las " + formatTime(current.sent_at)}
              {" · "}
              <span style={{ color: "var(--ink-2)" }}>Actualizado hace {relativeFromNow(current.verdict_at ?? current.sent_at)}</span>
            </p>
          )}

          {/* In-progress banner */}
          {inProgress && (
            <div
              role="status"
              style={{
                background: "var(--blue-soft)",
                border: "1.5px solid var(--line)",
                borderRadius: 10,
                padding: "10px 16px",
                fontSize: 13.5,
                color: "var(--ink-2)",
                fontWeight: 700,
              }}
            >
              El expediente no se puede editar durante la validación.
            </div>
          )}

          {/* Error card */}
          {isError && (
            <div
              style={{
                background: "var(--red-soft)",
                border: "1.5px solid var(--red)",
                borderRadius: 12,
                padding: "14px 18px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <p style={{ fontSize: 14, fontWeight: 800, color: "var(--red)", margin: 0 }}>
                Error de envío
              </p>
              <p style={{ fontSize: 13, color: "var(--ink-2)", margin: 0 }}>
                {current.error ?? "El SaaS devolvió un error. Revisa la configuración."}
              </p>
              {current.error?.includes("401") ? (
                <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: 0, fontStyle: "italic" }}>
                  Requiere atención del administrador.
                </p>
              ) : (
                <div>
                  <GhostBtn
                    size="md"
                    full={false}
                    disabled={!canSend.allowed || busySend}
                    onClick={handleSendToLawyer}
                  >
                    {busySend ? "Reintentando…" : "Reintentar envío"}
                  </GhostBtn>
                </div>
              )}
            </div>
          )}

          {/* No compiled expediente */}
          {!compiledExpedienteId && !inProgress && !isValidated && !isReturned && !isError && (
            <div style={{ fontSize: 13, color: "var(--ink-2)" }}>
              <Link href={"/legal/expediente/" + caseId} style={{ color: "var(--accent)", fontWeight: 700 }}>
                Compila el expediente para enviarlo
              </Link>
            </div>
          )}

          {/* Send to lawyer — primary CTA when there's a compiled exp + no active validation */}
          {canSend.allowed && !isValidated && !isReturned && !isError && !inProgress && (
            <div>
              <GradientBtn size="md" full={false} disabled={busySend} onClick={handleSendToLawyer}>
                {busySend ? "Enviando…" : "Enviar a abogado"}
              </GradientBtn>
            </div>
          )}
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* ZONA 2 — Veredicto VALIDADO                                          */}
      {/* ------------------------------------------------------------------ */}
      {isValidated && (
        <div
          style={{
            background: "var(--green-soft)",
            border: "2px solid var(--green)",
            borderRadius: 16,
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Animated check */}
            <span
              className="anim-check-pop"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                borderRadius: 999,
                background: "var(--green)",
                flexShrink: 0,
              }}
              aria-hidden="true"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
            <div>
              <p
                style={{
                  fontSize: 16,
                  fontWeight: 900,
                  color: "var(--green)",
                  margin: 0,
                  fontFamily: "var(--font-title)",
                }}
              >
                {"El abogado validó el expediente (intento " + String(current.attempt_no) + ")"}
              </p>
              {current.verdict_at && (
                <p style={{ fontSize: 12, color: "var(--ink-2)", margin: 0 }}>
                  {formatDate(current.verdict_at)}
                </p>
              )}
            </div>
          </div>

          {current.verdict_notes && (
            <p style={{ fontSize: 13.5, color: "var(--ink-2)", margin: 0, lineHeight: 1.6 }}>
              {current.verdict_notes}
            </p>
          )}

          <div>
            <GradientBtn size="md" full={false} disabled title="Disponible en la próxima ola (F5-Ola3)">
              Enviar a Andrium
            </GradientBtn>
            <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>
              Próximamente disponible (F5-Ola3)
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* ZONA 3 — Veredicto DEVUELTO con correcciones                         */}
      {/* ------------------------------------------------------------------ */}
      {isReturned && (
        <Card>
          <div style={{ padding: 4, display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <p
                style={{
                  fontSize: 15,
                  fontWeight: 900,
                  color: "var(--ink)",
                  margin: 0,
                  fontFamily: "var(--font-title)",
                  flex: 1,
                }}
              >
                {"El abogado devolvió el intento " +
                  String(current.attempt_no) +
                  " con " +
                  String(findings.length) +
                  " hallazgo" +
                  (findings.length !== 1 ? "s" : "")}
              </p>
              {current.return_to && (
                <Chip tone={current.return_to === "client" ? "gold" : "blue"}>
                  {current.return_to === "client" ? "Requiere al cliente" : "Devuelto al equipo"}
                </Chip>
              )}
            </div>

            {/* Lawyer notes */}
            {current.verdict_notes && (
              <p
                style={{
                  fontSize: 14,
                  color: "var(--ink-2)",
                  margin: 0,
                  lineHeight: 1.7,
                  padding: "12px 16px",
                  background: "var(--blue-soft)",
                  borderRadius: 10,
                  borderLeft: "3px solid var(--accent)",
                }}
              >
                {current.verdict_notes}
              </p>
            )}

            {/* Client correction banner */}
            {current.return_to === "client" && (
              <div
                style={{
                  background: "var(--gold-soft)",
                  border: "1.5px solid var(--gold-deep)",
                  borderRadius: 10,
                  padding: "10px 16px",
                  fontSize: 13.5,
                  color: "var(--gold-deep)",
                  fontWeight: 700,
                }}
              >
                Parte de la corrección depende del cliente: pide la re-subida (RFE) o los datos por mensaje.
              </div>
            )}

            {/* Findings — sorted by severity */}
            {findings.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: "var(--ink-2)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    margin: 0,
                  }}
                >
                  Hallazgos accionables
                </p>
                {sortFindings(findings).map((finding, idx) => (
                  <FindingCard
                    key={String(idx)}
                    finding={finding}
                    index={idx}
                    caseId={caseId}
                  />
                ))}
              </div>
            )}

            {/* CTA — Crear intento de corrección */}
            <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
              <GradientBtn
                size="md"
                full={false}
                onClick={() => setShowCorrectionModal(true)}
                disabled={busyCorrection}
              >
                Crear intento de corrección
              </GradientBtn>
            </div>
          </div>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* ZONA 4 — Timeline de intentos                                        */}
      {/* ------------------------------------------------------------------ */}
      {validations.length > 0 && (
        <Card>
          <div style={{ padding: 4 }}>
            <p
              style={{
                fontSize: 15,
                fontWeight: 900,
                color: "var(--ink)",
                fontFamily: "var(--font-title)",
                marginBottom: 16,
              }}
            >
              Historial de intentos
            </p>
            <Timeline groups={timelineGroups} />
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Back link
// ---------------------------------------------------------------------------

function BackLink() {
  return (
    <div style={{ marginBottom: 4 }}>
      <Link
        href="/legal/validaciones"
        style={{
          fontSize: 12.5,
          fontWeight: 700,
          color: "var(--ink-3)",
          textDecoration: "none",
        }}
      >
        {"<- Volver a Validaciones"}
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeFromNow(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return String(mins) + " min";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return String(hrs) + " h";
    return new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  moderate: 1,
  suggestion: 2,
};

function sortFindings(findings: FindingVM[]): FindingVM[] {
  return [...findings].sort((a, b) => {
    const oa = SEVERITY_ORDER[a.severity] ?? 99;
    const ob = SEVERITY_ORDER[b.severity] ?? 99;
    return oa - ob;
  });
}

function buildTimelineGroups(validations: ValidationRowVM[]): TimelineGroup[] {
  // One group per attempt (ascending), each with 1-2 items (sent + verdict)
  const sorted = [...validations].sort((a, b) => a.attempt_no - b.attempt_no);

  return sorted.map((v): TimelineGroup => {
    const verdictPill = STATUS_PILL[v.status];
    const findingsCount = Array.isArray(v.verdict_findings) ? (v.verdict_findings as unknown[]).length : 0;
    const semLabel = v.semaforo === "green" ? "Verde" : v.semaforo === "amber" ? "Ámbar" : v.semaforo === "red" ? "Rojo" : null;

    const items = [];

    // Sent item
    if (v.sent_at) {
      items.push({
        id: v.id + ":sent",
        type: "info" as const,
        icon: "send" as const,
        title: "Enviado al abogado",
        meta: formatDate(v.sent_at),
      });
    }

    // Verdict item
    if (v.verdict_at) {
      const isOk = v.status === "validated";
      const bodyParts: string[] = [];
      if (semLabel) bodyParts.push("Semáforo " + semLabel);
      if (v.ai_score !== null && v.ai_score !== undefined) bodyParts.push("IA: " + String(v.ai_score) + "/100");
      if (findingsCount > 0) bodyParts.push(String(findingsCount) + " hallazgo" + (findingsCount !== 1 ? "s" : ""));

      items.push({
        id: v.id + ":verdict",
        type: isOk ? ("success" as const) : ("warning" as const),
        icon: isOk ? ("check" as const) : ("info" as const),
        title: verdictPill.label,
        meta: formatDate(v.verdict_at),
        body: bodyParts.length > 0 ? (
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {bodyParts.map((p, i) => (
              <span key={i} style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>{p}</span>
            ))}
          </span>
        ) : undefined,
      });
    } else if (v.status !== "pending" && v.status !== "sent") {
      // In progress or error without a verdict_at
      items.push({
        id: v.id + ":status",
        type: v.status === "error" ? ("warning" as const) : ("info" as const),
        icon: v.status === "error" ? ("info" as const) : ("clock" as const),
        title: verdictPill.label,
        meta: v.sent_at ? formatDate(v.sent_at) : undefined,
      });
    }

    return {
      label: "Intento " + String(v.attempt_no),
      items,
    };
  });
}
