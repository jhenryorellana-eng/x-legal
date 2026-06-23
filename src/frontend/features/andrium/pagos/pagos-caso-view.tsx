"use client";

/**
 * PagosCasoView — `/finanzas/pagos/caso/[caseId]` (Andrium · finance).
 *
 * Per-case account statement with:
 *  - Header: client + case + StatusPill
 *  - Plan card: total + ProgressBar (paid/pending/overdue/waived)
 *  - Installments table with expandable payment rows
 *  - Action menu per installment (Stripe, Zelle verify, Zelle register, Waive, Reschedule)
 *  - Overlays: Modal Stripe, SidePanel verify-Zelle, Modal register-Zelle, Modal waive, Modal reschedule
 *
 * Sources of truth:
 *  - DOC-55-UI-ANDRIUM §3.5–3.7, §3.10
 *  - PROMPT-AND-03 overlay "Estado de cuenta por caso"
 *  - RF-AND-008–022
 *
 * Boundaries: MUST NOT import from @/backend. Types flow via VM props.
 */

import * as React from "react";
import Link from "next/link";
import { getBridge } from "@/frontend/platform-bridge";
import {
  Card,
  GradientBtn,
  GhostBtn,
  StatusPill,
  Chip,
  Lex,
  Icon,
  type StatusKind,
} from "@/frontend/components/brand";
import {
  Modal,
  SidePanel,
  toast,
} from "@/frontend/components/desktop";
// BillingResult defined locally (no app/ boundary cross — MEMORY: boundaries rule)
// Mirrors actions.ts shape: { ok: true, data? } | { ok: false, error: { code } }

// ---------------------------------------------------------------------------
// BillingResult — mirrors actions.ts shape (defined locally: no app/ cross-boundary)
// ---------------------------------------------------------------------------

export interface BillingResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string };
}

// ---------------------------------------------------------------------------
// VM types (no backend imports — types defined here as frontend VM)
// ---------------------------------------------------------------------------

export interface PaymentVM {
  id: string;
  method: "stripe" | "zelle";
  status: "pending" | "succeeded" | "failed" | "rejected" | "refunded";
  amountCents: number;
  createdAt: string;
  confirmedAt: string | null;
}

export interface InstallmentVM {
  id: string;
  number: number;
  isDownpayment: boolean;
  amountCents: number;
  dueDate: string;
  status: "pending" | "processing" | "paid" | "overdue" | "waived";
  paidAt: string | null;
  payments: PaymentVM[];
}

export interface PagosCasoVM {
  caseId: string;
  plan: {
    totalCents: number;
    downpaymentCents: number;
    installmentCount: number;
    notes: string | null;
  } | null;
  installments: InstallmentVM[];
  aggregates: {
    paidCents: number;
    pendingCents: number;
    overdueCents: number;
    waivedCents: number;
    totalCents: number;
  };
  /** paymentId from deep-link ?paymentId= — opens Zelle verify panel on mount */
  focusedPaymentId: string | null;
  loadError: boolean;
}

// ---------------------------------------------------------------------------
// Actions (injected from server component — server action references)
// ---------------------------------------------------------------------------

export interface PagosCasoActions {
  createInstallmentCheckout: (installmentId: string) => Promise<BillingResult<{ url: string }>>;
  confirmZellePayment: (paymentId: string) => Promise<BillingResult>;
  rejectZelleProof: (input: { paymentId: string; reason: string }) => Promise<BillingResult>;
  registerZellePayment: (input: {
    installmentId: string;
    zelleProofPath?: string | null;
    notes?: string | null;
  }) => Promise<BillingResult>;
  getZelleProofUploadUrl: (input: {
    installmentId: string;
    filename: string;
    contentType: string;
  }) => Promise<BillingResult<{ signedUrl: string; path: string }>>;
  getZelleProofViewUrl: (
    paymentId: string,
  ) => Promise<BillingResult<{ url: string; kind: "image" | "pdf" }>>;
  rescheduleInstallment: (input: {
    installmentId: string;
    newDueDate: string;
  }) => Promise<BillingResult>;
  waiveInstallment: (input: {
    installmentId: string;
    reason: string;
  }) => Promise<BillingResult>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});
const usd = (cents: number) => USD.format(cents / 100);

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function daysUntil(dueDateStr: string): number {
  const due = new Date(dueDateStr + "T23:59:59");
  return Math.round((due.getTime() - Date.now()) / 86_400_000);
}

// Error code → readable toast message
function billingErrorMessage(code: string): string {
  const MAP: Record<string, string> = {
    PAYMENT_IN_PROGRESS: "Ya hay un cobro en curso para esta cuota.",
    INSTALLMENT_ALREADY_PAID: "Esta cuota ya fue pagada.",
    INSTALLMENT_NOT_PAYABLE: "Esta cuota no se puede cobrar en este estado.",
    INSTALLMENT_NOT_RESCHEDULABLE: "Esta cuota no se puede reprogramar.",
    INSTALLMENT_NOT_WAIVABLE: "Esta cuota no se puede condonar.",
    WAIVE_REQUIRES_ADMIN: "Solo el Admin puede condonar la cuota inicial de un caso sin arrancar.",
    WAIVE_REASON_REQUIRED: "El motivo es obligatorio para condonar.",
    REJECTION_REASON_REQUIRED: "El motivo del rechazo es obligatorio.",
    PAYMENT_NOT_PENDING: "El pago ya fue verificado (estado actualizado).",
    AMOUNT_MISMATCH: "El monto no coincide (sin pagos parciales en V2).",
    DUE_DATE_INVALID: "La fecha debe ser futura.",
    NOT_IMPLEMENTED: "Esta acción estará disponible próximamente.",
    UNEXPECTED: "Algo salió mal. Intenta de nuevo.",
  };
  return MAP[code] ?? `Error: ${code}`;
}

// ---------------------------------------------------------------------------
// StatusPill mapping for installment status
// ---------------------------------------------------------------------------

const INSTALL_STATUS: Record<
  InstallmentVM["status"],
  { kind: StatusKind; label: string }
> = {
  pending: { kind: "pendiente", label: "Pendiente" },
  processing: { kind: "revision", label: "En proceso" },
  paid: { kind: "hecho", label: "Pagada" },
  overdue: { kind: "corregir", label: "Vencida" },
  waived: { kind: "aprobado", label: "Condonada" },
};

// Payment status chip
const PAY_STATUS: Record<
  PaymentVM["status"],
  { tone: "blue" | "green" | "red"; label: string }
> = {
  pending: { tone: "blue", label: "En curso" },
  succeeded: { tone: "green", label: "Confirmado" },
  failed: { tone: "red", label: "Fallido" },
  rejected: { tone: "red", label: "Rechazado" },
  refunded: { tone: "blue", label: "Reembolsado" },
};

// ---------------------------------------------------------------------------
// Modal: Cobrar por Stripe
// ---------------------------------------------------------------------------

function StripeModal({
  open,
  onClose,
  installment,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  installment: InstallmentVM | null;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  if (!installment) return null;

  return (
    <Modal
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title="Cobrar por Stripe"
      description="Se enviará un enlace de pago al cliente."
      tone="var(--accent)"
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <GhostBtn size="md" full={false} onClick={onClose} disabled={busy}>
            Cancelar
          </GhostBtn>
          <GradientBtn size="md" full={false} onClick={handleConfirm} disabled={busy}>
            {busy ? "Generando…" : "Generar enlace"}
          </GradientBtn>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ padding: "12px 14px", background: "var(--hover, rgba(47,107,255,0.04))", borderRadius: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>
            Cuota {installment.number}
            {installment.isDownpayment && " · Inicial"}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: "var(--ink)" }}>
            {usd(installment.amountCents)}
          </p>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-2)", margin: 0 }}>
          El cliente recibirá el enlace para pagar desde su app. La cuota pasará a &ldquo;En proceso&rdquo;.
        </p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Modal: Stripe success (link generated)
// ---------------------------------------------------------------------------

function StripeSuccessModal({
  open,
  onClose,
  url,
}: {
  open: boolean;
  onClose: () => void;
  url: string;
}) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    await getBridge().share.copyText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title="Enlace de pago enviado al cliente"
      tone="var(--green)"
      footer={
        <GradientBtn size="md" full={false} onClick={onClose}>
          Cerrar
        </GradientBtn>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--ink-2)", margin: 0 }}>
          El cliente recibirá el enlace en su app. También puedes copiarlo para reenviarlo por otro canal.
        </p>
        <div
          style={{
            padding: "10px 14px",
            background: "var(--green-soft)",
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: 12,
              color: "var(--green)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "monospace",
            }}
          >
            {url}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--green)",
              padding: 4,
              flexShrink: 0,
            }}
            aria-label="Copiar enlace"
          >
            <Icon name="copy" size={18} color="var(--green)" />
          </button>
        </div>
        {copied && (
          <p style={{ fontSize: 12, color: "var(--green)", margin: 0 }}>
            ✓ Enlace copiado
          </p>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// SidePanel: Verificar comprobante Zelle (RF-AND-011)
// ---------------------------------------------------------------------------

function ZelleVerifyPanel({
  open,
  onClose,
  payment,
  onApprove,
  onReject,
  onLoadProof,
}: {
  open: boolean;
  onClose: () => void;
  payment: PaymentVM | null;
  onApprove: (paymentId: string) => Promise<void>;
  onReject: (paymentId: string, reason: string) => Promise<void>;
  onLoadProof: (
    paymentId: string,
  ) => Promise<{ url: string; kind: "image" | "pdf" } | null>;
}) {
  const [rejectMode, setRejectMode] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busyApprove, setBusyApprove] = React.useState(false);
  const [busyReject, setBusyReject] = React.useState(false);
  const [proof, setProof] = React.useState<{ url: string; kind: "image" | "pdf" } | null>(null);
  const [proofLoading, setProofLoading] = React.useState(false);
  const [proofError, setProofError] = React.useState(false);

  const paymentId = payment?.id ?? null;

  React.useEffect(() => {
    if (!open) {
      setRejectMode(false);
      setReason("");
      setProof(null);
      setProofError(false);
    }
  }, [open]);

  // Load the uploaded proof (signed URL from bucket payment-proofs) when opened.
  React.useEffect(() => {
    if (!open || !paymentId) return;
    let cancelled = false;
    setProof(null);
    setProofError(false);
    setProofLoading(true);
    onLoadProof(paymentId)
      .then((res) => {
        if (cancelled) return;
        if (res) setProof(res);
        else setProofError(true);
      })
      .catch(() => { if (!cancelled) setProofError(true); })
      .finally(() => { if (!cancelled) setProofLoading(false); });
    return () => { cancelled = true; };
  }, [open, paymentId, onLoadProof]);

  if (!payment) return null;

  async function handleApprove() {
    setBusyApprove(true);
    try { await onApprove(payment!.id); } finally { setBusyApprove(false); }
  }

  async function handleReject() {
    if (!reason.trim()) { toast.error("El motivo es obligatorio"); return; }
    setBusyReject(true);
    try { await onReject(payment!.id, reason); } finally { setBusyReject(false); }
  }

  return (
    <SidePanel
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title="Verificar comprobante"
      subtitle={`Pago Zelle · ${usd(payment.amountCents)}`}
      footer={
        rejectMode ? (
          <div style={{ display: "flex", gap: 10, padding: "0 0 4px" }}>
            <GhostBtn
              size="md"
              full={false}
              onClick={() => setRejectMode(false)}
              disabled={busyReject}
            >
              Atrás
            </GhostBtn>
            <GhostBtn
              size="md"
              full={false}
              color="var(--red)"
              onClick={handleReject}
              disabled={busyReject || !reason.trim()}
            >
              {busyReject ? "Rechazando…" : "Rechazar"}
            </GhostBtn>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, padding: "0 0 4px" }}>
            <GhostBtn
              size="md"
              full={false}
              color="var(--red)"
              onClick={() => setRejectMode(true)}
              disabled={busyApprove}
            >
              Rechazar
            </GhostBtn>
            <GradientBtn
              size="md"
              full={false}
              onClick={handleApprove}
              disabled={busyApprove}
            >
              {busyApprove ? "Aprobando…" : "Aprobar pago"}
            </GradientBtn>
          </div>
        )
      }
    >
      <div style={{ padding: "4px 0", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Comprobante (signed URL — bucket payment-proofs, RF-AND-011) */}
        <div
          style={{
            background: "var(--hover, rgba(47,107,255,0.04))",
            borderRadius: 12,
            minHeight: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1.5px dashed var(--line)",
            overflow: "hidden",
          }}
        >
          {proofLoading ? (
            <p style={{ fontSize: 12, color: "var(--ink-3)" }}>Cargando comprobante…</p>
          ) : proofError ? (
            <div style={{ textAlign: "center" }}>
              <Icon name="doc" size={36} color="var(--ink-3)" />
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
                No se pudo cargar el comprobante
              </p>
            </div>
          ) : proof && proof.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private bucket; next/image remotePatterns not configured for storage
            <img
              src={proof.url}
              alt="Comprobante de pago Zelle"
              style={{ width: "100%", maxHeight: 360, objectFit: "contain", display: "block" }}
            />
          ) : proof && proof.kind === "pdf" ? (
            <iframe
              src={proof.url}
              title="Comprobante de pago Zelle"
              style={{ width: "100%", height: 360, border: "none" }}
            />
          ) : (
            <div style={{ textAlign: "center" }}>
              <Icon name="doc" size={36} color="var(--ink-3)" />
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
                Sin comprobante
              </p>
            </div>
          )}
        </div>

        {/* Metadata */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Row label="Monto" value={usd(payment.amountCents)} />
          <Row label="Método" value="Zelle" />
          <Row label="Estado" value={PAY_STATUS[payment.status].label} />
          <Row
            label="Subido"
            value={new Date(payment.createdAt).toLocaleString("es-US", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          />
        </div>

        {/* Cotejo guiado */}
        <div
          style={{
            padding: "10px 12px",
            background: "var(--gold-soft)",
            borderRadius: 10,
            fontSize: 13,
            color: "var(--gold-deep)",
          }}
        >
          Verifica que el monto y la referencia del comprobante coincidan con los datos de la cuota.
        </div>

        {/* Reject form */}
        {rejectMode && (
          <div>
            <label
              htmlFor="reject-reason"
              style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 6 }}
            >
              Motivo del rechazo (el cliente lo verá) *
            </label>
            <textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Escribe el motivo para que el cliente corrija y vuelva a subir…"
              style={{
                width: "100%",
                borderRadius: 10,
                border: "1.5px solid var(--line)",
                padding: "10px 12px",
                fontSize: 13,
                color: "var(--ink)",
                background: "var(--card)",
                resize: "vertical",
                fontFamily: "inherit",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>
              El cliente recibirá este motivo para corregir y volver a subir su comprobante.
            </p>
          </div>
        )}
      </div>
    </SidePanel>
  );
}

// ---------------------------------------------------------------------------
// Modal: Registrar Zelle (RF-AND-012)
// ---------------------------------------------------------------------------

function ZelleRegisterModal({
  open,
  onClose,
  installment,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  installment: InstallmentVM | null;
  onConfirm: (input: { installmentId: string; zelleProofPath?: string | null; notes?: string | null }) => Promise<void>;
}) {
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) { setNotes(""); }
  }, [open]);

  if (!installment) return null;

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm({ installmentId: installment!.id, notes: notes || null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title="Registrar Zelle"
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <GhostBtn size="md" full={false} onClick={onClose} disabled={busy}>
            Cancelar
          </GhostBtn>
          <GradientBtn size="md" full={false} onClick={handleConfirm} disabled={busy}>
            {busy ? "Registrando…" : "Confirmar pago"}
          </GradientBtn>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ padding: "12px 14px", background: "var(--hover, rgba(47,107,255,0.04))", borderRadius: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>
            Monto de la cuota
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: "var(--ink)" }}>
            {usd(installment.amountCents)}
          </p>
        </div>

        <div
          style={{
            padding: "10px 12px",
            background: "var(--gold-soft)",
            borderRadius: 10,
            fontSize: 13,
            color: "var(--gold-deep)",
          }}
        >
          Sin pagos parciales en V2. Si el monto difiere, no se podrá registrar.
        </div>

        <div>
          <label
            htmlFor="zelle-notes"
            style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 6 }}
          >
            Notas (opcional)
          </label>
          <input
            id="zelle-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Referencia, nombre del remitente…"
            style={{
              width: "100%",
              borderRadius: 10,
              border: "1.5px solid var(--line)",
              padding: "10px 12px",
              fontSize: 13,
              color: "var(--ink)",
              background: "var(--card)",
              fontFamily: "inherit",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Modal: Reprogramar (RF-AND-022)
// ---------------------------------------------------------------------------

function RescheduleModal({
  open,
  onClose,
  installment,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  installment: InstallmentVM | null;
  onConfirm: (installmentId: string, newDueDate: string) => Promise<void>;
}) {
  const today = new Date().toISOString().split("T")[0]!;
  const [newDate, setNewDate] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { if (!open) setNewDate(""); }, [open]);
  if (!installment) return null;

  async function handleConfirm() {
    if (!newDate || newDate <= today) {
      toast.error("La fecha debe ser futura.");
      return;
    }
    setBusy(true);
    try { await onConfirm(installment!.id, newDate); } finally { setBusy(false); }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title="Reprogramar vencimiento"
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <GhostBtn size="md" full={false} onClick={onClose} disabled={busy}>
            Cancelar
          </GhostBtn>
          <GradientBtn size="md" full={false} onClick={handleConfirm} disabled={busy || !newDate}>
            {busy ? "Guardando…" : "Reprogramar"}
          </GradientBtn>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label
            htmlFor="new-due-date"
            style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 6 }}
          >
            Nueva fecha de vencimiento
          </label>
          <input
            id="new-due-date"
            type="date"
            min={today}
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            style={{
              width: "100%",
              borderRadius: 10,
              border: "1.5px solid var(--line)",
              padding: "10px 12px",
              fontSize: 14,
              color: "var(--ink)",
              background: "var(--card)",
              fontFamily: "inherit",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
        {installment.status === "overdue" && (
          <div
            style={{
              padding: "10px 12px",
              background: "var(--gold-soft)",
              borderRadius: 10,
              fontSize: 13,
              color: "var(--gold-deep)",
            }}
          >
            Si estaba vencida, volverá a &ldquo;Pendiente&rdquo; al reprogramar.
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Modal: Condonar (RF-AND-019)
// ---------------------------------------------------------------------------

function WaiveModal({
  open,
  onClose,
  installment,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  installment: InstallmentVM | null;
  onConfirm: (installmentId: string, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const isDownpaymentBlock = installment?.isDownpayment ?? false;

  React.useEffect(() => { if (!open) setReason(""); }, [open]);
  if (!installment) return null;

  async function handleConfirm() {
    if (!reason.trim()) {
      toast.error("El motivo es obligatorio para condonar.");
      return;
    }
    setBusy(true);
    try { await onConfirm(installment!.id, reason); } finally { setBusy(false); }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title="Condonar cuota"
      tone="var(--red)"
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <GhostBtn size="md" full={false} onClick={onClose} disabled={busy}>
            Cancelar
          </GhostBtn>
          <GradientBtn
            size="md"
            full={false}
            c1="var(--red)"
            c2="#b91c1c"
            onClick={handleConfirm}
            disabled={busy || isDownpaymentBlock || !reason.trim()}
          >
            {busy ? "Condonando…" : "Condonar cuota"}
          </GradientBtn>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {isDownpaymentBlock && (
          <div
            style={{
              padding: "12px 14px",
              background: "var(--red-soft)",
              borderRadius: 10,
              fontSize: 13,
              color: "var(--red)",
              fontWeight: 700,
            }}
          >
            Solo el Admin puede condonar la cuota inicial de un caso sin arrancar.
          </div>
        )}

        {!isDownpaymentBlock && (
          <>
            <div
              style={{
                padding: "10px 12px",
                background: "var(--red-soft)",
                borderRadius: 10,
                fontSize: 13,
                color: "var(--red)",
              }}
            >
              La cuota saldrá del circuito de cobranza. Esta acción no se puede deshacer.
            </div>

            <div>
              <label
                htmlFor="waive-reason"
                style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 6 }}
              >
                Motivo (obligatorio)
              </label>
              <textarea
                id="waive-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Explica el motivo de la condonación para el historial…"
                style={{
                  width: "100%",
                  borderRadius: 10,
                  border: "1.5px solid var(--line)",
                  padding: "10px 12px",
                  fontSize: 13,
                  color: "var(--ink)",
                  background: "var(--card)",
                  resize: "vertical",
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Action menu (⋯) per installment
// ---------------------------------------------------------------------------

type ActiveOverlay =
  | { kind: "stripe"; installmentId: string }
  | { kind: "stripe-success"; url: string }
  | { kind: "zelle-verify"; paymentId: string }
  | { kind: "zelle-register"; installmentId: string }
  | { kind: "reschedule"; installmentId: string }
  | { kind: "waive"; installmentId: string }
  | null;

function ActionMenu({
  installment,
  onAction,
  onOpenOverlay,
}: {
  installment: InstallmentVM;
  onAction: (kind: "stripe" | "zelle-register" | "reschedule" | "waive") => void;
  onOpenOverlay: (overlay: ActiveOverlay) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const isPayable = installment.status === "pending" || installment.status === "overdue";
  const isProcessing = installment.status === "processing";

  // Find a pending Zelle payment to verify
  const pendingZelle = installment.payments.find(
    (p) => p.method === "zelle" && p.status === "pending",
  );

  return (
    <div style={{ position: "relative" }} ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "none",
          border: "1px solid var(--line)",
          borderRadius: 8,
          width: 32,
          height: 32,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
        }}
        aria-label="Acciones de la cuota"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋯
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 20,
            background: "var(--card)",
            borderRadius: 12,
            boxShadow: "var(--shadow-lg)",
            border: "1px solid var(--line)",
            minWidth: 210,
            padding: "6px 0",
          }}
        >
          {isPayable && (
            <>
              <MenuItem
                label="Cobrar por Stripe"
                icon="card"
                onClick={() => {
                  setOpen(false);
                  onAction("stripe");
                }}
              />
              {pendingZelle && (
                <MenuItem
                  label="Verificar comprobante Zelle"
                  icon="check"
                  onClick={() => {
                    setOpen(false);
                    onOpenOverlay({ kind: "zelle-verify", paymentId: pendingZelle.id });
                  }}
                />
              )}
              <MenuItem
                label="Registrar Zelle"
                icon="wallet"
                onClick={() => {
                  setOpen(false);
                  onAction("zelle-register");
                }}
              />
              <div style={{ borderTop: "1px solid var(--line)", margin: "4px 0" }} />
              <MenuItem
                label="Reprogramar vencimiento"
                icon="calendar"
                onClick={() => {
                  setOpen(false);
                  onAction("reschedule");
                }}
              />
              <MenuItem
                label="Condonar cuota"
                icon="info"
                onClick={() => {
                  setOpen(false);
                  onAction("waive");
                }}
                danger
              />
            </>
          )}
          {isProcessing && (
            <MenuItem
              label="Descartar intento y regenerar"
              icon="x"
              onClick={() => {
                setOpen(false);
                // Re-open stripe modal; backend handles the discard
                onAction("stripe");
              }}
            />
          )}
          {!isPayable && !isProcessing && (
            <div style={{ padding: "8px 14px", fontSize: 13, color: "var(--ink-3)" }}>
              Sin acciones disponibles
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label,
  icon,
  onClick,
  danger,
}: {
  label: string;
  icon: import("@/frontend/components/brand").IconName;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        background: "none",
        border: "none",
        padding: "9px 14px",
        fontSize: 13,
        fontWeight: 600,
        color: danger ? "var(--red)" : "var(--ink)",
        cursor: "pointer",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          "var(--hover, rgba(47,107,255,0.06))";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "none";
      }}
    >
      <Icon name={icon} size={16} color={danger ? "var(--red)" : "var(--ink-3)"} />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helper: small label-value row
// ---------------------------------------------------------------------------

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expandable payment sub-rows
// ---------------------------------------------------------------------------

function PaymentSubRow({ payment }: { payment: PaymentVM }) {
  const ps = PAY_STATUS[payment.status];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 14px 8px 36px",
        background: "var(--hover, rgba(47,107,255,0.04))",
        borderBottom: "1px solid var(--line)",
        fontSize: 12,
      }}
    >
      <Chip tone="blue">{payment.method === "stripe" ? "Stripe" : "Zelle"}</Chip>
      <Chip tone={ps.tone}>{ps.label}</Chip>
      <span style={{ color: "var(--ink-2)", flex: 1 }}>
        {usd(payment.amountCents)}
      </span>
      <span style={{ color: "var(--ink-3)" }}>
        {new Date(payment.createdAt).toLocaleDateString("es-US", {
          day: "2-digit",
          month: "short",
        })}
      </span>
      {payment.confirmedAt && (
        <span style={{ color: "var(--green)", fontSize: 11 }}>
          ✓ {new Date(payment.confirmedAt).toLocaleDateString("es-US", {
            day: "2-digit",
            month: "short",
          })}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Installment row
// ---------------------------------------------------------------------------

function InstallmentRow({
  installment,
  totalCents,
  onOpenOverlay,
}: {
  installment: InstallmentVM;
  totalCents: number;
  onOpenOverlay: (overlay: ActiveOverlay) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const statusEntry = INSTALL_STATUS[installment.status];
  const days = daysUntil(installment.dueDate);
  const hasPayments = installment.payments.length > 0;

  void totalCents; // available for future use

  function handleAction(kind: "stripe" | "zelle-register" | "reschedule" | "waive") {
    if (kind === "stripe") {
      onOpenOverlay({ kind: "stripe", installmentId: installment.id });
    } else if (kind === "zelle-register") {
      onOpenOverlay({ kind: "zelle-register", installmentId: installment.id });
    } else if (kind === "reschedule") {
      onOpenOverlay({ kind: "reschedule", installmentId: installment.id });
    } else if (kind === "waive") {
      onOpenOverlay({ kind: "waive", installmentId: installment.id });
    }
  }

  return (
    <>
      {/* Main row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          borderBottom: "1px solid var(--line)",
          cursor: hasPayments ? "pointer" : "default",
        }}
        onClick={() => { if (hasPayments) setExpanded((v) => !v); }}
        role={hasPayments ? "button" : undefined}
        aria-expanded={hasPayments ? expanded : undefined}
        tabIndex={hasPayments ? 0 : undefined}
        onKeyDown={(e) => {
          if (hasPayments && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
      >
        {/* Expand chevron */}
        <div style={{ width: 20, flexShrink: 0 }}>
          {hasPayments && (
            <Icon
              name={expanded ? "chevD" : "chevR"}
              size={16}
              color="var(--ink-3)"
            />
          )}
        </div>

        {/* Number + Inicial chip */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 110 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
            Cuota {installment.number}
          </span>
          {installment.isDownpayment && (
            <Chip tone="gold">Inicial</Chip>
          )}
        </div>

        {/* Amount */}
        <span style={{ flex: 0, minWidth: 90, fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>
          {usd(installment.amountCents)}
        </span>

        {/* Due date */}
        <span style={{ flex: 1, fontSize: 13, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 6 }}>
          {formatDate(installment.dueDate)}
          {installment.status === "pending" && days === 0 && (
            <Chip tone="gold">Vence hoy</Chip>
          )}
          {installment.status === "pending" && days > 0 && days <= 3 && (
            <Chip tone="gold">Vence en {days} días</Chip>
          )}
        </span>

        {/* Status */}
        <div style={{ flexShrink: 0 }}>
          {installment.status === "waived" ? (
            <Chip tone="blue">Condonada</Chip>
          ) : (
            <StatusPill kind={statusEntry.kind}>{statusEntry.label}</StatusPill>
          )}
        </div>

        {/* Paid at */}
        <span style={{ minWidth: 80, fontSize: 12, color: "var(--ink-3)", flexShrink: 0 }}>
          {installment.paidAt ? formatDate(installment.paidAt) : "—"}
        </span>

        {/* Action menu */}
        <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
          <ActionMenu
            installment={installment}
            onAction={handleAction}
            onOpenOverlay={onOpenOverlay}
          />
        </div>
      </div>

      {/* Expanded payment rows */}
      {expanded && installment.payments.map((p) => (
        <PaymentSubRow key={p.id} payment={p} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export interface PagosCasoViewProps {
  vm: PagosCasoVM;
  actions: PagosCasoActions;
}

export function PagosCasoView({ vm, actions }: PagosCasoViewProps) {
  const [activeOverlay, setActiveOverlay] = React.useState<ActiveOverlay>(null);
  const [stripeSuccessUrl, setStripeSuccessUrl] = React.useState<string | null>(null);

  // Deep-link focus: open zelle verify panel on mount if focusedPaymentId present
  React.useEffect(() => {
    if (vm.focusedPaymentId) {
      setActiveOverlay({ kind: "zelle-verify", paymentId: vm.focusedPaymentId });
    }
  }, [vm.focusedPaymentId]);

  // Helpers to find installment/payment by ID
  function findInstallment(id: string): InstallmentVM | undefined {
    return vm.installments.find((i) => i.id === id);
  }
  function findPayment(id: string): PaymentVM | undefined {
    for (const inst of vm.installments) {
      const p = inst.payments.find((pay) => pay.id === id);
      if (p) return p;
    }
    return undefined;
  }

  // ----- Stripe handler -----
  async function handleStripeConfirm() {
    if (!activeOverlay || activeOverlay.kind !== "stripe") return;
    const res = await actions.createInstallmentCheckout(activeOverlay.installmentId);
    if (res.ok && res.data) {
      setActiveOverlay(null);
      setStripeSuccessUrl(res.data.url);
    } else {
      toast.error(billingErrorMessage(res.error?.code ?? "UNEXPECTED"));
      window.location.reload();
    }
  }

  // ----- Zelle verify handlers -----
  async function handleZelleApprove(paymentId: string) {
    const res = await actions.confirmZellePayment(paymentId);
    if (res.ok) {
      toast.success("✓ Pago confirmado");
      setActiveOverlay(null);
      window.location.reload();
    } else {
      toast.error(billingErrorMessage(res.error?.code ?? "UNEXPECTED"));
      window.location.reload();
    }
  }

  async function handleZelleReject(paymentId: string, reason: string) {
    const res = await actions.rejectZelleProof({ paymentId, reason });
    if (res.ok) {
      toast.success("Comprobante rechazado. El cliente será notificado.");
      setActiveOverlay(null);
      window.location.reload();
    } else {
      toast.error(billingErrorMessage(res.error?.code ?? "UNEXPECTED"));
    }
  }

  // ----- Zelle register handler -----
  async function handleZelleRegister(input: {
    installmentId: string;
    zelleProofPath?: string | null;
    notes?: string | null;
  }) {
    const res = await actions.registerZellePayment(input);
    if (res.ok) {
      toast.success("✓ Pago Zelle registrado");
      setActiveOverlay(null);
      window.location.reload();
    } else {
      toast.error(billingErrorMessage(res.error?.code ?? "UNEXPECTED"));
    }
  }

  // ----- Reschedule handler -----
  async function handleReschedule(installmentId: string, newDueDate: string) {
    const res = await actions.rescheduleInstallment({ installmentId, newDueDate });
    if (res.ok) {
      toast.success("✓ Vencimiento reprogramado");
      setActiveOverlay(null);
      window.location.reload();
    } else {
      toast.error(billingErrorMessage(res.error?.code ?? "UNEXPECTED"));
    }
  }

  // ----- Waive handler -----
  async function handleWaive(installmentId: string, reason: string) {
    const res = await actions.waiveInstallment({ installmentId, reason });
    if (res.ok) {
      toast.success("✓ Cuota condonada");
      setActiveOverlay(null);
      window.location.reload();
    } else {
      toast.error(billingErrorMessage(res.error?.code ?? "UNEXPECTED"));
    }
  }

  // ---- Compute progress bar percentages ----
  const agg = vm.aggregates;
  const total = agg.totalCents || 1; // avoid divide-by-zero
  const paidPct = (agg.paidCents / total) * 100;
  const overduePct = (agg.overdueCents / total) * 100;
  const waivedPct = (agg.waivedCents / total) * 100;
  const pendingPct = 100 - paidPct - overduePct - waivedPct;

  if (vm.loadError) {
    return (
      <div style={{ padding: "48px 32px", textAlign: "center" }}>
        <Lex mood="calma" size={78} />
        <p style={{ marginTop: 16, color: "var(--ink-2)" }}>
          No se pudo cargar el estado de cuenta.
        </p>
        <GhostBtn
          size="md"
          full={false}
          onClick={() => window.location.reload()}
          style={{ marginTop: 12 }}
        >
          Reintentar
        </GhostBtn>
      </div>
    );
  }

  return (
    <div style={{ padding: "32px 32px 64px" }}>
      {/* Back link */}
      <Link
        href="/finanzas/pagos"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--ink-3)",
          fontSize: 13,
          textDecoration: "none",
          marginBottom: 20,
        }}
      >
        <Icon name="arrowL" size={16} color="var(--ink-3)" />
        Pagos y cuotas
      </Link>

      {/* Page title */}
      <h1
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: "var(--ink)",
          margin: "0 0 4px",
          fontFamily: "var(--font-title)",
        }}
      >
        Estado de cuenta
      </h1>
      <p style={{ margin: "0 0 24px", fontSize: 13, color: "var(--ink-3)" }}>
        Caso {vm.caseId}
      </p>

      {/* Plan card */}
      {vm.plan ? (
        <Card style={{ marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 16,
            }}
          >
            <div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", fontWeight: 600 }}>
                Plan de pago
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 900, color: "var(--ink)" }}>
                {usd(vm.plan.totalCents)}
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>
                Inicial: {usd(vm.plan.downpaymentCents)}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
                {vm.plan.installmentCount} cuotas
              </p>
            </div>
          </div>

          {/* Stacked progress bar */}
          <div
            style={{
              background: "var(--line)",
              borderRadius: 999,
              height: 10,
              overflow: "hidden",
              width: "100%",
              marginBottom: 10,
              display: "flex",
            }}
            role="progressbar"
            aria-label="Progreso del plan de pago"
            aria-valuenow={Math.round(paidPct)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              style={{
                width: `${paidPct}%`,
                background: "linear-gradient(90deg, var(--gold), var(--gold-deep))",
                transition: "width 0.9s cubic-bezier(.4,0,.2,1)",
              }}
            />
            <div
              style={{
                width: `${Math.max(0, overduePct)}%`,
                background: "var(--red)",
                transition: "width 0.9s cubic-bezier(.4,0,.2,1)",
              }}
            />
            <div
              style={{
                width: `${Math.max(0, waivedPct)}%`,
                background: "var(--ink-3)",
                transition: "width 0.9s cubic-bezier(.4,0,.2,1)",
              }}
            />
            <div
              style={{
                width: `${Math.max(0, pendingPct)}%`,
                background: "var(--blue-soft)",
              }}
            />
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <LegendItem color="var(--gold-deep)" label="Pagado" value={usd(agg.paidCents)} />
            <LegendItem color="var(--blue-soft)" label="Pendiente" value={usd(agg.pendingCents)} />
            <LegendItem color="var(--red)" label="Vencido" value={usd(agg.overdueCents)} />
            <LegendItem color="var(--ink-3)" label="Condonado" value={usd(agg.waivedCents)} />
            <span style={{ fontSize: 11, color: "var(--ink-3)", alignSelf: "center" }}>
              = {usd(agg.totalCents)} total del plan
            </span>
          </div>

          {vm.plan.notes && (
            <p style={{ marginTop: 12, fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>
              {vm.plan.notes}
            </p>
          )}
        </Card>
      ) : (
        <div
          style={{
            padding: "16px 18px",
            background: "var(--red-soft)",
            borderRadius: 12,
            marginBottom: 24,
            fontSize: 13,
            color: "var(--red)",
            fontWeight: 700,
          }}
        >
          Contrato sin plan de pago — las acciones de cobro están bloqueadas.
        </div>
      )}

      {/* Installments table */}
      {vm.installments.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <Lex mood="calma" size={78} />
          <p style={{ marginTop: 12, color: "var(--ink-2)" }}>Sin cuotas registradas.</p>
        </div>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {/* Table header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              background: "var(--hover, rgba(47,107,255,0.04))",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <div style={{ width: 20 }} />
            <span style={{ minWidth: 110, fontSize: 11, fontWeight: 800, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Cuota
            </span>
            <span style={{ flex: 0, minWidth: 90, fontSize: 11, fontWeight: 800, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Monto
            </span>
            <span style={{ flex: 1, fontSize: 11, fontWeight: 800, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Vencimiento
            </span>
            <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Estado
            </span>
            <span style={{ minWidth: 80, fontSize: 11, fontWeight: 800, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Pagado el
            </span>
            <span style={{ width: 44 }} />
          </div>

          {vm.installments.map((inst) => (
            <InstallmentRow
              key={inst.id}
              installment={inst}
              totalCents={agg.totalCents}
              onOpenOverlay={setActiveOverlay}
            />
          ))}
        </Card>
      )}

      {/* ---- Overlays ---- */}

      {/* Stripe modal */}
      <StripeModal
        open={activeOverlay?.kind === "stripe"}
        onClose={() => setActiveOverlay(null)}
        installment={
          activeOverlay?.kind === "stripe"
            ? (findInstallment(activeOverlay.installmentId) ?? null)
            : null
        }
        onConfirm={handleStripeConfirm}
      />

      {/* Stripe success modal */}
      <StripeSuccessModal
        open={stripeSuccessUrl !== null}
        onClose={() => { setStripeSuccessUrl(null); window.location.reload(); }}
        url={stripeSuccessUrl ?? ""}
      />

      {/* Zelle verify panel */}
      <ZelleVerifyPanel
        open={activeOverlay?.kind === "zelle-verify"}
        onClose={() => setActiveOverlay(null)}
        payment={
          activeOverlay?.kind === "zelle-verify"
            ? (findPayment(activeOverlay.paymentId) ?? null)
            : null
        }
        onApprove={handleZelleApprove}
        onReject={handleZelleReject}
        onLoadProof={async (paymentId) => {
          const res = await actions.getZelleProofViewUrl(paymentId);
          return res.ok && res.data ? res.data : null;
        }}
      />

      {/* Zelle register modal */}
      <ZelleRegisterModal
        open={activeOverlay?.kind === "zelle-register"}
        onClose={() => setActiveOverlay(null)}
        installment={
          activeOverlay?.kind === "zelle-register"
            ? (findInstallment(activeOverlay.installmentId) ?? null)
            : null
        }
        onConfirm={handleZelleRegister}
      />

      {/* Reschedule modal */}
      <RescheduleModal
        open={activeOverlay?.kind === "reschedule"}
        onClose={() => setActiveOverlay(null)}
        installment={
          activeOverlay?.kind === "reschedule"
            ? (findInstallment(activeOverlay.installmentId) ?? null)
            : null
        }
        onConfirm={handleReschedule}
      />

      {/* Waive modal */}
      <WaiveModal
        open={activeOverlay?.kind === "waive"}
        onClose={() => setActiveOverlay(null)}
        installment={
          activeOverlay?.kind === "waive"
            ? (findInstallment(activeOverlay.installmentId) ?? null)
            : null
        }
        onConfirm={handleWaive}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend item
// ---------------------------------------------------------------------------

function LegendItem({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: color,
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
        {label}{" "}
        <span style={{ fontWeight: 700, color: "var(--ink)" }}>{value}</span>
      </span>
    </div>
  );
}
