"use client";

/**
 * Documentos tab (DOC-52 §5.6 / DOC-53 §3.4.2) — the full requirements matrix
 * (the documents the admin defined on the service) grouped by party. Each party
 * (solicitante, cónyuge, …) gets its own header; documents that belong to NO
 * party are listed last under a generic "Documentos" subtitle (so they never
 * read as belonging to the party above). Staff (Henry / Vanessa) can UPLOAD a
 * PDF on the client's behalf for a pending/to-fix slot (RF-ADM-008:
 * startUpload → PUT to signed URL → confirmUpload), VIEW the uploaded file, and
 * APPROVE / REJECT (bilingual reason).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { Icon } from "@/frontend/components/brand/icon";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { StatusPill, type StatusKind } from "@/frontend/components/brand/status-pill";
import { Modal } from "@/frontend/components/desktop/modal";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import { toast } from "@/frontend/components/desktop/toast";
import type { CaseWorkspaceVM, CaseDetailActions, DocMatrixVM, DocUploadVM } from "../types";
import type { CasosStrings } from "../strings";
import { interp } from "../strings";
import { SectionLabel } from "../ui";
import { DocumentPreviewModal } from "../document-preview-modal";
import { DocumentTranslationModal } from "../document-translation-modal";
import { toDownloadFilename } from "@/shared/strings";
import { UPLOAD_MAX_FILE_BYTES } from "@/shared/constants/uploads";

const MAX_BYTES = UPLOAD_MAX_FILE_BYTES;

/** Semantic download filename for a document: slugified name + real extension. */
function downloadNameFor(displayName: string, mimeType: string): string {
  const ext = mimeType === "image/png" ? "png" : "pdf";
  return toDownloadFilename(displayName, ext);
}

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
  const [rejecting, setRejecting] = React.useState<{ documentId: string } | null>(null);
  const [reasonEs, setReasonEs] = React.useState("");
  const [reasonEn, setReasonEn] = React.useState("");
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = React.useState<{ id: string; label: string; downloadName: string } | null>(null);
  const [translateDoc, setTranslateDoc] = React.useState<{ id: string; label: string } | null>(null);
  const [renamingDoc, setRenamingDoc] = React.useState<{ documentId: string } | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [dismissingCoverage, setDismissingCoverage] = React.useState<{ coverageId: string } | null>(null);
  const [dismissReason, setDismissReason] = React.useState("");

  // The visibility toggle is wired only on surfaces that pass the action
  // (admin + sales case detail). Read-only views omit it → no button.
  const canToggle = typeof actions.setRequirementVisibility === "function";
  // Translation is staff-only — only surfaces that wire the action show it.
  const canTranslate = typeof actions.translateDocument === "function";
  // Toggle "already English / no translation needed" — staff-only.
  const canMarkTranslation = typeof actions.setDocumentTranslationNotRequired === "function";
  // Rename a document's semantic name — staff-only (fixes client-typed names).
  const canRename = typeof actions.renameDocument === "function";
  // Overrule the AI's "this upload contains that document" — reviewer surfaces only.
  const canDismissCoverage = typeof actions.dismissCoverage === "function";

  async function onApprove(documentId: string) {
    setBusyKey(documentId);
    const res = await actions.reviewDocument({ documentId, verdict: "approve" });
    setBusyKey(null);
    if (res.ok) {
      toast.success(t.approved);
      router.refresh();
    } else toast.error(strings.errorTitle);
  }

  async function onConfirmReject() {
    if (!rejecting?.documentId) return;
    if (!reasonEs.trim() && !reasonEn.trim()) return;
    setBusyKey(rejecting.documentId);
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

  async function onConfirmRename() {
    if (!renamingDoc || !actions.renameDocument) return;
    const name = renameValue.trim();
    if (!name) return;
    setBusyKey(renamingDoc.documentId);
    const res = await actions.renameDocument({
      caseId: vm.header.caseId,
      documentId: renamingDoc.documentId,
      displayName: name,
    });
    setBusyKey(null);
    if (res.ok) {
      toast.success(t.renameDone);
      setRenamingDoc(null);
      setRenameValue("");
      router.refresh();
    } else toast.error(strings.errorTitle);
  }

  async function onToggleTranslationFlag(item: DocMatrixVM) {
    if (!actions.setDocumentTranslationNotRequired || !item.documentId) return;
    setBusyKey(item.key);
    const res = await actions.setDocumentTranslationNotRequired({
      caseId: vm.header.caseId,
      caseDocumentId: item.documentId,
      value: !item.translationNotRequired,
    });
    setBusyKey(null);
    if (res.ok) {
      toast.success(t.translationFlagDone);
      router.refresh();
    } else toast.error(strings.errorTitle);
  }

  async function onConfirmDismissCoverage() {
    if (!dismissingCoverage || !actions.dismissCoverage) return;
    setBusyKey(dismissingCoverage.coverageId);
    const res = await actions.dismissCoverage({
      caseId: vm.header.caseId,
      coverageId: dismissingCoverage.coverageId,
      reason: dismissReason.trim() || undefined,
    });
    setBusyKey(null);
    if (res.ok) {
      toast.success(t.coverageDismissDone);
      setDismissingCoverage(null);
      setDismissReason("");
      router.refresh();
    } else toast.error(strings.errorTitle);
  }

  async function onToggleVisibility(item: DocMatrixVM, hidden: boolean) {
    if (!actions.setRequirementVisibility) return;
    setBusyKey(item.key);
    const res = await actions.setRequirementVisibility({
      caseId: vm.header.caseId,
      requirementId: item.requirementId,
      partyId: item.partyId,
      hidden,
    });
    setBusyKey(null);
    if (res.ok) {
      toast.success(hidden ? t.hideDone : t.showDone);
      router.refresh();
    } else if (res.error?.code === "REQUIREMENT_NOT_OPTIONAL") {
      toast.error(t.hideRequiredBlocked);
    } else {
      toast.error(strings.errorTitle);
    }
  }

  // Group by party. Documents WITH a party (solicitante, cónyuge, …) render
  // under their party header; documents WITHOUT a party fall into a single
  // "general" bucket rendered LAST under a generic "Documentos" subtitle.
  const groups = new Map<string | null, DocMatrixVM[]>();
  for (const item of vm.requirements) {
    const arr = groups.get(item.partyName) ?? [];
    arr.push(item);
    groups.set(item.partyName, arr);
  }
  const partyGroups = [...groups.entries()].filter(
    (e): e is [string, DocMatrixVM[]] => e[0] != null,
  );
  const generalGroup = groups.get(null) ?? [];

  // One uploaded file inside a multiple slot: name + status + view/approve/reject.
  const renderFileRow = (u: DocUploadVM) => (
    <div key={u.documentId} className="doc-row" style={{ paddingLeft: 12 }}>
      <span aria-hidden="true" className="doc-ico">
        <Icon name="doc" size={18} color="var(--brand-red)" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="doc-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {u.displayName}
        </p>
        {u.status === "corregir" && u.rejectionReason && (
          <p className="doc-meta" style={{ color: "var(--brand-red)" }}>
            {t.docReason}: {u.rejectionReason}
          </p>
        )}
      </div>
      <StatusPill kind={u.status as StatusKind} variant="subtle">
        {statusLabel(u.status, t)}
      </StatusPill>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <GhostBtn
          size="md"
          full={false}
          icon="zoom"
          onClick={() =>
            setPreviewDoc({
              id: u.documentId,
              label: u.displayName,
              downloadName: downloadNameFor(u.displayName, u.mimeType),
            })
          }
        >
          {t.view}
        </GhostBtn>
        {canRename && (
          <GhostBtn
            size="md"
            full={false}
            icon="edit"
            onClick={() => {
              setRenameValue(u.displayName);
              setRenamingDoc({ documentId: u.documentId });
            }}
          >
            {t.rename}
          </GhostBtn>
        )}
        {u.status === "revision" && (
          <>
            <GradientBtn size="sm" full={false} icon="check" disabled={busyKey === u.documentId} onClick={() => onApprove(u.documentId)}>
              {t.approve}
            </GradientBtn>
            <GhostBtn
              size="md"
              full={false}
              icon="x"
              onClick={() => {
                setReasonEs("");
                setReasonEn("");
                setRejecting({ documentId: u.documentId });
              }}
            >
              {t.reject}
            </GhostBtn>
          </>
        )}
      </div>
    </div>
  );

  // Multiple requirement: a header row (label + add-file) followed by one row
  // per uploaded file. Hidden multiples fall back to the single renderer below.
  const renderMultipleRow = (item: DocMatrixVM) => (
    <div key={item.key} style={{ marginBottom: 4 }}>
      <div className="doc-row">
        <span aria-hidden="true" className="doc-ico">
          <Icon name="doc" size={20} color="var(--brand-red)" />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="doc-name">
            {item.label}
            {!item.isRequired && (
              <span style={{ marginLeft: 8 }}>
                <Chip tone="blue">{t.optional}</Chip>
              </span>
            )}
            {item.uploads.length === 0 && item.coveredBy && (
              <span style={{ marginLeft: 8 }}>
                <Chip tone="gold" dot>
                  {interp(t.coveredByChip, {
                    source: item.coveredBy.sourceName,
                    confidence: String(Math.round(item.coveredBy.confidence * 100)),
                  })}
                </Chip>
              </span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {item.uploads.length === 0 && item.coveredBy && canDismissCoverage && (
            <GhostBtn
              size="md"
              full={false}
              icon="x"
              disabled={busyKey === item.coveredBy.coverageId}
              onClick={() => {
                setDismissReason("");
                setDismissingCoverage({ coverageId: item.coveredBy!.coverageId });
              }}
            >
              {t.coverageDismiss}
            </GhostBtn>
          )}
          <UploadButton
            item={item}
            caseId={vm.header.caseId}
            actions={actions}
            strings={strings}
            busy={busyKey === item.key}
            setBusy={(b) => setBusyKey(b ? item.key : null)}
            onDone={() => router.refresh()}
            allowMultiple
          />
          {canToggle && !item.isRequired && (
            <GhostBtn
              size="md"
              full={false}
              icon="lock"
              disabled={busyKey === item.key}
              onClick={() => onToggleVisibility(item, true)}
            >
              {t.hideForClient}
            </GhostBtn>
          )}
        </div>
      </div>
      {item.uploads.map(renderFileRow)}
    </div>
  );

  const renderRow = (item: DocMatrixVM) => (
    <div key={item.key} className="doc-row" style={item.isHidden ? { opacity: 0.55 } : undefined}>
      <span aria-hidden="true" className="doc-ico">
        <Icon name="doc" size={20} color="var(--brand-red)" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="doc-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.label}
          {!item.isRequired && !item.isHidden && (
            <span style={{ marginLeft: 8 }}>
              <Chip tone="blue">{t.optional}</Chip>
            </span>
          )}
          {item.isHidden && (
            <span style={{ marginLeft: 8 }}>
              <Chip tone="amber">{t.hiddenFromClient}</Chip>
            </span>
          )}
          {item.translationNotRequired && (
            <span style={{ marginLeft: 8 }}>
              <Chip tone="green">{t.englishChip}</Chip>
            </span>
          )}
        </p>
        {item.status === "corregir" && item.rejectionReason && (
          <p className="doc-meta" style={{ color: "var(--brand-red)" }}>
            {t.docReason}: {item.rejectionReason}
          </p>
        )}
      </div>

      {!item.isHidden &&
        (item.status === "pendiente" && item.coveredBy ? (
          <Chip tone="gold" dot>
            {interp(t.coveredByChip, {
              source: item.coveredBy.sourceName,
              confidence: String(Math.round(item.coveredBy.confidence * 100)),
            })}
          </Chip>
        ) : (
          <StatusPill kind={item.status as StatusKind} variant="subtle">
            {statusLabel(item.status, t)}
          </StatusPill>
        ))}

      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        {item.isHidden ? (
          canToggle && (
            <GhostBtn
              size="md"
              full={false}
              disabled={busyKey === item.key}
              onClick={() => onToggleVisibility(item, false)}
            >
              {t.showToClient}
            </GhostBtn>
          )
        ) : (
          <>
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
              <GhostBtn
                size="md"
                full={false}
                icon="zoom"
                onClick={() =>
                  setPreviewDoc({
                    id: item.documentId!,
                    label: item.label,
                    downloadName: item.uploads[0]
                      ? downloadNameFor(item.uploads[0].displayName, item.uploads[0].mimeType)
                      : downloadNameFor(item.label, "application/pdf"),
                  })
                }
              >
                {t.view}
              </GhostBtn>
            )}
            {item.documentId && canTranslate && !item.translationNotRequired && (
              <GhostBtn
                size="md"
                full={false}
                icon="globe"
                onClick={() => setTranslateDoc({ id: item.documentId!, label: item.label })}
              >
                {t.translate}
              </GhostBtn>
            )}
            {item.documentId && canMarkTranslation && (
              <GhostBtn
                size="md"
                full={false}
                icon={item.translationNotRequired ? "globe" : "check"}
                disabled={busyKey === item.key}
                onClick={() => onToggleTranslationFlag(item)}
              >
                {item.translationNotRequired ? t.markNeedsTranslation : t.markEnglish}
              </GhostBtn>
            )}
            {item.status === "revision" && item.documentId && (
              <>
                <GradientBtn size="sm" full={false} icon="check" disabled={busyKey === item.documentId} onClick={() => onApprove(item.documentId!)}>
                  {t.approve}
                </GradientBtn>
                <GhostBtn
                  size="md"
                  full={false}
                  icon="x"
                  onClick={() => {
                    setReasonEs("");
                    setReasonEn("");
                    setRejecting({ documentId: item.documentId! });
                  }}
                >
                  {t.reject}
                </GhostBtn>
              </>
            )}
            {item.status === "pendiente" && item.coveredBy && canDismissCoverage && (
              <GhostBtn
                size="md"
                full={false}
                icon="x"
                disabled={busyKey === item.coveredBy.coverageId}
                onClick={() => {
                  setDismissReason("");
                  setDismissingCoverage({ coverageId: item.coveredBy!.coverageId });
                }}
              >
                {t.coverageDismiss}
              </GhostBtn>
            )}
            {canToggle && !item.isRequired && (
              <GhostBtn
                size="md"
                full={false}
                icon="lock"
                disabled={busyKey === item.key}
                onClick={() => onToggleVisibility(item, true)}
              >
                {t.hideForClient}
              </GhostBtn>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <Card>
      <SectionLabel icon="doc">{t.docsTitle}</SectionLabel>

      {vm.requirements.length === 0 ? (
        <div style={{ marginTop: 14 }}>
          <EmptyState title={t.docsMatrixEmpty} mood="calma" lexSize={104} />
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          {partyGroups.map(([party, list]) => (
            <div key={party}>
              <div className="member-head">
                <span aria-hidden="true" className="member-av">
                  {party.charAt(0).toUpperCase()}
                </span>
                {party}
              </div>
              {list.map((it) => (it.allowMultiple && !it.isHidden ? renderMultipleRow(it) : renderRow(it)))}
            </div>
          ))}

          {generalGroup.length > 0 && (
            <div key="_general">
              <div className="member-head">
                <span aria-hidden="true" className="member-av">
                  <Icon name="doc" size={15} color="var(--accent)" />
                </span>
                {t.docsNoPartyGroup}
              </div>
              {generalGroup.map((it) => (it.allowMultiple && !it.isHidden ? renderMultipleRow(it) : renderRow(it)))}
            </div>
          )}
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
        <div className="grid2" style={{ gap: 12 }}>
          <Field label={t.rejectReasonEs} value={reasonEs} onChange={setReasonEs} />
          <Field label={t.rejectReasonEn} value={reasonEn} onChange={setReasonEn} />
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>{t.rejectNote}</p>
      </Modal>

      <Modal
        open={renamingDoc !== null}
        onOpenChange={(o) => !o && setRenamingDoc(null)}
        title={t.renameTitle}
        footer={
          <>
            <GhostBtn size="md" full={false} onClick={() => setRenamingDoc(null)}>
              {strings.cancel}
            </GhostBtn>
            <GradientBtn
              size="md"
              full={false}
              disabled={!renameValue.trim() || busyKey !== null}
              onClick={onConfirmRename}
            >
              {t.renameConfirm}
            </GradientBtn>
          </>
        }
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink-2)" }}>{t.renameLabel}</span>
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder={t.renamePlaceholder}
            maxLength={120}
            style={{
              borderRadius: 12,
              border: "1px solid var(--line)",
              background: "var(--card)",
              color: "var(--ink)",
              padding: "10px 12px",
              fontSize: 14,
              fontFamily: "var(--font-body)",
            }}
          />
        </label>
      </Modal>

      <Modal
        open={dismissingCoverage !== null}
        onOpenChange={(o) => !o && setDismissingCoverage(null)}
        title={t.coverageDismissTitle}
        tone="var(--gold-deep)"
        footer={
          <>
            <GhostBtn size="md" full={false} onClick={() => setDismissingCoverage(null)}>
              {strings.cancel}
            </GhostBtn>
            <GradientBtn
              size="md"
              full={false}
              disabled={busyKey !== null}
              onClick={onConfirmDismissCoverage}
            >
              {t.coverageDismissConfirm}
            </GradientBtn>
          </>
        }
      >
        <Field label={t.coverageDismissReason} value={dismissReason} onChange={setDismissReason} />
        <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>{t.coverageDismissNote}</p>
      </Modal>

      {previewDoc && (
        <DocumentPreviewModal
          open={previewDoc !== null}
          onOpenChange={(o) => !o && setPreviewDoc(null)}
          src={`/api/v1/cases/${vm.header.caseId}/documents/${previewDoc.id}/preview?kind=source`}
          title={previewDoc.label}
          downloadName={previewDoc.downloadName}
          strings={{ previewTitle: t.previewTitle, previewError: t.previewError, download: t.download }}
        />
      )}

      {translateDoc && (
        <DocumentTranslationModal
          open={translateDoc !== null}
          onOpenChange={(o) => !o && setTranslateDoc(null)}
          caseId={vm.header.caseId}
          documentId={translateDoc.id}
          docLabel={translateDoc.label}
          actions={actions}
          strings={strings}
        />
      )}
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
  allowMultiple = false,
}: {
  item: DocMatrixVM;
  caseId: string;
  actions: CaseDetailActions;
  strings: CasosStrings;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onDone: () => void;
  /** Multiple slot: send a display name (filename base) so the server accepts the file. */
  allowMultiple?: boolean;
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
      // Multiple slots require a name; staff uploads use the file's base name.
      displayName: allowMultiple ? file.name.replace(/\.[^.]+$/, "") : undefined,
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
