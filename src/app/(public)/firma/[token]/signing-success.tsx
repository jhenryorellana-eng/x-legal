"use client";

/**
 * Success / already-signed screen (DOC-51 §27 estados 3 y 4).
 *
 * Check verde 96px en disco green-soft con animación pop. The token is already
 * nulled, so there are no navigation actions. `variant="already"` swaps only the
 * heading; the access message is identical.
 */

import { Icon } from "@/frontend/components/brand/icon";
import { Lex } from "@/frontend/components/brand/lex";
import { BrandBar } from "./brand-bar";
import type { SigningStrings } from "./strings";

export function SigningSuccess({
  strings,
  variant = "signed",
}: {
  strings: SigningStrings;
  variant?: "signed" | "already";
}) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 20px 64px",
        gap: 20,
        background:
          "radial-gradient(120% 70% at 50% 0%, var(--card) 0%, var(--bg) 55%, var(--green-soft) 100%)",
      }}
    >
      <BrandBar />

      <div
        style={{
          width: "100%",
          maxWidth: 480,
          marginTop: 24,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 16,
        }}
      >
        <div
          className="anim-check-pop"
          style={{
            width: 96,
            height: 96,
            borderRadius: 999,
            background: "var(--green-soft)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Icon name="check" size={48} color="var(--green)" stroke={3} />
        </div>

        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 26,
            color: "var(--ink)",
          }}
        >
          {variant === "already" ? strings.alreadyTitle : strings.successTitle}
        </h1>
        <p
          style={{
            margin: 0,
            maxWidth: 360,
            fontSize: 16,
            lineHeight: 1.5,
            color: "var(--ink-2)",
          }}
        >
          {strings.successBody}
        </p>

        <Lex size={120} mood="feliz" />
      </div>
    </main>
  );
}
