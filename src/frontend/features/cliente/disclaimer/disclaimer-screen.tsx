"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/frontend/components/brand/icon";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import {
  SignaturePad,
  type SignaturePadHandle,
  type SignaturePadLabels,
} from "@/frontend/components/mobile";

/** Result of the accept-terms action (structurally matches the server action). */
export interface AcceptTermsResult {
  ok: boolean;
  error?: { code: string };
}

/**
 * DisclaimerScreen — `/caso/[caseId]/disclaimer` (DOC-51 §12, prototype
 * `screens8.jsx → DisclaimerScreen`). NO_CHROME.
 *
 * Read-to-the-end gate (≈28px from the bottom) reveals the SignaturePad + the
 * acceptance checkbox; the CTA stays inert until BOTH signature + checkbox are
 * set. On accept it re-encodes the signature to JPEG, calls the accept action,
 * and (on first acceptance) routes to Camino with `?onboarded=1` to fire the
 * Tutorial overlay.
 */

export interface DisclaimerSection {
  title: string;
  body: string;
}

export interface DisclaimerLabels {
  brandPrime: string; // "PRIME" suffix accent word
  title: string;
  subtitle: string;
  scrollHint: string;
  yourSignature: string;
  checkbox: string;
  accept: string;
  closing: string;
  errGeneric: string;
}

/** Converts a PNG data URL to a JPEG data URL on a white background. */
function pngToJpeg(pngDataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width || 600;
      canvas.height = img.height || 200;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(pngDataUrl);
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => resolve(pngDataUrl);
    img.src = pngDataUrl;
  });
}

export function DisclaimerScreen({
  caseId,
  sections,
  closing,
  labels,
  signatureLabels,
  acceptTerms,
}: {
  caseId: string;
  sections: DisclaimerSection[];
  closing: string;
  labels: DisclaimerLabels;
  signatureLabels: SignaturePadLabels;
  acceptTerms: (input: {
    caseId: string;
    signatureJpegDataUrl: string;
  }) => Promise<AcceptTermsResult>;
}) {
  const router = useRouter();
  const padRef = React.useRef<SignaturePadHandle>(null);
  const [reachedEnd, setReachedEnd] = React.useState(false);
  const [signed, setSigned] = React.useState(false);
  const [accept, setAccept] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ready = signed && accept && !submitting;

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 28) setReachedEnd(true);
  };

  const onAccept = async () => {
    if (!ready) return;
    const png = padRef.current?.getDataUrl();
    if (!png) {
      setError(labels.errGeneric);
      return;
    }
    setSubmitting(true);
    setError(null);
    const jpeg = await pngToJpeg(png);
    const res = await acceptTerms({ caseId, signatureJpegDataUrl: jpeg });
    if (!res.ok) {
      setSubmitting(false);
      setError(labels.errGeneric);
      return;
    }
    router.push(`/caso/${caseId}/camino?onboarded=1`);
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        background:
          "radial-gradient(135% 90% at 100% -8%, var(--blue-soft) 0%, transparent 46%), var(--bg)",
        padding: "52px 20px 22px",
      }}
    >
      {/* BrandBar small */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            height: 16,
            borderRadius: 5,
            overflow: "hidden",
            boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
          }}
        >
          <span style={{ width: 5, background: "var(--brand-navy)" }} />
          <span style={{ width: 5, background: "#fff" }} />
          <span style={{ width: 5, background: "#E4002B" }} />
        </div>
        <span
          style={{
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 15,
            color: "var(--navy)",
            letterSpacing: "-0.02em",
          }}
        >
          X <span style={{ color: "var(--accent)" }}>{labels.brandPrime}</span>
        </span>
      </div>

      <h1
        className="t-black"
        style={{
          margin: "18px 0 4px",
          fontSize: 25,
          color: "var(--navy)",
          textWrap: "balance",
        }}
      >
        {labels.title}
      </h1>
      <p style={{ margin: "0 0 14px", fontSize: 15, color: "var(--ink-2)", fontWeight: 600 }}>
        {labels.subtitle}
      </p>

      {/* Scrollable notice box */}
      <div
        onScroll={onScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          background: "var(--card)",
          borderRadius: 18,
          padding: "16px 16px",
          boxShadow: "var(--shadow-soft)",
          border: "1px solid var(--line)",
        }}
      >
        {sections.map((s, i) => (
          <React.Fragment key={i}>
            <div
              className="t-title"
              style={{
                fontSize: 15.5,
                color: "var(--navy)",
                fontWeight: 800,
                margin: "4px 0 7px",
              }}
            >
              {s.title}
            </div>
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 14.5,
                lineHeight: 1.6,
                color: "var(--ink-2)",
                fontWeight: 500,
              }}
            >
              {s.body}
            </p>
          </React.Fragment>
        ))}
        <p
          style={{
            margin: "0 0 12px",
            fontSize: 14.5,
            lineHeight: 1.6,
            color: "var(--ink-2)",
            fontWeight: 500,
          }}
        >
          {closing}
        </p>
        <div style={{ height: 2 }} />
      </div>

      {!reachedEnd && (
        <div
          className="anim-float-hint"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            marginTop: 10,
            color: "var(--accent)",
            fontSize: 13.5,
            fontWeight: 800,
          }}
        >
          <Icon name="chevD" size={17} color="var(--accent)" /> {labels.scrollHint}
        </div>
      )}

      {reachedEnd && (
        <div className="anim-fade-in">
          <div style={{ margin: "14px 0 12px" }}>
            <div
              className="t-title"
              style={{
                fontSize: 16,
                color: "var(--navy)",
                fontWeight: 800,
                marginBottom: 9,
              }}
            >
              {labels.yourSignature}
            </div>
            <SignaturePad
              ref={padRef}
              labels={signatureLabels}
              onChange={(s) => setSigned(s)}
            />
          </div>
          <button
            type="button"
            onClick={() => setAccept((a) => !a)}
            aria-pressed={accept}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: accept ? "var(--blue-soft)" : "var(--card)",
              border: `2px solid ${accept ? "var(--accent)" : "var(--line)"}`,
              borderRadius: 16,
              padding: "13px 14px",
              cursor: "pointer",
              textAlign: "left",
              marginBottom: 12,
            }}
          >
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                flexShrink: 0,
                background: accept ? "var(--accent)" : "transparent",
                border: accept ? "none" : "2px solid var(--ink-3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {accept && <Icon name="check" size={18} color="#fff" stroke={3} />}
            </span>
            <span
              style={{
                fontSize: 14.5,
                color: "var(--ink)",
                fontWeight: 600,
                lineHeight: 1.4,
              }}
            >
              {labels.checkbox}
            </span>
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "var(--gold-soft)",
            borderRadius: 12,
            padding: "10px 12px",
            marginBottom: 10,
          }}
        >
          <Icon name="info" size={18} color="var(--gold-deep)" />
          <span style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 600 }}>
            {error}
          </span>
        </div>
      )}

      <GradientBtn
        icon="lock"
        c1="#2F6BFF"
        c2="#002855"
        disabled={!ready}
        onClick={onAccept}
        style={{ marginTop: reachedEnd ? 0 : 12 }}
      >
        {labels.accept}
      </GradientBtn>
    </div>
  );
}
