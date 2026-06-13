import * as React from "react";
import { Lex } from "@/frontend/components/brand/lex";
import { Icon } from "@/frontend/components/brand/icon";

/**
 * AgendarBlocked — rebooking penalty screen (DOC-51 §18, RF-CLI-042 CA2).
 *
 * After a cancellation the Citas tab shows this empathetic block with the exact
 * date the client can book again (computed server-side from the case's
 * `rebooking_blocked_until`). Tone is reassuring, never punitive — Lex `calma`.
 *
 * Server-safe (no "use client"): purely presentational.
 */
export function AgendarBlocked({
  title,
  body,
  hint,
  unblockDate,
}: {
  title: string;
  body: string; // contains "{date}"
  hint: string;
  unblockDate: string;
}) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "54px 26px 140px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 16,
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      <Lex size={120} mood="calma" />
      <h1
        className="t-black"
        style={{ margin: 0, fontSize: 24, color: "var(--navy)", textWrap: "balance" }}
      >
        {title}
      </h1>
      <p
        style={{
          margin: 0,
          fontSize: 16,
          color: "var(--ink-2)",
          fontWeight: 500,
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        {body.replace("{date}", unblockDate)}
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--gold-soft)",
          borderRadius: 16,
          padding: "13px 16px",
          maxWidth: 330,
        }}
      >
        <Icon name="info" size={20} color="var(--gold-deep)" />
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--gold-deep)", textAlign: "left", lineHeight: 1.4 }}>
          {hint}
        </div>
      </div>
    </div>
  );
}
