"use client";

import * as React from "react";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { Icon } from "@/frontend/components/brand/icon";
import { updateStaffPasswordAction } from "@/backend/modules/identity/actions";

interface CambiarPasswordScreenProps {
  messages: {
    title: string;
    body: string;
    newPasswordLabel: string;
    confirmPasswordLabel: string;
    cta: string;
    requirements: string;
    errorTooShort: string;
    errorTooWeak: string;
    errorMismatch: string;
  };
}

export function CambiarPasswordScreen({ messages }: CambiarPasswordScreenProps) {
  const [newPassword, setNewPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError(messages.errorMismatch);
      return;
    }
    setLoading(true);
    setError(null);

    const result = await updateStaffPasswordAction(newPassword);
    setLoading(false);

    if (!result.ok) {
      const code = result.error?.code;
      if (code === "password_too_short") setError(messages.errorTooShort);
      else if (code === "password_too_weak") setError(messages.errorTooWeak);
      else setError(result.error?.message ?? "Error desconocido.");
    }
    // On success, the action redirects to /admin (via redirect() in actions.ts)
  }

  const inputStyle: React.CSSProperties = {
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
  };

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
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--ink-2)", marginBottom: 6 }}>
              {messages.newPasswordLabel}
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setError(null); }}
              required
              autoComplete="new-password"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--ink-2)", marginBottom: 6 }}>
              {messages.confirmPasswordLabel}
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(null); }}
              required
              autoComplete="new-password"
              style={inputStyle}
            />
          </div>

          <p style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
            {messages.requirements}
          </p>

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

          <GradientBtn type="submit" disabled={!newPassword || !confirm || loading} size="lg">
            {loading ? "…" : messages.cta}
          </GradientBtn>
        </form>
      </div>
    </div>
  );
}
