"use client";

/**
 * FormReviewScreen — Diana's side-by-side review (Ola 4).
 *
 * LEFT (fixed): the official auto-filled PDF of the form (filled_pdf_path). It
 *   appears once generated; approving regenerates + refreshes it.
 * RIGHT (toggle): Diana switches between
 *   - "Documentos del cliente": the uploaded files (browse + view), to corroborate.
 *   - "Respuestas del cliente": the SAME FormWizard with the autocompleted fields
 *     (IA / profile badges), editable so she can correct before approving.
 *
 * A full-width bar pinned at the bottom approves + generates the official PDF.
 * Documents are fetched into blob: URLs so the iframe honours the CSP
 * (frame-src 'self' blob:) in production.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  FormWizard,
  type WizardForm,
  type WizardLabels,
  type Locale,
  type SaveDraftFn,
  type SubmitFormFn,
  type TranslateAnswersFn,
} from "@/frontend/features/form-wizard";
import { GradientBtn, GhostBtn } from "@/frontend/components/brand";
import { toast } from "@/frontend/components/desktop";
import { getBridge } from "@/frontend/platform-bridge";
import { pdfErrorMessage, approveErrorMessage } from "@/frontend/features/shared-case/pdf-error";

export interface ReviewDocOption {
  id: string;
  label: string;
  partyName: string | null;
}

export interface FormReviewStrings {
  officialTitle: string;
  officialEmpty: string;
  tabDocs: string;
  tabAnswers: string;
  docSelectPlaceholder: string;
  noDocs: string;
  loadingDoc: string;
  openDoc: string;
  reviewHint: string;
  approveTitle: string;
  approveBtn: string;
  approving: string;
  approvedToast: string;
  viewPdf: string;
  approveError: string;
  back: string;
  /** "Actualizar PDF" — regenerate the official PDF after editing answers (no approval). */
  updatePdf: string;
  updatingPdf: string;
  pdfUpdatedToast: string;
  // Real error mapping (the update-PDF failure used to show the APPROVE copy).
  pdfError: string;
  pdfBlockedApproval: string;
  pdfErrRequiredMissing: string;
  pdfErrVersionMismatch: string;
  pdfErrValidation: string;
  verifyIncomplete: string;
  pendingRequiredTitle: string;
  approvedPdfFailed: string;
  // Reject → return to client for correction (amber, never red — RF-TRX-022)
  rejectBtn: string;
  rejectTitle: string;
  rejectReasonLabel: string;
  rejectReasonPlaceholder: string;
  rejectConfirm: string;
  rejectCancel: string;
  rejecting: string;
  rejectedToast: string;
  rejectReasonRequired: string;
  rejectError: string;
}

export interface FormReviewActions {
  saveDraft: SaveDraftFn;
  submitForm: SubmitFormFn;
  translateAnswers?: TranslateAnswersFn;
  getDocumentUrl: (input: { documentId: string }) => Promise<{ ok: boolean; url?: string; error?: { code: string } }>;
  getFilledPdfUrl: (input: { responseId: string }) => Promise<{ ok: boolean; url?: string | null; error?: { code: string } }>;
  approve: (input: { responseId: string }) => Promise<{ ok: boolean; error?: { code: string; details?: Record<string, unknown> } }>;
  reject: (input: { responseId: string; reason: { en?: string; es?: string } }) => Promise<{ ok: boolean; error?: { code: string } }>;
  generatePdf: (input: { responseId: string }) => Promise<{ ok: boolean; downloadUrl?: string; error?: { code: string; details?: Record<string, unknown> } }>;
  /** Read-only completeness (required questions still unresolved) — feeds the
   *  "Campos obligatorios pendientes" panel so the blocking state is visible
   *  BEFORE pressing Actualizar PDF / Aprobar. */
  getCompleteness?: (input: { responseId: string }) => Promise<{ ok: boolean; complete?: boolean; missing?: Array<{ questionId: string; label: string }>; error?: { code: string } }>;
}

/** Fetches a URL's bytes into a blob: object URL (CSP-safe for iframes). */
async function toBlobUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export function FormReviewScreen({
  caseId,
  partyId,
  partyName,
  form,
  locale,
  labels,
  documents,
  strings,
  actions,
  editable = false,
  backHref,
}: {
  caseId: string;
  partyId: string | null;
  partyName: string | null;
  form: WizardForm;
  locale: Locale;
  labels: WizardLabels;
  documents: ReviewDocOption[];
  strings: FormReviewStrings;
  actions: FormReviewActions;
  /** Staff may edit the answers here (formEdit permission) — enables the wizard. */
  editable?: boolean;
  backHref: string;
}) {
  const router = useRouter();
  const [responseId, setResponseId] = React.useState<string | null>(form.responseId);
  const [rightTab, setRightTab] = React.useState<"answers" | "docs">("answers");
  const [updatingPdf, setUpdatingPdf] = React.useState(false);

  // LEFT — official filled PDF. The iframe needs a blob URL (CSP frame-src), but
  // "open externally" must use the remote signed URL: a blob: URL can't be opened
  // outside this document (and would fail in a Capacitor/native shell).
  const [officialUrl, setOfficialUrl] = React.useState<string | null>(null);
  const [officialRemoteUrl, setOfficialRemoteUrl] = React.useState<string | null>(null);
  const [officialLoading, setOfficialLoading] = React.useState(false);
  const [officialBump, setOfficialBump] = React.useState(0);

  // RIGHT (docs tab) — selected uploaded document.
  const [docId, setDocId] = React.useState<string>(documents[0]?.id ?? "");
  const [docUrl, setDocUrl] = React.useState<string | null>(null);
  const [docRaw, setDocRaw] = React.useState<string | null>(null);
  const [docLoading, setDocLoading] = React.useState(false);

  const [reviewed, setReviewed] = React.useState(false);
  const [approving, setApproving] = React.useState(false);

  // Reject → return to client for correction (modal captures the bilingual reason).
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");
  const [rejecting, setRejecting] = React.useState(false);

  // Load the official filled PDF.
  React.useEffect(() => {
    let alive = true;
    let obj: string | null = null;
    if (!responseId) {
      setOfficialUrl(null);
      return;
    }
    setOfficialLoading(true);
    (async () => {
      const r = await actions.getFilledPdfUrl({ responseId });
      if (!alive) return;
      if (r.ok && r.url) {
        setOfficialRemoteUrl(r.url);
        obj = await toBlobUrl(r.url);
        if (alive) setOfficialUrl(obj);
      } else {
        setOfficialUrl(null);
        setOfficialRemoteUrl(null);
      }
    })().finally(() => {
      if (alive) setOfficialLoading(false);
    });
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [responseId, officialBump, actions]);

  // Load the selected uploaded document (only when the docs tab is active).
  React.useEffect(() => {
    let alive = true;
    let obj: string | null = null;
    if (rightTab !== "docs" || !docId) {
      setDocUrl(null);
      setDocRaw(null);
      return;
    }
    setDocLoading(true);
    (async () => {
      const r = await actions.getDocumentUrl({ documentId: docId });
      if (!alive) return;
      if (!r.ok || !r.url) {
        setDocRaw(null);
        setDocUrl(null);
        return;
      }
      setDocRaw(r.url);
      obj = await toBlobUrl(r.url);
      if (alive) setDocUrl(obj);
    })().finally(() => {
      if (alive) setDocLoading(false);
    });
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [docId, rightTab, actions]);

  // Pending required fields — visible BEFORE any button press, so a blocked
  // "Actualizar PDF"/"Aprobar" is never a surprise. Refreshed after each action.
  const [pendingRequired, setPendingRequired] = React.useState<Array<{ questionId: string; label: string }>>([]);
  const refreshCompleteness = React.useCallback(async () => {
    if (!actions.getCompleteness || !responseId) return;
    const r = await actions.getCompleteness({ responseId }).catch(() => null);
    if (r?.ok) setPendingRequired(r.missing ?? []);
  }, [actions, responseId]);
  React.useEffect(() => {
    void refreshCompleteness();
  }, [refreshCompleteness]);

  const verifyStrings = { toastVerifyIncomplete: strings.verifyIncomplete, toastVerifyError: strings.approveError };
  const pdfStrings = {
    toastPdfError: strings.pdfError,
    toastPdfBlockedApproval: strings.pdfBlockedApproval,
    pdfErrRequiredMissing: strings.pdfErrRequiredMissing,
    pdfErrVersionMismatch: strings.pdfErrVersionMismatch,
    pdfErrValidation: strings.pdfErrValidation,
  };

  async function handleApprove() {
    if (!responseId) return;
    setApproving(true);
    const a = await actions.approve({ responseId });
    if (!a.ok) {
      setApproving(false);
      // FORM_INCOMPLETE carries the missing list — say exactly what's pending.
      toast.error(approveErrorMessage(a.error, verifyStrings));
      void refreshCompleteness();
      return;
    }
    // The approval SUCCEEDED even if the PDF fails — report each outcome honestly.
    const pdf = await actions.generatePdf({ responseId });
    setApproving(false);
    if (pdf.ok) {
      toast.success(strings.approvedToast);
    } else {
      toast.error(`${strings.approvedPdfFailed} ${pdfErrorMessage(pdf.error, pdfStrings)}`);
    }
    setOfficialBump((n) => n + 1); // refresh the left PDF
    void refreshCompleteness();
  }

  async function handleReject() {
    if (!responseId) return;
    const reasonText = rejectReason.trim();
    if (!reasonText) {
      toast.error(strings.rejectReasonRequired);
      return;
    }
    setRejecting(true);
    // The staff writes the reason in their locale; the client sees it in the same
    // field (the notification/DTO resolves {en,es} with fallback to the other).
    const reason = locale === "es" ? { es: reasonText } : { en: reasonText };
    const r = await actions.reject({ responseId, reason });
    setRejecting(false);
    if (!r.ok) {
      toast.error(strings.rejectError);
      return;
    }
    setRejectOpen(false);
    toast.success(strings.rejectedToast);
    router.push(backHref);
  }

  // "Actualizar PDF" — regenerate the official PDF from the current (edited) answers
  // WITHOUT changing the approval state. The wizard has already autosaved the edits.
  async function handleUpdatePdf() {
    if (!responseId) return;
    setUpdatingPdf(true);
    const r = await actions.generatePdf({ responseId });
    setUpdatingPdf(false);
    if (!r.ok) {
      // The REAL failure cause (missing required fields, approval gate, version
      // mismatch) — this used to show the generic approve error and hid it.
      toast.error(pdfErrorMessage(r.error, pdfStrings));
      void refreshCompleteness();
      return;
    }
    toast.success(strings.pdfUpdatedToast);
    setOfficialBump((n) => n + 1);
    void refreshCompleteness();
  }

  const panel: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    border: "1px solid var(--line)",
    borderRadius: 14,
    background: "var(--card,#fff)",
    minHeight: 0,
  };
  const centered: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "var(--ink-3)",
    fontSize: 13,
    textAlign: "center",
    padding: 24,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => router.push(backHref)}
          style={{ border: "none", background: "transparent", color: "var(--ink-2)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", padding: 0 }}
        >
          ← {strings.back}
        </button>
      </div>

      <div className="split-view" style={{ gap: 16, flex: 1, minHeight: 0 }}>
        {/* LEFT — official auto-filled PDF */}
        <div style={panel}>
          <div style={{ flexShrink: 0, padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "var(--ink)" }}>{strings.officialTitle}</p>
          </div>
          <div style={{ flex: 1, minHeight: 0, background: "var(--chip,#f1f5fb)" }}>
            {officialLoading ? (
              <div style={centered}>{strings.loadingDoc}</div>
            ) : officialUrl ? (
              <iframe title="pdf-oficial" src={officialUrl} style={{ width: "100%", height: "100%", minHeight: 420, border: "none" }} />
            ) : (
              <div style={centered}>{strings.officialEmpty}</div>
            )}
          </div>
        </div>

        {/* RIGHT — toggle: client documents / client answers */}
        <div style={panel}>
          <div style={{ flexShrink: 0, padding: "10px 14px", borderBottom: "1px solid var(--line)", display: "flex", gap: 8, alignItems: "center" }}>
            <Toggle active={rightTab === "answers"} onClick={() => setRightTab("answers")}>{strings.tabAnswers}</Toggle>
            <Toggle active={rightTab === "docs"} onClick={() => setRightTab("docs")}>
              {strings.tabDocs}{documents.length > 0 ? ` (${documents.length})` : ""}
            </Toggle>
            {rightTab === "docs" && docRaw && (
              <a href={docRaw} target="_blank" rel="noopener noreferrer" style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 700, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" }}>
                {strings.openDoc} ↗
              </a>
            )}
          </div>

          {rightTab === "answers" ? (
            <>
              <div style={{ flexShrink: 0, padding: "8px 14px", background: "var(--blue-soft)" }}>
                <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: "var(--accent)" }}>{strings.reviewHint}</p>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 8 }}>
                <FormWizard
                  caseId={caseId}
                  partyId={partyId}
                  partyName={partyName}
                  form={form}
                  locale={locale}
                  labels={labels}
                  audience="staff"
                  editable={editable}
                  saveDraft={actions.saveDraft}
                  submitForm={async (input) => {
                    const r = await actions.submitForm(input);
                    if (r.ok && r.responseId) setResponseId(r.responseId);
                    return r;
                  }}
                  translateAnswers={actions.translateAnswers}
                  onSubmitted={() => setReviewed(true)}
                  onExit={() => router.push(backHref)}
                />
              </div>
            </>
          ) : documents.length === 0 ? (
            <div style={centered}>{strings.noDocs}</div>
          ) : (
            <>
              <div style={{ flexShrink: 0, maxHeight: "32%", overflowY: "auto", borderBottom: "1px solid var(--line)", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {documents.map((d) => {
                  const on = d.id === docId;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDocId(d.id)}
                      style={{
                        textAlign: "left",
                        border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
                        background: on ? "var(--blue-soft)" : "var(--card)",
                        borderRadius: 8,
                        padding: "8px 10px",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 700, color: on ? "var(--accent)" : "var(--ink)" }}>{d.label}</span>
                      {d.partyName && <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{d.partyName}</span>}
                    </button>
                  );
                })}
              </div>
              <div style={{ flex: 1, minHeight: 0, background: "var(--chip,#f1f5fb)" }}>
                {docLoading ? (
                  <div style={centered}>{strings.loadingDoc}</div>
                ) : docUrl ? (
                  <iframe title="documento" src={docUrl} style={{ width: "100%", height: "100%", minHeight: 420, border: "none" }} />
                ) : (
                  <div style={centered}>{strings.docSelectPlaceholder}</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Pending required fields — the blocking state, visible BEFORE pressing
          Actualizar PDF / Aprobar (amber, never red). */}
      {pendingRequired.length > 0 && (
        <div
          role="status"
          style={{
            flexShrink: 0,
            marginTop: 12,
            padding: "10px 16px",
            borderRadius: 12,
            border: "1px solid var(--gold)",
            background: "var(--gold-soft)",
            color: "var(--gold-deep)",
            fontSize: 13,
            fontWeight: 700,
            display: "flex",
            gap: 8,
            alignItems: "baseline",
            flexWrap: "wrap",
          }}
        >
          <span>{strings.pendingRequiredTitle} ({pendingRequired.length}):</span>
          <span style={{ fontWeight: 600 }}>
            {pendingRequired.slice(0, 6).map((m) => m.label).join(" · ")}
            {pendingRequired.length > 6 ? " …" : ""}
          </span>
        </div>
      )}

      {/* Pinned approve bar (full width, bottom) */}
      {(reviewed || responseId) && (
        <div style={{ flexShrink: 0, marginTop: 12, padding: "12px 16px", borderTop: "1px solid var(--line)", background: "var(--card,#fff)", borderRadius: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>{strings.approveTitle}</span>
          {editable && (form.status === "submitted" || form.status === "approved") && (
            <GhostBtn size="md" full={false} disabled={updatingPdf || approving || !responseId} onClick={handleUpdatePdf}>
              {updatingPdf ? strings.updatingPdf : strings.updatePdf}
            </GhostBtn>
          )}
          <GradientBtn size="md" full={false} disabled={approving || rejecting || !responseId} onClick={handleApprove}>
            {approving ? strings.approving : strings.approveBtn}
          </GradientBtn>
          {form.status === "submitted" && (
            <GhostBtn size="md" full={false} disabled={approving || rejecting || !responseId} onClick={() => setRejectOpen(true)}>
              {strings.rejectBtn}
            </GhostBtn>
          )}
          {officialUrl && officialRemoteUrl && (
            <GhostBtn size="md" full={false} onClick={() => getBridge().share.openExternal(officialRemoteUrl)}>
              {strings.viewPdf}
            </GhostBtn>
          )}
        </div>
      )}

      {/* Reject modal — capture the bilingual reason the client will see (amber). */}
      {rejectOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => !rejecting && setRejectOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(11,27,51,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              background: "var(--card,#fff)",
              borderRadius: 16,
              border: "1px solid var(--line)",
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              boxShadow: "0 24px 60px rgba(11,27,51,0.28)",
            }}
          >
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>{strings.rejectTitle}</h2>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-2)" }}>{strings.rejectReasonLabel}</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={strings.rejectReasonPlaceholder}
              rows={4}
              autoFocus
              disabled={rejecting}
              style={{
                width: "100%",
                resize: "vertical",
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 14,
                fontFamily: "inherit",
                color: "var(--ink)",
                background: "var(--bg,#fff)",
              }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
              <GhostBtn size="md" full={false} disabled={rejecting} onClick={() => setRejectOpen(false)}>
                {strings.rejectCancel}
              </GhostBtn>
              <GradientBtn size="md" full={false} disabled={rejecting || !rejectReason.trim()} onClick={handleReject}>
                {rejecting ? strings.rejecting : strings.rejectConfirm}
              </GradientBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
        background: active ? "var(--accent)" : "var(--card)",
        color: active ? "#fff" : "var(--ink-2)",
        borderRadius: 999,
        padding: "6px 14px",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
