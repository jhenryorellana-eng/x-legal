"use client";

/**
 * EntrarScreen — client component for the /entrar page (DOC-22 §1, phone-only
 * login, June 2026). The client types ONLY their phone number and is signed in
 * directly — no email, no code, no OTP (TEMPORARY: SMS-OTP comes later). On
 * success the SSR session cookie is set by loginClientByPhoneAction and we
 * navigate to /home.
 *
 * All messages are passed as props (resolved server-side by the RSC wrapper).
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { Icon } from "@/frontend/components/brand/icon";
import { loginClientByPhoneAction } from "@/backend/modules/identity/actions";

interface EntrarScreenProps {
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
    errorInvalidPhone: string;
    errorNoAccess: string;
    errorGeneric: string;
  };
}

/**
 * Mirrors the server's normalizePhoneE164 acceptance: exactly 10 digits, or 11
 * digits starting with "1" (US country code). Keeps the submit button + check
 * mark from lighting up for digit counts the server would reject.
 */
function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
}

export function EntrarScreen({ messages }: EntrarScreenProps) {
  const router = useRouter();
  const [phone, setPhone] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const trimmed = phone.trim();
  const isComplete = isValidPhone(trimmed);

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    setPhone(e.target.value.replace(/[^\d() +-]/g, ""));
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

    const result = await loginClientByPhoneAction(trimmed);

    if (!result.ok) {
      setLoading(false);
      const code = result.error?.code;
      if (code === "rate_limited") setError(messages.errorRateLimit);
      else if (code === "invalid_phone") setError(messages.errorInvalidPhone);
      else if (code === "no_access") setError(messages.errorNoAccess);
      else setError(messages.errorGeneric);
      return;
    }

    // Session cookie is set — go straight to the client home (no OTP step).
    setLoading(false);
    router.push("/home");
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

      {/* Zona 3 — Phone input */}
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ position: "relative" }}>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={messages.placeholder}
            value={phone}
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
