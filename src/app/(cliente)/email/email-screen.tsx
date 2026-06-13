"use client";

/**
 * EmailScreen — client component for the /email page.
 * Handles email input with live validation, then calls requestClientOtpAction(email)
 * and navigates to /otp?email=<encoded>.
 *
 * Design mirrors PhoneScreen exactly (same brand tokens, layout zones, animations).
 * All messages are passed as props (resolved server-side by the RSC wrapper).
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { Icon } from "@/frontend/components/brand/icon";
import { requestClientOtpAction } from "@/backend/modules/identity/actions";

interface EmailScreenProps {
  messages: {
    eyebrow: string;
    title: string;
    body: string;
    placeholder: string;
    trustBadge: string;
    cta: string;
    noAccess: string;
    footerBadge: string;
    errorRateLimit: string;
    errorInvalidEmail: string;
    errorGeneric: string;
  };
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

export function EmailScreen({ messages }: EmailScreenProps) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const trimmed = email.trim();
  const isComplete = isValidEmail(trimmed);

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    setEmail(e.target.value);
    setError(null);
  }

  function borderColor(): string {
    if (trimmed.length === 0) return "transparent";
    if (isComplete) return "var(--green)";
    return "var(--accent)";
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!isComplete || loading) return;
    setLoading(true);
    setError(null);

    const result = await requestClientOtpAction(trimmed);

    setLoading(false);

    if (!result.ok) {
      const code = result.error?.code;
      if (code === "rate_limited") setError(messages.errorRateLimit);
      else if (code === "invalid_email") setError(messages.errorInvalidEmail);
      else setError(messages.errorGeneric);
      return;
    }

    // Navigate to OTP screen with email in URL search params
    router.push(`/otp?email=${encodeURIComponent(trimmed)}`);
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
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Link
          href="/welcome"
          aria-label="Volver"
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
            flexShrink: 0,
          }}
        >
          <Icon name="chevL" size={20} color="var(--ink-2)" />
        </Link>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
          }}
        >
          {messages.eyebrow}
        </span>
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
          {messages.body}
        </p>
      </div>

      {/* Zona 3 — Email input */}
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ position: "relative" }}>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder={messages.placeholder}
            value={email}
            onChange={handleInput}
            autoFocus
            disabled={loading}
            style={{
              width: "100%",
              height: 64,
              borderRadius: 16,
              border: `2px solid ${borderColor()}`,
              background: "var(--card)",
              color: "var(--ink)",
              fontFamily: "var(--font-title)",
              fontWeight: 600,
              fontSize: 17,
              padding: "0 50px 0 18px",
              outline: "none",
              boxSizing: "border-box",
              transition: "border-color 0.2s ease",
            }}
          />
          {isComplete && (
            <div
              style={{
                position: "absolute",
                right: 16,
                top: "50%",
                transform: "translateY(-50%)",
              }}
            >
              <Icon name="check" size={20} color="var(--green)" />
            </div>
          )}
        </div>

        {/* Error toast */}
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

        {/* Zona 4 — Trust badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Icon name="shield" size={15} color="var(--green)" />
          <span style={{ fontSize: 13.5, color: "var(--ink-3)" }}>
            {messages.trustBadge}
          </span>
        </div>

        {/* Zona 5 — Actions */}
        <GradientBtn
          icon="lock"
          size="lg"
          type="submit"
          disabled={!isComplete || loading}
        >
          {loading ? "…" : messages.cta}
        </GradientBtn>

        <div style={{ textAlign: "center" }}>
          <Link
            href="/no-access"
            style={{
              fontSize: 15,
              color: "var(--accent)",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {messages.noAccess}
          </Link>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <Icon name="lock" size={13} color="var(--green)" />
          <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
            {messages.footerBadge}
          </span>
        </div>
      </form>
    </div>
  );
}
