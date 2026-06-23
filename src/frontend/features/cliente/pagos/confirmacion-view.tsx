"use client";

/**
 * ConfirmacionView — `/pagos/confirmacion`
 *
 * Polls the server-side reconcile action (which asks Stripe directly whether the
 * Checkout Session is paid) until the payment settles, then routes to `/pagos`.
 *
 * The server is authoritative (DOC-51 §8): this view only triggers the reconcile
 * and reflects its result — it never decides "paid" on its own. If the payment
 * has not settled within the poll budget, it routes to `/pagos` anyway (the
 * webhook / reconcile cron are the backstops; the payments screen will show the
 * cuota as "Procesando" until one of them lands).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lex } from "@/frontend/components/brand/lex";

export interface ConfirmacionLabels {
  title: string;
  body: string;
  confirmedTitle: string;
  confirmedBody: string;
}

type ReconcileResult =
  | { ok: true; settled: boolean; installmentStatus: string }
  | { ok: false; error: string };

const POLL_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 8; // ≈ 12 s of polling before graceful fallback

export function ConfirmacionView({
  sessionId,
  redirectTo,
  onReconcile,
  labels,
}: {
  sessionId: string | null;
  redirectTo: string;
  onReconcile: (sessionId: string) => Promise<ReconcileResult>;
  labels: ConfirmacionLabels;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = React.useState(false);

  React.useEffect(() => {
    // No session id (direct hit / cancelled): nothing to reconcile — just leave.
    if (!sessionId) {
      const t = setTimeout(() => router.replace(redirectTo), 2000);
      return () => clearTimeout(t);
    }

    let cancelled = false;
    let attempts = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const finish = (delay: number) => {
      timers.push(setTimeout(() => router.replace(redirectTo), delay));
    };

    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const res = await onReconcile(sessionId);
        if (cancelled) return;
        if (res.ok && (res.settled || res.installmentStatus === "paid")) {
          setConfirmed(true);
          finish(1300); // let the user see the confirmed state briefly
          return;
        }
      } catch {
        // ignore — fall through to retry / timeout
      }
      if (attempts >= MAX_ATTEMPTS) {
        finish(0); // graceful fallback — backstops will settle it
        return;
      }
      timers.push(setTimeout(tick, POLL_INTERVAL_MS));
    };

    void tick();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [sessionId, redirectTo, onReconcile, router]);

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
          {confirmed ? labels.confirmedTitle : labels.title}
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
          {confirmed ? labels.confirmedBody : labels.body}
        </p>
      </div>

      {confirmed ? (
        // Success check
        <div
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            borderRadius: 999,
            display: "grid",
            placeItems: "center",
            background: "color-mix(in srgb, var(--accent) 14%, transparent)",
            color: "var(--accent)",
            fontSize: 30,
            fontWeight: 800,
          }}
        >
          ✓
        </div>
      ) : (
        // Animated dots while reconciling
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
      )}

      <style>{`
        @keyframes pulse {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
