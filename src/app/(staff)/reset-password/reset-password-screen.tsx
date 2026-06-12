"use client";

import * as React from "react";
import Link from "next/link";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { Icon } from "@/frontend/components/brand/icon";
import { requestStaffPasswordResetAction } from "@/backend/modules/identity/actions";

interface ResetPasswordScreenProps {
  messages: {
    title: string;
    body: string;
    emailLabel: string;
    cta: string;
    successMessage: string;
    backToLogin: string;
  };
}

export function ResetPasswordScreen({ messages }: ResetPasswordScreenProps) {
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || loading) return;
    setLoading(true);
    await requestStaffPasswordResetAction(email);
    setLoading(false);
    setSent(true);
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 20px",
        background: "var(--bg)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 24 }}>
        <div>
          <h1 className="t-black" style={{ fontSize: 26, color: "var(--navy)", marginBottom: 8 }}>
            {messages.title}
          </h1>
          <p style={{ fontSize: 15, color: "var(--ink-2)", lineHeight: 1.55 }}>
            {messages.body}
          </p>
        </div>

        {sent ? (
          <div
            style={{
              padding: "18px 20px",
              background: "var(--green-soft)",
              borderRadius: 16,
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <Icon name="check" size={18} color="var(--green)" />
            <span style={{ fontSize: 15, color: "var(--green)", lineHeight: 1.5 }}>
              {messages.successMessage}
            </span>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: 16 }}
          >
            <div>
              <label
                htmlFor="email"
                style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--ink-2)", marginBottom: 6 }}
              >
                {messages.emailLabel}
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: "100%",
                  height: 56,
                  borderRadius: 14,
                  border: "1.5px solid var(--line)",
                  background: "var(--card)",
                  color: "var(--ink)",
                  fontSize: 16,
                  padding: "0 16px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <GradientBtn type="submit" disabled={!email || loading} size="lg">
              {loading ? "…" : messages.cta}
            </GradientBtn>
          </form>
        )}

        <Link
          href="/login"
          style={{ fontSize: 14, color: "var(--accent)", fontWeight: 600, textDecoration: "none", textAlign: "center" }}
        >
          {messages.backToLogin}
        </Link>
      </div>
    </div>
  );
}
