/**
 * 404 — global Not Found (Next.js App Router file convention).
 *
 * Rendered (wrapped in the root layout) for any URL that matches no route, and
 * also whenever `notFound()` is thrown without a closer not-found boundary.
 * Vercel serves it with a real HTTP 404 status.
 *
 * Public, no session required. Mirrors the brand language of /welcome
 * (radial brand gradient + gold sparkles + Lex), with the "404" as the hero
 * rendered in the azul→dorado brand gradient. Lex is "atento" — present and
 * ready to help, never scolding (DOC-01 §8.7).
 */

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Lex } from "@/frontend/components/brand/lex";
import { Logo } from "@/frontend/components/brand/logo";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { Icon } from "@/frontend/components/brand/icon";
import { SUPPORT_WHATSAPP_URL } from "@/shared/constants/contact";

export default async function NotFound() {
  const t = await getTranslations("notFound");

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
      {/* Sparkles (5 decorative, gold) — same composition as /welcome */}
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
      <Logo size={30} withWordmark wordmarkSize={16} label="X Legal" />

      {/* Zona 2 — Hero central */}
      <div
        className="anim-fade-in-up"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          flex: 1,
          justifyContent: "center",
          animationDuration: "0.6s",
          animationTimingFunction: "ease",
          animationFillMode: "both",
        }}
      >
        <Lex size={132} mood="atento" />

        {/* The "404" hero — brand gradient text (azul → dorado) */}
        <div
          aria-hidden="true"
          className="t-black"
          style={{
            fontSize: "clamp(72px, 26vw, 104px)",
            lineHeight: 0.92,
            letterSpacing: "-0.04em",
            backgroundImage:
              "linear-gradient(125deg, var(--accent) 0%, var(--accent-deep) 38%, var(--gold-deep) 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            marginTop: 4,
          }}
        >
          404
        </div>

        <div style={{ textAlign: "center" }}>
          <p
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginBottom: 8,
            }}
          >
            {t("eyebrow")}
          </p>
          <h1
            className="t-black"
            style={{
              fontSize: 27,
              color: "var(--navy)",
              textWrap: "balance",
              marginBottom: 12,
            }}
          >
            {t("title")}
          </h1>
          <p
            style={{
              fontSize: 16.5,
              color: "var(--ink-2)",
              maxWidth: 340,
              margin: "0 auto",
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
          maxWidth: 420,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          animationDuration: "0.6s",
          animationDelay: "0.15s",
          animationTimingFunction: "ease",
          animationFillMode: "both",
        }}
      >
        <Link href="/" style={{ textDecoration: "none" }}>
          <GradientBtn icon="home" size="lg">
            {t("home")}
          </GradientBtn>
        </Link>

        <a
          href={SUPPORT_WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: "none" }}
        >
          <GhostBtn icon="whatsapp" size="lg" color="var(--green)">
            {t("help")}
          </GhostBtn>
        </a>
      </div>
    </div>
  );
}
