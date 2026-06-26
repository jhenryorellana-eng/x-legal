"use client";

/**
 * DocumentTranslationModal — staff translates a client document (ES→EN) into a
 * court-ready English PDF.
 *
 * Flow (DOC-42 T4): on open it requests the translation (the heavy work runs in
 * a QStash job, cached by UNIQUE (case_document_id, direction)); while the job
 * runs it polls the read-only status every 5s. Once completed it shows the
 * translated text and lets staff preview/download the generated English PDF
 * (which can then feed the expediente).
 */

import * as React from "react";
import { Modal } from "@/frontend/components/desktop/modal";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { toast } from "@/frontend/components/desktop/toast";
import type { CaseDetailActions, DocumentTranslationView } from "./types";
import type { CasosStrings } from "./strings";
import { DocumentPreviewModal, LoadingDots } from "./document-preview-modal";

const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 66; // ~5.5 min — covers the worst-case Gemini + render latency

type Phase = "idle" | "starting" | "processing" | "completed" | "failed";

export interface DocumentTranslationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  documentId: string;
  docLabel: string;
  actions: CaseDetailActions;
  strings: CasosStrings;
}

export function DocumentTranslationModal({
  open,
  onOpenChange,
  caseId,
  documentId,
  docLabel,
  actions,
  strings,
}: DocumentTranslationModalProps) {
  const t = strings.detail;
  const [translation, setTranslation] = React.useState<DocumentTranslationView | null>(null);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [pdfPreviewOpen, setPdfPreviewOpen] = React.useState(false);
  const startedRef = React.useRef(false);
  const pollsRef = React.useRef(0);

  const pdfSrc = `/api/v1/cases/${caseId}/documents/${documentId}/preview?kind=translation&direction=es-en`;

  const start = React.useCallback(async () => {
    const translate = actions.translateDocument;
    if (!translate) return;
    setPhase("starting");
    pollsRef.current = 0;
    const res = await translate({ caseId, caseDocumentId: documentId, direction: "es-en" });
    if (!res.ok || !res.translation) {
      setPhase("failed");
      return;
    }
    setTranslation(res.translation);
    setPhase(
      res.translation.status === "completed"
        ? "completed"
        : res.translation.status === "failed"
          ? "failed"
          : "processing",
    );
  }, [actions, caseId, documentId]);

  // Trigger once when the modal opens; reset everything when it closes.
  React.useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true;
      void start();
    }
    if (!open) {
      startedRef.current = false;
      setTranslation(null);
      setPhase("idle");
      setPdfPreviewOpen(false);
    }
  }, [open, start]);

  // Poll while the job runs.
  React.useEffect(() => {
    const getTranslation = actions.getTranslation;
    if (phase !== "processing" || !getTranslation) return;
    let cancelled = false;
    const id = setInterval(async () => {
      if (cancelled) return;
      pollsRef.current += 1;
      if (pollsRef.current > MAX_POLLS) {
        setPhase("failed");
        clearInterval(id);
        return;
      }
      const res = await getTranslation({ caseId, caseDocumentId: documentId, direction: "es-en" });
      if (cancelled || !res.ok || !res.translation) return;
      setTranslation(res.translation);
      if (res.translation.status === "completed") {
        setPhase("completed");
        clearInterval(id);
      } else if (res.translation.status === "failed") {
        setPhase("failed");
        clearInterval(id);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, actions, caseId, documentId]);

  async function onDownloadPdf() {
    try {
      const res = await fetch(pdfSrc);
      if (!res.ok) throw new Error("download_failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${docLabel || "documento"}-EN.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error(t.translateError);
    }
  }

  const busy = phase === "idle" || phase === "starting" || phase === "processing";
  const hasPdf = translation?.hasPdf ?? false;

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title={t.translateTitle}
        width={720}
        footer={
          phase === "failed" ? (
            <GradientBtn
              size="md"
              full={false}
              icon="globe"
              onClick={() => {
                void start();
              }}
            >
              {t.translateRetry}
            </GradientBtn>
          ) : undefined
        }
      >
        {busy && (
          <div style={{ display: "grid", placeItems: "center", gap: 14, padding: "24px 8px" }}>
            <LoadingDots />
            <p style={{ margin: 0, textAlign: "center", color: "var(--ink-2)", fontSize: 14, lineHeight: 1.5, maxWidth: 460 }}>
              {t.translateProcessing}
            </p>
          </div>
        )}

        {phase === "failed" && (
          <p style={{ margin: "8px 0", color: "var(--brand-red)", fontSize: 14, fontWeight: 700 }}>
            {t.translateError}
          </p>
        )}

        {phase === "completed" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {hasPdf ? (
                <>
                  <GradientBtn size="sm" full={false} icon="zoom" onClick={() => setPdfPreviewOpen(true)}>
                    {t.viewTranslationPdf}
                  </GradientBtn>
                  <GhostBtn size="md" full={false} icon="external" onClick={onDownloadPdf}>
                    {t.downloadTranslationPdf}
                  </GhostBtn>
                </>
              ) : (
                <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 13, fontWeight: 700 }}>
                  {t.translationPdfPending}
                </p>
              )}
            </div>

            {translation?.translatedText && (
              <div>
                <p style={{ margin: "0 0 6px", fontSize: 12.5, fontWeight: 800, color: "var(--ink-2)" }}>
                  {t.translationTextTitle}
                </p>
                <div
                  style={{
                    maxHeight: "min(420px, 50vh)",
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    borderRadius: 12,
                    border: "1px solid var(--line)",
                    background: "var(--card)",
                    color: "var(--ink)",
                    padding: "12px 14px",
                    fontSize: 13.5,
                    lineHeight: 1.55,
                    fontFamily: "var(--font-body)",
                  }}
                >
                  {translation.translatedText}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <DocumentPreviewModal
        open={pdfPreviewOpen}
        onOpenChange={setPdfPreviewOpen}
        src={pdfPreviewOpen ? pdfSrc : null}
        title={`${docLabel} (EN)`}
        strings={{ previewTitle: t.previewTitle, previewError: t.previewError, download: t.download }}
      />
    </>
  );
}
