"use client";

/**
 * ZelleProofViewer — presentational image/PDF viewer for a payment proof
 * (signed URL from the private `payment-proofs` bucket, RF-AND-011).
 * Extracted from andrium/pagos/pagos-caso-view.tsx so the shared-case Pagos
 * tab renders the exact same viewer.
 */

import * as React from "react";
import { Icon } from "@/frontend/components/brand";
import type { ZelleProofView } from "./types";

export function ZelleProofViewer({
  proof,
  loading,
  error,
  strings,
}: {
  proof: ZelleProofView | null;
  loading: boolean;
  error: boolean;
  strings: { proofLoading: string; proofLoadError: string; noProof: string; proofAlt: string };
}) {
  return (
    <div
      style={{
        background: "var(--hover, rgba(47,107,255,0.04))",
        borderRadius: 12,
        minHeight: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1.5px dashed var(--line)",
        overflow: "hidden",
      }}
    >
      {loading ? (
        <p style={{ fontSize: 12, color: "var(--ink-3)" }}>{strings.proofLoading}</p>
      ) : error ? (
        <div style={{ textAlign: "center" }}>
          <Icon name="doc" size={36} color="var(--ink-3)" />
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
            {strings.proofLoadError}
          </p>
        </div>
      ) : proof && proof.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private bucket; next/image remotePatterns not configured for storage
        <img
          src={proof.url}
          alt={strings.proofAlt}
          style={{ width: "100%", maxHeight: 360, objectFit: "contain", display: "block" }}
        />
      ) : proof && proof.kind === "pdf" ? (
        <iframe
          src={proof.url}
          title={strings.proofAlt}
          style={{ width: "100%", height: 360, border: "none" }}
        />
      ) : (
        <div style={{ textAlign: "center" }}>
          <Icon name="doc" size={36} color="var(--ink-3)" />
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
            {strings.noProof}
          </p>
        </div>
      )}
    </div>
  );
}
