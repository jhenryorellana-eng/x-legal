"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { GhostBtn, GradientBtn, Icon } from "@/frontend/components/brand";

/**
 * PdfReader — full-screen reader for the demo's REAL PDFs (blob URLs preloaded
 * by useDemoAssetBlobs). Same skeleton as `expediente-document.tsx`: portaled
 * to <body> (the staff shell has a transformed ancestor that would clip a
 * fixed layer), z-index 9998 — under the loader/splash overlay layer (9999).
 *
 * Print goes through the iframe's window (blob: is same-origin with its
 * creator). Safari may refuse — the embedded PDF viewer's own print control
 * and the Download button are the fallbacks (`window.open` is banned, RNF-036).
 */

export interface PdfReaderLabels {
  close: string;
  print: string;
  download: string;
  /** Green check note in the toolbar (e.g. "¡Formulario ensamblado!"). */
  toolbarNote: string;
  regenerate?: string;
}

export function PdfReader({
  open,
  onClose,
  blobUrl,
  title,
  downloadName,
  labels,
  onRegenerate,
}: {
  open: boolean;
  onClose: () => void;
  blobUrl: string;
  title: string;
  downloadName: string;
  labels: PdfReaderLabels;
  onRegenerate?: () => void;
}) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  const doPrint = React.useCallback(() => {
    try {
      iframeRef.current?.contentWindow?.print();
    } catch {
      // Safari can refuse cross-document print — the PDF viewer's own control remains.
    }
  }, []);

  const doDownload = React.useCallback(() => {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [blobUrl, downloadName]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "12px 16px",
          background: "color-mix(in srgb, var(--card) 86%, transparent)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={labels.close}
          style={{
            width: 40,
            height: 40,
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: "var(--card)",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <Icon name="x" size={20} color="var(--navy)" />
        </button>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            color: "var(--green)",
            fontWeight: 800,
            fontSize: 14,
          }}
        >
          <Icon name="check" size={18} color="var(--green)" stroke={2.8} />
          {labels.toolbarNote}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          {onRegenerate && labels.regenerate && (
            <GhostBtn icon="play" size="md" full={false} onClick={onRegenerate}>
              {labels.regenerate}
            </GhostBtn>
          )}
          <GhostBtn icon="external" size="md" full={false} onClick={doDownload}>
            {labels.download}
          </GhostBtn>
          <GradientBtn icon="doc" size="sm" full={false} onClick={doPrint}>
            {labels.print}
          </GradientBtn>
        </div>
      </div>

      {/* The real document */}
      <iframe
        ref={iframeRef}
        src={blobUrl}
        title={title}
        style={{ flex: 1, width: "100%", border: "none" }}
      />
    </div>,
    document.body,
  );
}
