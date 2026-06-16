"use client";

/**
 * ConfirmacionView — `/pagos/confirmacion`
 *
 * Shows a "Confirmando tu pago…" spinner while polling for payment status.
 * Redirects to `redirectTo` once confirmed or after a timeout.
 *
 * TODO BIL-CONF-1: Swap polling loop for Supabase Realtime subscription
 * to `installments` table once client-surface Realtime is wired.
 *
 * TODO BIL-CONF-2: Pass the `session_id` query param from the URL and call
 * GET /api/v1/installments/[id]/payment-status (API-BIL-03) to actively poll.
 * Currently we redirect after a fixed delay as a graceful fallback (the webhook
 * WH-01 will have finalized the payment server-side before the user lands here).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lex } from "@/frontend/components/brand/lex";

export interface ConfirmacionLabels {
  title: string;
  body: string;
}

export function ConfirmacionView({
  redirectTo,
  labels,
}: {
  redirectTo: string;
  labels: ConfirmacionLabels;
}) {
  const router = useRouter();

  React.useEffect(() => {
    // Redirect after 4 s — the webhook will have settled the payment by then.
    // TODO BIL-CONF-2: Replace with active polling of API-BIL-03.
    const t = setTimeout(() => router.replace(redirectTo), 4000);
    return () => clearTimeout(t);
  }, [router, redirectTo]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
        gap: 24,
        textAlign: "center",
      }}
    >
      <Lex size={110} mood="feliz" />

      <div>
        <h1
          className="t-black"
          style={{ margin: "0 0 10px", fontSize: 26, color: "var(--navy)" }}
        >
          {labels.title}
        </h1>
        <p
          style={{
            margin: 0,
            color: "var(--ink-2)",
            fontSize: 16,
            lineHeight: 1.55,
            maxWidth: 300,
          }}
        >
          {labels.body}
        </p>
      </div>

      {/* Animated dots */}
      <div style={{ display: "flex", gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: "var(--accent)",
              animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
