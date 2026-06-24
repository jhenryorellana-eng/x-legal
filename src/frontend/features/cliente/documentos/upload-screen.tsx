"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/frontend/components/brand/icon";
import { IconHalo } from "@/frontend/components/brand/icon-tile";
import { Lex } from "@/frontend/components/brand/lex";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { ProgressBar } from "@/frontend/components/brand/progress-bar";

/** Results of the upload actions (structurally match the server actions). */
export interface StartUploadResult {
  ok: boolean;
  signedUrl?: string;
  uploadRef?: string;
  error?: { code: string };
}
export interface ConfirmUploadResult {
  ok: boolean;
  progress?: number;
  gain?: number;
  error?: { code: string };
}

/**
 * UploadScreen — `/caso/[caseId]/subir` (DOC-51 §15, prototype `screens2.jsx →
 * UploadScreen`). NO_CHROME.
 *
 * REAL upload flow (not the prototype's fake setInterval): pick a PDF → request a
 * signed URL (startUploadAction) → PUT the file directly to storage with real
 * upload progress (XHR) → confirm (confirmUploadAction) → celebrate. Non-PDF
 * files are rejected BEFORE upload with a friendly message; network failures
 * return to capture without registering anything.
 */

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — friendly client cap

export interface UploadLabels {
  eyebrow: string;
  documentTitle: string;
  captureTitle: string;
  captureSub: string;
  /** Single upload action — everything is scanned (no camera). */
  uploadDoc: string;
  okTitle: string;
  okSub: string;
  badTitle: string;
  badSub: string;
  /** Format-aware note, e.g. "Aceptamos solo PDF escaneado". */
  acceptNote: string;
  uploadingTitle: string; // "Subiendo tu documento…"
  uploadingSub: string;
  /** Shown while the AI quality check runs during confirm. */
  checkingQuality: string;
  /** Format-aware client validation error. */
  errFormat: string;
  errTooBig: string;
  errNetwork: string;
  /** Informative anti-blur message — the document was NOT uploaded. */
  blurMsg: string;
  back: string;
}

export interface UploadScreenProps {
  caseId: string;
  requirementId: string | null;
  partyId: string | null;
  documentName: string;
  /** Admin-configured accepted format for this document: pdf | png. */
  acceptedFormat: "pdf" | "png";
  previousProgress: number;
  labels: UploadLabels;
  startUpload: (input: {
    caseId: string;
    requirementId: string | null;
    partyId: string | null;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }) => Promise<StartUploadResult>;
  confirmUpload: (input: {
    caseId: string;
    uploadRef: string;
    requirementId: string | null;
    partyId: string | null;
    originalFilename: string;
    previousProgress: number;
  }) => Promise<ConfirmUploadResult>;
}

function putWithProgress(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/pdf");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.send(file);
  });
}

export function UploadScreen({
  caseId,
  requirementId,
  partyId,
  documentName,
  acceptedFormat,
  previousProgress,
  labels,
  startUpload,
  confirmUpload,
}: UploadScreenProps) {
  const router = useRouter();
  const [stage, setStage] = React.useState<"idle" | "uploading">("idle");
  const [pct, setPct] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Everything is scanned (no camera). The admin picks pdf | png per document.
  const acceptMime = acceptedFormat === "png" ? "image/png" : "application/pdf";
  const acceptExt = acceptedFormat === "png" ? ".png" : ".pdf";

  // TODO(8d): migrate this hidden <input type="file"> + onFile flow to
  // getBridge().files.pickFile / getBridge().camera.capturePhoto. Left as-is for
  // now: the swap is invasive (event-driven onFile drives signed-URL upload with
  // XHR progress via putWithProgress, which needs the File and its re-pick reset)
  // and this upload path is the verified-working one — not worth the risk in 8d.
  const pickFile = () => {
    setError(null);
    fileInputRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-pick of same file
    if (!file) return;

    // Client-side validation BEFORE upload (server re-validates + checks quality).
    const matchesFormat =
      file.type === acceptMime || file.name.toLowerCase().endsWith(acceptExt);
    if (!matchesFormat) {
      setError(labels.errFormat);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(labels.errTooBig);
      return;
    }

    setStage("uploading");
    setPct(0);

    const started = await startUpload({
      caseId,
      requirementId,
      partyId,
      filename: file.name,
      mimeType: file.type || acceptMime,
      sizeBytes: file.size,
    });
    if (!started.ok || !started.signedUrl || !started.uploadRef) {
      setStage("idle");
      setError(labels.errNetwork);
      return;
    }

    const uploaded = await putWithProgress(started.signedUrl, file, setPct);
    if (!uploaded) {
      setStage("idle");
      setError(labels.errNetwork);
      return;
    }
    setPct(100);

    const confirmed = await confirmUpload({
      caseId,
      uploadRef: started.uploadRef,
      requirementId,
      partyId,
      originalFilename: file.name,
      previousProgress,
    });
    if (!confirmed.ok) {
      setStage("idle");
      // The quality gate (first filter) rejected a clearly-blurry scan: the
      // document was NOT stored — guide the client to re-scan and try again.
      const code = confirmed.error?.code;
      if (code === "DOC_NOT_LEGIBLE") setError(labels.blurMsg);
      else if (code === "DOC_FORMAT_NOT_ALLOWED") setError(labels.errFormat);
      else setError(labels.errNetwork);
      return;
    }

    const qs = new URLSearchParams();
    qs.set("progress", String(confirmed.progress ?? previousProgress));
    qs.set("gain", String(confirmed.gain ?? 0));
    setTimeout(() => router.push(`/caso/${caseId}/exito?${qs.toString()}`), 600);
  };

  return (
    <div style={{ minHeight: "100dvh", padding: "54px 20px 40px", background: "var(--bg)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <button
          type="button"
          onClick={() => router.push(`/caso/${caseId}/documentos`)}
          aria-label={labels.back}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            border: "none",
            background: "var(--card)",
            boxShadow: "var(--shadow-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <Icon name="arrowL" size={22} color="var(--navy)" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "var(--ink-2)", fontSize: 14, fontWeight: 600 }}>
            {labels.eyebrow}
          </div>
          <h1
            className="t-title"
            style={{
              margin: 0,
              fontSize: 21,
              color: "var(--navy)",
              fontWeight: 700,
              lineHeight: 1.15,
            }}
          >
            {documentName}
          </h1>
        </div>
        <Lex size={56} mood="feliz" />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={acceptMime}
        onChange={onFile}
        style={{ display: "none" }}
      />

      {stage === "uploading" ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "50px 0",
            gap: 22,
          }}
        >
          <Lex size={130} mood="atento" />
          <div style={{ width: "100%" }}>
            <div
              style={{
                textAlign: "center",
                fontFamily: "var(--font-title)",
                fontWeight: 700,
                fontSize: 18,
                color: "var(--navy)",
                marginBottom: 12,
              }}
            >
              {pct >= 100 ? labels.checkingQuality : `${labels.uploadingTitle} ${Math.round(pct)}%`}
            </div>
            <ProgressBar pct={pct} height={12} />
            <div
              style={{
                textAlign: "center",
                color: "var(--ink-2)",
                fontSize: 14.5,
                marginTop: 12,
                fontWeight: 500,
              }}
            >
              {labels.uploadingSub}
            </div>
          </div>
        </div>
      ) : (
        <>
          {error && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "var(--gold-soft)",
                borderRadius: 14,
                padding: "12px 14px",
                marginBottom: 16,
              }}
            >
              <Icon name="info" size={19} color="var(--gold-deep)" />
              <span style={{ fontSize: 14, color: "var(--ink)", fontWeight: 600 }}>
                {error}
              </span>
            </div>
          )}

          <div
            style={{
              border: "2.5px dashed color-mix(in srgb, var(--accent) 40%, transparent)",
              background: "var(--blue-soft)",
              borderRadius: 26,
              padding: "34px 20px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              marginBottom: 18,
            }}
          >
            <div
              style={{
                position: "relative",
                width: 72,
                height: 72,
                borderRadius: 999,
                background: "var(--card)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                boxShadow: "0 8px 18px color-mix(in srgb, var(--accent) 18%, transparent)",
              }}
            >
              <IconHalo color="var(--accent)" size={72} opacity={0.7} />
              <span style={{ position: "relative", display: "flex" }}>
                <Icon name="doc" size={36} color="var(--accent)" />
              </span>
            </div>
            <div
              className="t-title"
              style={{
                fontSize: 17,
                color: "var(--navy)",
                fontWeight: 700,
                marginTop: 4,
              }}
            >
              {labels.captureTitle}
            </div>
            <div
              style={{
                fontSize: 14,
                color: "var(--ink-2)",
                fontWeight: 500,
                textAlign: "center",
              }}
            >
              {labels.captureSub}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 22 }}>
            <GradientBtn icon="doc" onClick={pickFile}>
              {labels.uploadDoc}
            </GradientBtn>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {[
              { ok: true, t: labels.okTitle, d: labels.okSub },
              { ok: false, t: labels.badTitle, d: labels.badSub },
            ].map((g, i) => (
              <div
                key={i}
                style={{
                  background: "var(--card)",
                  borderRadius: 18,
                  padding: 14,
                  boxShadow: "var(--shadow-soft)",
                }}
              >
                <div
                  style={{
                    height: 70,
                    borderRadius: 12,
                    background: g.ok ? "var(--green-soft)" : "var(--red-soft)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 10,
                    position: "relative",
                  }}
                >
                  <Icon name="doc" size={34} color={g.ok ? "var(--green)" : "var(--red)"} stroke={2} />
                  <div
                    style={{
                      position: "absolute",
                      bottom: -8,
                      right: 8,
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background: g.ok ? "var(--green)" : "var(--red)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 3px 8px rgba(0,0,0,0.18)",
                    }}
                  >
                    {g.ok ? (
                      <Icon name="check" size={17} color="#fff" stroke={3} />
                    ) : (
                      <Icon name="x" size={16} color="#fff" stroke={3} />
                    )}
                  </div>
                </div>
                <div
                  className="t-title"
                  style={{
                    fontSize: 15,
                    color: g.ok ? "var(--green)" : "var(--red)",
                    fontWeight: 700,
                  }}
                >
                  {g.t}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                    fontWeight: 500,
                    lineHeight: 1.3,
                  }}
                >
                  {g.d}
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              color: "var(--ink-3)",
              fontSize: 13.5,
              fontWeight: 700,
            }}
          >
            <Icon name="info" size={16} color="var(--ink-3)" /> {labels.acceptNote}
          </div>
        </>
      )}
    </div>
  );
}
