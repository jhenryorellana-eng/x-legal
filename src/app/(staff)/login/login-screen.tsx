"use client";

/**
 * StaffLoginScreen — email + password login for staff (DOC-22 §2.1).
 *
 * Calls Supabase Auth signInWithPassword directly via a server action.
 * On success: middleware detects must_change_password and redirects to
 * /cambiar-password if needed; otherwise goes to /admin.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { Icon } from "@/frontend/components/brand/icon";
import { Logo } from "@/frontend/components/brand/logo";
import { PortalSwitchLink } from "@/frontend/components/brand/portal-switch-link";
import { signInStaffAction } from "@/backend/modules/identity/actions";

interface StaffLoginScreenProps {
  messages: {
    title: string;
    subtitle: string;
    emailLabel: string;
    passwordLabel: string;
    cta: string;
    forgotPassword: string;
    clientAccess: string;
    errorCredentials: string;
    errorRateLimit: string;
    errorGeneric: string;
  };
}

export function StaffLoginScreen({ messages }: StaffLoginScreenProps) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password || loading) return;
    setLoading(true);
    setError(null);

    const result = await signInStaffAction(email, password);
    setLoading(false);

    if (!result.ok) {
      const code = result.error?.code;
      if (code === "rate_limited") setError(messages.errorRateLimit);
      else if (code === "invalid_credentials") setError(messages.errorCredentials);
      else setError(messages.errorGeneric);
      return;
    }

    router.push("/admin");
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: 56,
    borderRadius: 14,
    border: "1.5px solid var(--line)",
    background: "var(--card)",
    color: "var(--ink)",
    fontFamily: "var(--font-body)",
    fontSize: 16,
    padding: "0 16px",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.2s ease",
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 20px",
        background: "radial-gradient(ellipse at 60% 0%, var(--blue-soft) 0%, var(--bg) 60%)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {/* Brand */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 16,
          }}
        >
          <Logo
            size={64}
            withWordmark
            direction="column"
            wordmarkSize={19}
            elevated
            label="X Legal"
          />
          <div>
            <h1
              className="t-black"
              style={{ fontSize: 24, color: "var(--navy)", marginBottom: 6 }}
            >
              {messages.title}
            </h1>
            <p style={{ fontSize: 14, color: "var(--ink-3)" }}>{messages.subtitle}</p>
          </div>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{
            background: "var(--card)",
            borderRadius: 24,
            padding: "28px 24px",
            boxShadow: "0 12px 40px rgba(11,27,51,0.09)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* Email */}
          <div>
            <label
              htmlFor="email"
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink-2)",
                marginBottom: 6,
              }}
            >
              {messages.emailLabel}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); }}
              required
              style={inputStyle}
            />
          </div>

          {/* Password */}
          <div>
            <label
              htmlFor="password"
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink-2)",
                marginBottom: 6,
              }}
            >
              {messages.passwordLabel}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
              required
              style={inputStyle}
            />
          </div>

          {/* Error */}
          {error && (
            <div
              role="alert"
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                background: "var(--gold-soft)",
                color: "var(--gold-deep)",
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Icon name="info" size={15} color="var(--gold-deep)" />
              {error}
            </div>
          )}

          <GradientBtn
            type="submit"
            disabled={!email || !password || loading}
            size="lg"
          >
            {loading ? "…" : messages.cta}
          </GradientBtn>
        </form>

        {/* Forgot password */}
        <div style={{ textAlign: "center" }}>
          <Link
            href="/reset-password"
            style={{
              fontSize: 14,
              color: "var(--accent)",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {messages.forgotPassword}
          </Link>
        </div>

        {/* Cruce de portal: cliente que abrió el login de staff por error */}
        <PortalSwitchLink href="/welcome" label={messages.clientAccess} />
      </div>
    </div>
  );
}
