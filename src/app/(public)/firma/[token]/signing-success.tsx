"use client";

/**
 * Success / already-signed screen (DOC-51 §27 estados 3 y 4).
 *
 * Check verde 96px en disco green-soft con animación pop. `variant="already"`
 * swaps only the heading; the access message is identical.
 *
 * Exit affordance (Henry 2026-07-14): the screen offers a "Volver al inicio"
 * button and auto-redirects to /home after REDIRECT_SECONDS so the signer is never
 * stranded. A logged-in client lands on their dashboard; an anonymous third party
 * is bounced by /home to /welcome (acceptable — they have no dashboard).
 */

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/frontend/components/brand/icon";
import { Lex } from "@/frontend/components/brand/lex";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { BrandBar } from "./brand-bar";
import type { SigningStrings } from "./strings";

const REDIRECT_SECONDS = 5;

export function SigningSuccess({
  strings,
  variant = "signed",
}: {
  strings: SigningStrings;
  variant?: "signed" | "already";
}) {
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = React.useState(REDIRECT_SECONDS);

  React.useEffect(() => {
    const tick = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    const redirect = setTimeout(() => router.push("/home"), REDIRECT_SECONDS * 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(redirect);
    };
  }, [router]);

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

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginTop: 8, width: "100%" }}>
          <GradientBtn icon="home" full={false} onClick={() => router.push("/home")}>
            {strings.backHome}
          </GradientBtn>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-3)" }} aria-live="polite">
            {strings.redirecting.replace("{n}", String(secondsLeft))}
          </p>
        </div>
      </div>
    </main>
  );
}
