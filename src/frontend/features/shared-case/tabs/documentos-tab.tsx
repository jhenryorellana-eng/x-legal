"use client";

/**
 * Documentos tab (DOC-52 §5.6 / DOC-53 §3.4.2) — the full requirements matrix
 * (the documents the admin defined on the service) grouped by member. Staff
 * (Henry / Vanessa) can UPLOAD a PDF on the client's behalf for a pending/to-fix
 * slot (RF-ADM-008: startUpload → PUT to signed URL → confirmUpload), VIEW the
 * uploaded file, and APPROVE / REJECT (bilingual reason).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { getBridge } from "@/frontend/platform-bridge";
import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { Icon } from "@/frontend/components/brand/icon";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { StatusPill, type StatusKind } from "@/frontend/components/brand/status-pill";
import { Modal } from "@/frontend/components/desktop/modal";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import { toast } from "@/frontend/components/desktop/toast";
import type { CaseWorkspaceVM, CaseDetailActions, DocMatrixVM } from "../types";
import type { CasosStrings } from "../strings";
import { SectionLabel } from "../ui";

const MAX_BYTES = 20 * 1024 * 1024;

function statusLabel(s: DocMatrixVM["status"], t: CasosStrings["detail"]): string {
  if (s === "pendiente") return t.docPending;
  if (s === "revision") return t.docStatus.uploaded;
  if (s === "aprobado") return t.docStatus.approved;
  return t.docStatus.rejected; // corregir
}

export function DocumentosTab({
  vm,
  actions,
  strings,
}: {
  vm: CaseWorkspaceVM;
  actions: CaseDetailActions;
  strings: CasosStrings;
}) {
  const t = strings.detail;
  const router = useRouter();
  const [rejecting, setRejecting] = React.useState<DocMatrixVM | null>(null);
  const [reasonEs, setReasonEs] = React.useState("");
  const [reasonEn, setReasonEn] = React.useState("");
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  async function onView(documentId: string) {
    const res = await actions.getDocumentUrl({ documentId });
    if (res.ok && res.url) getBridge().share.openExternal(res.url);
    else toast.error(strings.errorTitle);
  }

  async function onApprove(item: DocMatrixVM) {
    if (!item.documentId) return;
    setBusyKey(item.key);
    const res = await actions.reviewDocument({ documentId: item.documentId, verdict: "approve" });
    setBusyKey(null);
    if (res.ok) {
      toast.success(t.approved);
      router.refresh();
    } else toast.error(strings.errorTitle);
  }

  async function onConfirmReject() {
    if (!rejecting?.documentId) return;
    if (!reasonEs.trim() && !reasonEn.trim()) return;
    setBusyKey(rejecting.key);
    const res = await actions.reviewDocument({
      documentId: rejecting.documentId,
      verdict: "reject",
      reason: { es: reasonEs.trim(), en: reasonEn.trim() },
    });
    setBusyKey(null);
    if (res.ok) {
      toast.success(t.rejected);
      setRejecting(null);
      setReasonEs("");
      setReasonEn("");
      router.refresh();
    } else toast.error(strings.errorTitle);
  }

  // Group by party (null party → general bucket, rendered first).
  const groups = new Map<string | null, DocMatrixVM[]>();
  for (const item of vm.requirements) {
    const arr = groups.get(item.partyName) ?? [];
    arr.push(item);
    groups.set(item.partyName, arr);
  }

  return (
    <Card>
      <SectionLabel icon="doc">{t.docsTitle}</SectionLabel>

      {vm.requirements.length === 0 ? (
        <div style={{ marginTop: 14 }}>
          <EmptyState title={t.docsMatrixEmpty} mood="calma" lexSize={104} />
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          {[...groups.entries()].map(([party, list]) => (
            <div key={party ?? "_general"}>
              {party && (
                <div className="member-head">
                  <span aria-hidden="true" className="member-av">
                    {party.charAt(0).toUpperCase()}
                  </span>
                  {party}
                </div>
              )}
              {list.map((item) => (
                <div key={item.key} className="doc-row">
                  <span aria-hidden="true" className="doc-ico">
                    <Icon name="doc" size={20} color="var(--brand-red)" />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="doc-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.label}
                      {!item.isRequired && (
                        <span style={{ marginLeft: 8 }}>
                          <Chip tone="blue">{t.optional}</Chip>
                        </span>
                      )}
                    </p>
                    {item.status === "corregir" && item.rejectionReason && (
                      <p className="doc-meta" style={{ color: "var(--brand-red)" }}>
                        {t.docReason}: {item.rejectionReason}
                      </p>
                    )}
                  </div>

                  <StatusPill kind={item.status as StatusKind}>{statusLabel(item.status, t)}</StatusPill>

                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    {(item.status === "pendiente" || item.status === "corregir") && (
                      <UploadButton
                        item={item}
                        caseId={vm.header.caseId}
                        actions={actions}
                        strings={strings}
                        busy={busyKey === item.key}
                        setBusy={(b) => setBusyKey(b ? item.key : null)}
                        onDone={() => router.refresh()}
                      />
                    )}
                    {item.documentId && (
                      <GhostBtn size="md" full={false} icon="external" onClick={() => onView(item.documentId!)}>
                        {t.view}
                      </GhostBtn>
                    )}
                    {item.status === "revision" && item.documentId && (
                      <>
                        <GradientBtn size="sm" full={false} icon="check" disabled={busyKey === item.key} onClick={() => onApprove(item)}>
                          {t.approve}
                        </GradientBtn>
                        <GhostBtn
                          size="md"
                          full={false}
                          icon="x"
                          onClick={() => {
                            setReasonEs("");
                            setReasonEn("");
                            setRejecting(item);
                          }}
                        >
                          {t.reject}
                        </GhostBtn>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={rejecting !== null}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={t.rejectTitle}
        tone="var(--red)"
        footer={
          <>
            <GhostBtn size="md" full={false} onClick={() => setRejecting(null)}>
              {strings.cancel}
            </GhostBtn>
            <GradientBtn
              size="md"
              full={false}
              c1="var(--red)"
              c2="var(--red)"
              disabled={(!reasonEs.trim() && !reasonEn.trim()) || busyKey !== null}
              onClick={onConfirmReject}
            >
              {t.rejectConfirm}
            </GradientBtn>
          </>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label={t.rejectReasonEs} value={reasonEs} onChange={setReasonEs} />
          <Field label={t.rejectReasonEn} value={reasonEn} onChange={setReasonEn} />
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>{t.rejectNote}</p>
      </Modal>
    </Card>
  );
}

function UploadButton({
  item,
  caseId,
  actions,
  strings,
  busy,
  setBusy,
  onDone,
}: {
  item: DocMatrixVM;
  caseId: string;
  actions: CaseDetailActions;
  strings: CasosStrings;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onDone: () => void;
}) {
  const t = strings.detail;
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) return toast.error(t.uploadErrPdf);
    if (file.size > MAX_BYTES) return toast.error(t.uploadErrBig);

    setBusy(true);
    const started = await actions.startUpload({
      caseId,
      requirementId: item.requirementId,
      partyId: item.partyId,
      filename: file.name,
      mimeType: file.type || "application/pdf",
      sizeBytes: file.size,
    });
    if (!started.ok || !started.signedUrl || !started.uploadRef) {
      setBusy(false);
      return toast.error(t.uploadErr);
    }
    try {
      const res = await fetch(started.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/pdf" },
        body: file,
      });
      if (!res.ok) throw new Error("put_failed");
    } catch {
      setBusy(false);
      return toast.error(t.uploadErr);
    }
    const confirmed = await actions.confirmUpload({
      caseId,
      uploadRef: started.uploadRef,
      requirementId: item.requirementId,
      partyId: item.partyId,
      originalFilename: file.name,
    });
    setBusy(false);
    if (!confirmed.ok) return toast.error(t.uploadErr);
    toast.success(t.uploadDone);
    onDone();
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={onPick} />
      <GradientBtn size="sm" full={false} icon="upload" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? t.uploading : t.uploadDoc}
      </GradientBtn>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink-2)" }}>{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        style={{
          resize: "vertical",
          borderRadius: 12,
          border: "1px solid var(--line)",
          background: "var(--card)",
          color: "var(--ink)",
          padding: "10px 12px",
          fontSize: 14,
          fontFamily: "var(--font-body)",
          lineHeight: 1.5,
        }}
      />
    </label>
  );
}
