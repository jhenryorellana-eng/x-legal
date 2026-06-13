"use client";

/**
 * Public contract signing view (DOC-51 §27, prompt CLI-30).
 *
 * Mobile-first focused screen: no nav, no launcher. Zones:
 *  1. BrandBar + eyebrow.
 *  2. Contract summary card (service + plan chip, parties, payment plan with the
 *     down payment highlighted in a gold pill).
 *  3. Full contract with its OWN scroll; the signature zone is hidden until the
 *     reader scrolls to the bottom (scroll-gate).
 *  4. SignaturePad (the shared component) + acceptance checkbox.
 *  5. "Firmar contrato" GradientBtn — disabled until scroll + signature +
 *     checkbox; submits via the injected server action.
 *
 * On success → SigningSuccess; on CONTRACT_ALREADY_SIGNED → already variant.
 */

import * as React from "react";
import { Icon } from "@/frontend/components/brand/icon";
import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import {
  SignaturePad,
  type SignaturePadHandle,
} from "@/frontend/components/mobile/signature-pad";
import { BrandBar, formatCents } from "./brand-bar";
import { SigningSuccess } from "./signing-success";
import { CONTRACT_SECTIONS } from "./contract-text";
import type { SigningStrings, SigningLocale } from "./strings";
import type { SignResult } from "./actions";

interface Installment {
  number: number;
  amountCents: number;
  dueDate?: string | null;
  isDownpayment?: boolean;
}

interface Party {
  name: string;
  role: string;
}

export interface SigningViewProps {
  token: string;
  locale: SigningLocale;
  strings: SigningStrings;
  serviceLabel: string;
  planKind: "self" | "with_lawyer";
  totalCents: number;
  currency: string;
  installments: Installment[];
  parties: Party[];
  termsVersion: string | null;
  signAction: (token: string, signatureJpegDataUrl: string) => Promise<SignResult>;
}

function interp(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/** Re-encodes a PNG data URL to JPEG (white background) for the PDF embed. */
async function pngToJpeg(pngDataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width || 600;
      canvas.height = img.height || 200;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no-2d-context"));
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("img-load-failed"));
    img.src = pngDataUrl;
  });
}

export function SigningView(props: SigningViewProps) {
  const { strings: t, locale } = props;
  const padRef = React.useRef<SignaturePadHandle>(null);
  const scrollBoxRef = React.useRef<HTMLDivElement>(null);

  const [scrolledEnd, setScrolledEnd] = React.useState(false);
  const [signed, setSigned] = React.useState(false);
  const [accepted, setAccepted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [outcome, setOutcome] = React.useState<"signed" | "already" | null>(null);

  const onScroll = React.useCallback(() => {
    const el = scrollBoxRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 28) {
      setScrolledEnd(true);
    }
  }, []);

  // If the contract box doesn't overflow (short content / large screen), there
  // is nothing to scroll — unlock the signature zone immediately.
  React.useEffect(() => {
    const el = scrollBoxRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 28) setScrolledEnd(true);
  }, []);

  const canSign = scrolledEnd && signed && accepted && !submitting;

  async function handleSign() {
    if (!canSign) return;
    const png = padRef.current?.getDataUrl();
    if (!png) return;
    setSubmitting(true);
    setError(false);
    try {
      const jpeg = await pngToJpeg(png);
      const res = await props.signAction(props.token, jpeg);
      if (res.ok) {
        setOutcome(res.outcome ?? "signed");
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (outcome) {
    return <SigningSuccess strings={t} variant={outcome} />;
  }

  const downpayment = props.installments.find((i) => i.isDownpayment);
  const rest = props.installments.filter((i) => !i.isDownpayment);

  return (
    <main
      style={{
        minHeight: "100dvh",
        padding: "34px 18px 56px",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, var(--gold-soft) 0%, transparent 42%), var(--bg)",
      }}
    >
      <div
        style={{
          maxWidth: 560,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Zone 1 — Brand */}
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <BrandBar />
          <span
            style={{
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            {t.eyebrow}
          </span>
        </div>

        {/* Zone 2 — Contract summary */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2
              style={{
                margin: 0,
                fontFamily: "var(--font-title)",
                fontWeight: 800,
                fontSize: 20,
                color: "var(--navy)",
                flex: 1,
                minWidth: 0,
              }}
            >
              {props.serviceLabel || "—"}
            </h2>
            {props.planKind === "with_lawyer" ? (
              <span
                style={{
                  background: "var(--navy)",
                  color: "#fff",
                  borderRadius: 999,
                  padding: "5px 12px",
                  fontFamily: "var(--font-title)",
                  fontWeight: 800,
                  fontSize: 12.5,
                }}
              >
                {t.planWith}
              </span>
            ) : (
              <Chip tone="blue">{t.planSelf}</Chip>
            )}
          </div>

          {/* Parties */}
          {props.parties.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <SubLabel icon="user">{t.partiesTitle}</SubLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                {props.parties.map((p, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 999,
                        background: "linear-gradient(135deg, var(--accent), var(--navy))",
                        color: "#fff",
                        display: "grid",
                        placeItems: "center",
                        fontFamily: "var(--font-title)",
                        fontWeight: 800,
                        fontSize: 14,
                        flexShrink: 0,
                      }}
                    >
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                    <span style={{ fontSize: 15, color: "var(--ink)", fontWeight: 700 }}>
                      {p.name}
                      {p.role && (
                        <span style={{ color: "var(--ink-3)", fontWeight: 600 }}> — {p.role}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payment plan */}
          {props.installments.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <SubLabel icon="dollar">
                {interp(t.paymentTitle, { total: formatCents(props.totalCents, locale) })}
              </SubLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {downpayment && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "var(--gold-soft)",
                      borderRadius: 14,
                      padding: "11px 14px",
                    }}
                  >
                    <span style={{ fontSize: 14.5, fontWeight: 800, color: "var(--gold-deep)" }}>
                      {interp(t.downpayment, { amount: formatCents(downpayment.amountCents, locale) })}
                    </span>
                  </div>
                )}
                {rest.map((inst) => (
                  <div
                    key={inst.number}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 14px",
                      opacity: 0.7,
                    }}
                  >
                    <span style={{ fontSize: 14, color: "var(--ink-2)" }}>
                      {interp(t.installment, {
                        n: String(inst.number),
                        amount: formatCents(inst.amountCents, locale),
                      })}
                      {inst.dueDate ? ` · ${inst.dueDate}` : ""}
                    </span>
                    <Chip tone="blue">{t.scheduled}</Chip>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Zone 3 — Full contract with its own scroll (scroll-gate) */}
        <SubLabel icon="doc">{t.contractTitle}</SubLabel>
        <div
          ref={scrollBoxRef}
          onScroll={onScroll}
          data-testid="contract-scroll"
          style={{
            maxHeight: "46vh",
            overflowY: "auto",
            border: "1px solid var(--line)",
            borderRadius: 18,
            background: "var(--card)",
            padding: "18px 18px 24px",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {CONTRACT_SECTIONS[locale].map((sec, i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <h3
                style={{
                  margin: "0 0 6px",
                  fontFamily: "var(--font-title)",
                  fontWeight: 800,
                  fontSize: 15.5,
                  color: "var(--navy)",
                }}
              >
                {sec.title}
              </h3>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: "var(--ink-2)" }}>
                {sec.body}
              </p>
            </div>
          ))}
          {props.termsVersion && (
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
              {props.termsVersion}
            </p>
          )}
        </div>

        {/* Scroll hint (while not at the end) */}
        {!scrolledEnd && (
          <div
            className="anim-float-hint"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: "var(--ink-3)",
              fontSize: 13.5,
              fontWeight: 700,
            }}
          >
            <Icon name="chevD" size={16} color="var(--ink-3)" />
            {t.scrollHint}
          </div>
        )}

        {/* Zone 4 — Signature (revealed after scroll) */}
        {scrolledEnd && (
          <div className="anim-fade-in-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Card>
              <h3
                style={{
                  margin: "0 0 12px",
                  fontFamily: "var(--font-title)",
                  fontWeight: 800,
                  fontSize: 17,
                  color: "var(--ink)",
                }}
              >
                {t.signatureTitle}
              </h3>
              <SignaturePad
                ref={padRef}
                onChange={(s) => setSigned(s)}
                labels={{
                  draw: t.draw,
                  upload: t.upload,
                  placeholder: t.padPlaceholder,
                  legend: t.padLegend,
                  uploadPrompt: t.uploadPrompt,
                  required: t.sigRequired,
                  ready: t.sigReady,
                  clear: t.clear,
                  undo: t.undo,
                }}
              />

              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 11,
                  marginTop: 16,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  style={{ width: 24, height: 24, accentColor: "var(--accent)", marginTop: 1, cursor: "pointer", flexShrink: 0 }}
                />
                <span style={{ fontSize: 15, lineHeight: 1.45, color: "var(--ink)" }}>{t.accept}</span>
              </label>
            </Card>

            {/* Error banner — preserves the drawn signature */}
            {error && (
              <div
                role="alert"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  background: "var(--gold-soft)",
                  color: "var(--gold-deep)",
                  borderRadius: 14,
                  padding: "12px 14px",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                <Icon name="info" size={18} color="var(--gold-deep)" />
                {t.errorBanner}
              </div>
            )}
          </div>
        )}

        {/* Zone 5 — Action */}
        <GradientBtn
          icon="lock"
          disabled={!canSign}
          onClick={handleSign}
          full
        >
          {submitting ? t.signing : t.signCta}
        </GradientBtn>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            color: "var(--ink-3)",
            fontSize: 13.5,
            fontWeight: 600,
          }}
        >
          <Icon name="shield" size={16} color="var(--green)" />
          {t.trust}
        </div>
      </div>
    </main>
  );
}

function SubLabel({ icon, children }: { icon: "user" | "dollar" | "doc"; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <Icon name={icon} size={16} color="var(--ink-3)" />
      <span
        style={{
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 13.5,
          color: "var(--ink-2)",
        }}
      >
        {children}
      </span>
    </div>
  );
}
