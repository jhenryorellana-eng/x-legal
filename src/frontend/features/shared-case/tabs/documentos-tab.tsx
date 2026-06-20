"use client";

/**
 * Documentos tab — review queue (DOC-53 §3.4.2).
 *
 * Lists uploaded case documents. Click "Ver documento" → opens the short-lived
 * signed download URL in a new tab. Approve → reviewDocument(approve). Reject →
 * Modal with a bilingual reason (ES | EN side by side, §0.6) + the note "the
 * client will see this reason in their language" → reviewDocument(reject).
 */

import * as React from "react";
import { getBridge } from "@/frontend/platform-bridge";
import { Card } from "@/frontend/components/brand/card";
import { Icon } from "@/frontend/components/brand/icon";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { StatusPill, type StatusKind } from "@/frontend/components/brand/status-pill";
import { Modal } from "@/frontend/components/desktop/modal";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import { toast } from "@/frontend/components/desktop/toast";
import type { CaseWorkspaceVM, CaseDetailActions, DocumentVM } from "../types";
import type { CasosStrings } from "../strings";
import { SectionLabel } from "../ui";

const DOC_PILL: Record<DocumentVM["status"], StatusKind> = {
  uploaded: "revision",
  approved: "aprobado",
  rejected: "corregir",
  replaced: "pendiente",
};

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
  const [docs, setDocs] = React.useState<DocumentVM[]>(vm.documents);
  const [rejecting, setRejecting] = React.useState<DocumentVM | null>(null);
  const [reasonEs, setReasonEs] = React.useState("");
  const [reasonEn, setReasonEn] = React.useState("");
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function onView(doc: DocumentVM) {
    const res = await actions.getDocumentUrl({ documentId: doc.id });
    if (res.ok && res.url) getBridge().share.openExternal(res.url);
    else toast.error(strings.errorTitle);
  }

  async function onApprove(doc: DocumentVM) {
    setBusyId(doc.id);
    const res = await actions.reviewDocument({ documentId: doc.id, verdict: "approve" });
    setBusyId(null);
    if (res.ok) {
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, status: "approved" } : d)));
      toast.success(t.approved);
    } else toast.error(strings.errorTitle);
  }

  async function onConfirmReject() {
    if (!rejecting) return;
    if (!reasonEs.trim() && !reasonEn.trim()) return;
    setBusyId(rejecting.id);
    const res = await actions.reviewDocument({
      documentId: rejecting.id,
      verdict: "reject",
      reason: { es: reasonEs.trim(), en: reasonEn.trim() },
    });
    setBusyId(null);
    if (res.ok) {
      const id = rejecting.id;
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, status: "rejected" } : d)));
      toast.success(t.rejected);
      setRejecting(null);
      setReasonEs("");
      setReasonEn("");
    } else toast.error(strings.errorTitle);
  }

  const reviewable = docs.filter((d) => d.status !== "replaced");

  return (
    <Card>
      <SectionLabel icon="doc">{t.docsTitle}</SectionLabel>

      {reviewable.length === 0 ? (
        <div style={{ marginTop: 14 }}>
          <EmptyState title={t.docsEmpty} mood="calma" lexSize={104} />
        </div>
      ) : (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {reviewable.map((doc) => (
            <div
              key={doc.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                border: "1px solid var(--line)",
                borderRadius: 14,
                background: "var(--card)",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 11,
                  background: "var(--blue-soft)",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <Icon name="doc" size={20} color="var(--accent)" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: 14.5,
                    fontWeight: 700,
                    color: "var(--ink)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {doc.filename}
                </p>
                {doc.partyName && (
                  <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
                    {doc.partyName}
                  </p>
                )}
              </div>

              <StatusPill kind={DOC_PILL[doc.status]}>{t.docStatus[doc.status]}</StatusPill>

              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <GhostBtn size="md" full={false} icon="external" onClick={() => onView(doc)}>
                  {t.view}
                </GhostBtn>
                {doc.status === "uploaded" && (
                  <>
                    <GradientBtn
                      size="sm"
                      full={false}
                      icon="check"
                      disabled={busyId === doc.id}
                      onClick={() => onApprove(doc)}
                    >
                      {t.approve}
                    </GradientBtn>
                    <GhostBtn
                      size="md"
                      full={false}
                      icon="x"
                      onClick={() => {
                        setReasonEs("");
                        setReasonEn("");
                        setRejecting(doc);
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
      )}

      {/* Reject modal — bilingual reason */}
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
              disabled={(!reasonEs.trim() && !reasonEn.trim()) || busyId !== null}
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
