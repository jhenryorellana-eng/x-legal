"use client";

/**
 * ZelleVerifyPanel — SidePanel to review + approve/reject a pending Zelle proof
 * (RF-AND-011). Extracted from andrium/pagos/pagos-caso-view.tsx; also mounted
 * by the shared-case Pagos tab (admin / ventas / finance — Henry 2026-07-02).
 *
 * Contract: onApprove/onReject resolve when the parent finished the action
 * (parent owns toasts + refresh); onLoadProof returns the signed proof URL or
 * null when it could not be loaded.
 */

import * as React from "react";
import { GradientBtn, GhostBtn } from "@/frontend/components/brand";
import { SidePanel, toast } from "@/frontend/components/desktop";
import { ZelleProofViewer } from "./zelle-proof-viewer";
import {
  usd,
  ZELLE_VERIFY_STRINGS_ES,
  type ZelleProofView,
  type ZelleVerifyPayment,
  type ZelleVerifyStrings,
} from "./types";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{value}</span>
    </div>
  );
}

export function ZelleVerifyPanel({
  open,
  onClose,
  payment,
  onApprove,
  onReject,
  onLoadProof,
  strings = ZELLE_VERIFY_STRINGS_ES,
}: {
  open: boolean;
  onClose: () => void;
  payment: ZelleVerifyPayment | null;
  onApprove: (paymentId: string) => Promise<void>;
  onReject: (paymentId: string, reason: string) => Promise<void>;
  onLoadProof: (paymentId: string) => Promise<ZelleProofView | null>;
  strings?: ZelleVerifyStrings;
}) {
  const [rejectMode, setRejectMode] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busyApprove, setBusyApprove] = React.useState(false);
  const [busyReject, setBusyReject] = React.useState(false);
  const [proof, setProof] = React.useState<ZelleProofView | null>(null);
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
    if (!reason.trim()) { toast.error(strings.reasonRequiredToast); return; }
    setBusyReject(true);
    try { await onReject(payment!.id, reason); } finally { setBusyReject(false); }
  }

  return (
    <SidePanel
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title={strings.title}
      subtitle={`${strings.zelleLabel} · ${usd(payment.amountCents)}`}
      footer={
        rejectMode ? (
          <div style={{ display: "flex", gap: 10, padding: "0 0 4px" }}>
            <GhostBtn
              size="md"
              full={false}
              onClick={() => setRejectMode(false)}
              disabled={busyReject}
            >
              {strings.backBtn}
            </GhostBtn>
            <GhostBtn
              size="md"
              full={false}
              color="var(--red)"
              onClick={handleReject}
              disabled={busyReject || !reason.trim()}
            >
              {busyReject ? strings.rejecting : strings.rejectBtn}
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
              {strings.rejectBtn}
            </GhostBtn>
            <GradientBtn
              size="md"
              full={false}
              onClick={handleApprove}
              disabled={busyApprove}
            >
              {busyApprove ? strings.approving : strings.approveBtn}
            </GradientBtn>
          </div>
        )
      }
    >
      <div style={{ padding: "4px 0", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Comprobante (signed URL — bucket payment-proofs, RF-AND-011) */}
        <ZelleProofViewer proof={proof} loading={proofLoading} error={proofError} strings={strings} />

        {/* Metadata */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Row label={strings.amountLabel} value={usd(payment.amountCents)} />
          <Row label={strings.methodLabel} value="Zelle" />
          <Row label={strings.statusLabel} value={payment.statusLabel} />
          <Row
            label={strings.uploadedLabel}
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
          {strings.guidance}
        </div>

        {/* Reject form */}
        {rejectMode && (
          <div>
            <label
              htmlFor="reject-reason"
              style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 6 }}
            >
              {strings.rejectReasonLabel}
            </label>
            <textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={strings.rejectReasonPlaceholder}
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
              {strings.rejectReasonHint}
            </p>
          </div>
        )}
      </div>
    </SidePanel>
  );
}
