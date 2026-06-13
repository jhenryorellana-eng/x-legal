"use client";

/**
 * OtpScreen — client component for the /otp page (PROMPT-CLI-04).
 *
 * Features:
 * - 6-box OTP input (gold border on error — NEVER red)
 * - 45s countdown timer before resend is available
 * - Auto-submit on 6th digit
 * - "Cambiar correo" always available
 *
 * Email OTP migration (DOC-22 §1, June 2026):
 * Reads ?email= param. Code now arrives by email, not SMS.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { OtpInput } from "@/frontend/components/brand/otp-input";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { Icon } from "@/frontend/components/brand/icon";
import { verifyClientOtpAction, requestClientOtpAction } from "@/backend/modules/identity/actions";

interface OtpScreenProps {
  messages: {
    title: string;
    bodyPrefix: string;
    resendCountdown: string;
    resendBtn: string;
    changeEmail: string;
    cta: string;
    footerBadge: string;
    errorCode: string;
    errorRateLimit: string;
  };
}

const RESEND_SECONDS = 45;

export function OtpScreen({ messages }: OtpScreenProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Email is passed as a URL param (encoded display value)
  const email = searchParams.get("email") ?? "";

  const [otpValue, setOtpValue] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [countdown, setCountdown] = React.useState(RESEND_SECONDS);
  const [canResend, setCanResend] = React.useState(false);

  // Countdown timer
  React.useEffect(() => {
    if (countdown <= 0) {
      setCanResend(true);
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  function formatCountdown(seconds: number): string {
    return `0:${String(seconds).padStart(2, "0")}`;
  }

  async function handleVerify(code: string) {
    if (code.length < 6 || loading) return;
    setLoading(true);
    setError(null);

    const result = await verifyClientOtpAction(email, code);
    setLoading(false);

    if (!result.ok) {
      const msg =
        result.error?.code === "rate_limited"
          ? messages.errorRateLimit
          : messages.errorCode;
      setError(msg);
      return;
    }

    // Success — navigate to home
    router.push("/home");
  }

  async function handleResend() {
    if (!canResend || loading) return;
    setCanResend(false);
    setCountdown(RESEND_SECONDS);
    setOtpValue("");
    setError(null);

    // Re-request OTP (passes through gate silently)
    await requestClientOtpAction(email);
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        padding: "54px 20px 48px",
        background: "var(--bg)",
        gap: 28,
      }}
    >
      {/* Zona 1 — Cabecera */}
      <div>
        <Link
          href="/email"
          aria-label="Volver al correo"
          style={{
            width: 46,
            height: 46,
            borderRadius: "50%",
            background: "var(--card)",
            boxShadow: "0 4px 12px rgba(11,27,51,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textDecoration: "none",
          }}
        >
          <Icon name="chevL" size={20} color="var(--ink-2)" />
        </Link>
      </div>

      {/* Zona 2 — Título */}
      <div>
        <h1
          className="t-black"
          style={{ fontSize: 26, color: "var(--navy)", marginBottom: 10 }}
        >
          {messages.title}
        </h1>
        <p style={{ fontSize: 15.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
          {messages.bodyPrefix}{" "}
          <span
            style={{
              fontWeight: 700,
              color: "var(--navy)",
              fontFamily: "var(--font-title)",
            }}
          >
            {email}
          </span>
          .
        </p>
      </div>

      {/* Zona 3 — OtpInput */}
      <OtpInput
        value={otpValue}
        onChange={setOtpValue}
        onComplete={handleVerify}
        error={!!error}
        disabled={loading}
      />

      {/* Zona 4 — Error banner */}
      {error && (
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            borderRadius: 14,
            background: "var(--gold-soft)",
            color: "var(--gold-deep)",
            fontSize: 14.5,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon name="info" size={16} color="var(--gold-deep)" />
          {error}
        </div>
      )}

      {/* Zona 5 — Fila de reenvío */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        {canResend ? (
          <button
            type="button"
            onClick={handleResend}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 14.5,
              color: "var(--accent)",
              fontWeight: 700,
              fontFamily: "var(--font-title)",
              padding: 0,
            }}
          >
            {messages.resendBtn}
          </button>
        ) : (
          <span style={{ fontSize: 14, color: "var(--ink-3)" }}>
            {messages.resendCountdown.replace(
              "{seconds}",
              formatCountdown(countdown),
            )}
          </span>
        )}

        <Link
          href="/email"
          style={{
            fontSize: 14,
            color: "var(--accent)",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {messages.changeEmail}
        </Link>
      </div>

      {/* Zona 6 — CTA + footer badge */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <GradientBtn
          icon="lock"
          size="lg"
          disabled={otpValue.length < 6 || loading}
          onClick={() => handleVerify(otpValue)}
        >
          {loading ? "…" : messages.cta}
        </GradientBtn>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <Icon name="shield" size={14} color="var(--green)" />
          <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
            {messages.footerBadge}
          </span>
        </div>
      </div>
    </div>
  );
}
