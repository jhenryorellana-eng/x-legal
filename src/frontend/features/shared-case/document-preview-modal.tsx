"use client";

/**
 * DocumentPreviewModal — in-app large preview (lightbox) for a case document or
 * its translated PDF, WITHOUT a download.
 *
 * It fetches the same-origin /preview route (auth via cookies), turns the bytes
 * into a blob URL and renders them: PDF → <iframe>, image → <img>. The blob URL
 * is same-origin to the document, so it bypasses the global
 * `X-Frame-Options: DENY` — no next.config header surgery needed. The blob is
 * revoked on close to free memory.
 */

import * as React from "react";
import { Modal } from "@/frontend/components/desktop/modal";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";

export interface DocumentPreviewStrings {
  previewTitle: string;
  previewError: string;
  download: string;
}

export interface DocumentPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Full same-origin /preview URL (with query), or null while closed. */
  src: string | null;
  /** Title shown in the header. */
  title: string;
  /** Semantic filename (with extension) used for the download, e.g. "pasaporte-de-juan.pdf". */
  downloadName?: string;
  strings: DocumentPreviewStrings;
}

export function LoadingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 7 }} aria-label="…">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 9,
            height: 9,
            borderRadius: 999,
            background: "var(--accent)",
            animation: "vblink 1.4s ease-in-out infinite",
            animationDelay: `${i * 0.18}s`,
          }}
        />
      ))}
    </span>
  );
}

export function DocumentPreviewModal({ open, onOpenChange, src, title, downloadName, strings }: DocumentPreviewModalProps) {
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [mime, setMime] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    if (!open || !src) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(false);
    setBlobUrl(null);

    (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error("preview_failed");
        const contentType = res.headers.get("content-type") ?? "application/octet-stream";
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setMime(contentType);
        setBlobUrl(createdUrl);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [open, src]);

  const isImage = mime.startsWith("image/");

  function onDownload() {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = downloadName || title || "document";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title || strings.previewTitle}
      fullWidth
      footer={
        <GhostBtn size="md" full={false} icon="external" disabled={!blobUrl} onClick={onDownload}>
          {strings.download}
        </GhostBtn>
      }
    >
      <div
        style={{
          height: "calc(100vh - 170px)",
          display: "grid",
          placeItems: "center",
          background: "var(--panel-2)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {loading && <LoadingDots />}
        {error && (
          <p style={{ color: "var(--ink-2)", fontSize: 14, fontWeight: 700 }}>{strings.previewError}</p>
        )}
        {!loading && !error && blobUrl && (
          isImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob URL, not a remote asset
            <img
              src={blobUrl}
              alt={title}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
          ) : (
            <iframe src={blobUrl} title={title} style={{ width: "100%", height: "100%", border: "none" }} />
          )
        )}
      </div>
    </Modal>
  );
}
