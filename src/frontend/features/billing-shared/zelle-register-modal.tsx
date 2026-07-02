"use client";

/**
 * ZelleRegisterModal — staff registers a Zelle payment (RF-AND-012) with a
 * MANDATORY proof upload (Henry 2026-07-02: no Zelle payment without its
 * comprobante). Replaces the notes-only modal that lived in
 * andrium/pagos/pagos-caso-view.tsx; also mounted by the shared-case Pagos tab.
 *
 * Flow: pick file → onGetUploadUrl (signed URL) → PUT file → onConfirm with the
 * storage path (registerZellePayment validates magic bytes server-side).
 * The confirm button stays disabled until a file is selected.
 */

import * as React from "react";
import { GradientBtn, GhostBtn, Icon } from "@/frontend/components/brand";
import { Modal, toast } from "@/frontend/components/desktop";
import {
  usd,
  ZELLE_REGISTER_STRINGS_ES,
  type ZelleRegisterInstallment,
  type ZelleRegisterStrings,
} from "./types";

const PROOF_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";

export function ZelleRegisterModal({
  open,
  onClose,
  installment,
  onGetUploadUrl,
  onConfirm,
  strings = ZELLE_REGISTER_STRINGS_ES,
}: {
  open: boolean;
  onClose: () => void;
  installment: ZelleRegisterInstallment | null;
  /** Returns the signed upload URL + storage path, or null on failure. */
  onGetUploadUrl: (input: {
    installmentId: string;
    filename: string;
    contentType: string;
  }) => Promise<{ signedUrl: string; path: string } | null>;
  /** Parent runs registerZellePayment + toasts + refresh. */
  onConfirm: (input: {
    installmentId: string;
    zelleProofPath: string;
    notes?: string | null;
  }) => Promise<void>;
  strings?: ZelleRegisterStrings;
}) {
  const [notes, setNotes] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!open) {
      setNotes("");
      setFile(null);
      setBusy(false);
    }
  }, [open]);

  if (!installment) return null;

  async function handleConfirm() {
    if (!file) return; // button is disabled without a file; belt & suspenders
    setBusy(true);
    try {
      const upload = await onGetUploadUrl({
        installmentId: installment!.id,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
      });
      if (!upload) {
        toast.error(strings.uploadFailedToast);
        return;
      }

      // PUT to signed URL (same pattern as the client proof upload)
      const uploadResp = await fetch(upload.signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!uploadResp.ok) {
        toast.error(strings.uploadFailedToast);
        return;
      }

      await onConfirm({
        installmentId: installment!.id,
        zelleProofPath: upload.path,
        notes: notes || null,
      });
    } catch {
      toast.error(strings.uploadFailedToast);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title={strings.title}
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <GhostBtn size="md" full={false} onClick={onClose} disabled={busy}>
            {strings.cancelBtn}
          </GhostBtn>
          <GradientBtn size="md" full={false} onClick={handleConfirm} disabled={busy || !file}>
            {busy ? strings.registering : strings.confirmBtn}
          </GradientBtn>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ padding: "12px 14px", background: "var(--hover, rgba(47,107,255,0.04))", borderRadius: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>
            {strings.installmentAmountLabel}
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
          {strings.noPartialWarning}
        </div>

        {/* Mandatory proof upload */}
        <div>
          <label
            htmlFor="zelle-proof-file"
            style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 6 }}
          >
            {strings.proofLabel}
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderRadius: 10,
              border: file ? "1.5px solid var(--green)" : "1.5px dashed var(--line)",
              padding: "10px 12px",
              cursor: busy ? "default" : "pointer",
              background: "var(--card)",
            }}
          >
            <Icon name={file ? "check" : "doc"} size={18} color={file ? "var(--green)" : "var(--ink-3)"} />
            <span
              style={{
                fontSize: 13,
                color: file ? "var(--ink)" : "var(--ink-3)",
                fontWeight: file ? 600 : 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {file ? file.name : strings.chooseFileBtn}
            </span>
            <input
              ref={fileInputRef}
              id="zelle-proof-file"
              type="file"
              accept={PROOF_ACCEPT}
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              style={{ display: "none" }}
            />
          </label>
          <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>
            {strings.proofRequiredHint}
          </p>
        </div>

        <div>
          <label
            htmlFor="zelle-notes"
            style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: 6 }}
          >
            {strings.notesLabel}
          </label>
          <input
            id="zelle-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={strings.notesPlaceholder}
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
