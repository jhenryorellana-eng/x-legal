/**
 * Bienvenida — /welcome (DOC-51-UI-CLIENTE §1, PROMPT-CLI-01)
 *
 * Public, no session required. Static screen.
 * Guard: middleware redirects to /home if session already exists.
 */

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Lex } from "@/frontend/components/brand/lex";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { Icon } from "@/frontend/components/brand/icon";

export default async function WelcomePage() {
  const t = await getTranslations("cliente.welcome");

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "54px 20px 48px",
        background:
          "radial-gradient(120% 70% at 50% 0%, var(--card) 0%, var(--bg) 55%, var(--blue-soft) 100%)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Sparkles (5 decorative, gold) */}
      {[
        { top: "12%", left: "8%", delay: "0s" },
        { top: "8%", right: "12%", delay: "1s" },
        { top: "28%", right: "5%", delay: "2s" },
        { top: "18%", left: "22%", delay: "0.7s" },
        { top: "35%", left: "5%", delay: "1.5s" },
      ].map((pos, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="anim-glow-breath"
          style={{
            position: "absolute",
            opacity: 0.5,
            animationDuration: `${3 + i}s`,
            animationDelay: pos.delay,
            ...pos,
          }}
        >
          <Icon name="sparkle" size={18} color="var(--gold)" fill="var(--gold)" />
        </span>
      ))}

      {/* Zona 1 — BrandBar */}
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          {/* Tricolor bar */}
          <div style={{ display: "flex", gap: 2 }}>
            {["var(--navy)", "#fff", "#E4002B"].map((c, i) => (
              <div
                key={i}
                style={{ width: 6, height: 20, borderRadius: 2, background: c }}
              />
            ))}
          </div>
          <span
            style={{
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 16,
              color: "var(--navy)",
              letterSpacing: "-0.02em",
            }}
          >
            USALATINO
            <span style={{ color: "var(--accent)" }}>PRIME</span>
          </span>
        </div>
      </div>

      {/* Zona 2 — Hero central */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          flex: 1,
          justifyContent: "center",
        }}
      >
        <Lex size={166} mood="feliz" />
        <div style={{ textAlign: "center" }}>
          <h1
            className="t-black"
            style={{
              fontSize: 30,
              color: "var(--navy)",
              textWrap: "balance",
              marginBottom: 12,
            }}
          >
            {t("title")}
          </h1>
          <p
            style={{
              fontSize: 17,
              color: "var(--ink-2)",
              maxWidth: 320,
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            {t("subtitle")}
          </p>
        </div>
      </div>

      {/* Zona 3 — Acciones */}
      <div
        className="anim-fade-in-up"
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          animationDuration: "0.6s",
          animationTimingFunction: "ease",
          animationFillMode: "both",
        }}
      >
        <Link href="/phone" style={{ textDecoration: "none" }}>
          <GradientBtn icon="lock" size="lg">
            {t("cta")}
          </GradientBtn>
        </Link>

        <Link href="/no-access" style={{ textDecoration: "none" }}>
          <GhostBtn icon="help" size="lg">
            {t("noAccess")}
          </GhostBtn>
        </Link>

        {/* Sello de confianza */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <Icon name="shield" size={15} color="var(--green)" />
          <span
            style={{
              fontSize: 13.5,
              color: "var(--ink-3)",
            }}
          >
            {t("trustBadge")}
          </span>
        </div>
      </div>
    </div>
  );
}
