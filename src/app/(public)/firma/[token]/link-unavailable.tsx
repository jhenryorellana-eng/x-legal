/**
 * "Link unavailable" screen — uniform, CERO datos del contrato (DOC-22 §4).
 *
 * Shown for any token failure (invalid / expired / consumed / rate limit). The
 * firmante legítimo and an attacker see the exact same screen; the page never
 * reveals the reason. Contact info is generic (no PII, anti-enumeration): we
 * point to "tu asesora" without exposing org phone numbers from the anonymous
 * surface.
 */

import { Lex } from "@/frontend/components/brand/lex";
import { Icon } from "@/frontend/components/brand/icon";
import { BrandBar } from "./brand-bar";
import type { SigningStrings, SigningLocale } from "./strings";

export function LinkUnavailable({
  strings,
}: {
  strings: SigningStrings;
  locale: SigningLocale;
}) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 20px 64px",
        gap: 22,
        background:
          "radial-gradient(120% 70% at 50% 0%, var(--card) 0%, var(--bg) 55%, var(--blue-soft) 100%)",
      }}
    >
      <BrandBar />

      <div
        style={{
          width: "100%",
          maxWidth: 480,
          marginTop: 28,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 14,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 64,
            height: 64,
            borderRadius: 999,
            background: "var(--chip)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Icon name="info" size={32} color="var(--ink-3)" />
        </div>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 22,
            color: "var(--ink)",
          }}
        >
          {strings.unavailableTitle}
        </h1>
        <p
          style={{
            margin: 0,
            maxWidth: 340,
            fontSize: 16,
            lineHeight: 1.5,
            color: "var(--ink-2)",
          }}
        >
          {strings.unavailableBody}
        </p>

        <Lex size={104} mood="atento" />
      </div>
    </main>
  );
}
