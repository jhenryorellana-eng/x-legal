/**
 * No tengo acceso — /no-access (DOC-51-UI-CLIENTE §2, PROMPT-CLI-02)
 *
 * Public, no session required.
 * Also destination when: re-gate fails after OTP verification (RF-CLI-006).
 * Contact details come from orgs.settings (F0: demo values; prod: from DB).
 */

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Lex } from "@/frontend/components/brand/lex";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { Icon } from "@/frontend/components/brand/icon";
import {
  SUPPORT_WHATSAPP_URL,
  SUPPORT_TEL_URL,
  SUPPORT_PHONE_DISPLAY,
} from "@/shared/constants/contact";

export default async function NoAccessPage() {
  const t = await getTranslations("cliente.noAccess");

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        padding: "54px 20px 48px",
        background: "var(--bg)",
        gap: 28,
      }}
    >
      {/* Zona 1 — Cabecera de auth (back button) */}
      <div>
        <Link
          href="/welcome"
          aria-label="Volver a bienvenida"
          style={{
            width: 46,
            height: 46,
            borderRadius: "50%",
            background: "var(--card)",
            boxShadow: "0 4px 12px rgba(11,27,51,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textDecoration: "none",
          }}
        >
          <Icon name="chevL" size={20} color="var(--ink-2)" />
        </Link>
      </div>

      {/* Zona 2 — Héroe */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          textAlign: "center",
        }}
      >
        <Lex size={120} mood="atento" />
        <h1
          className="t-black"
          style={{ fontSize: 28, color: "var(--navy)" }}
        >
          {t("title")}
        </h1>
        <p
          style={{
            fontSize: 16.5,
            color: "var(--ink-2)",
            maxWidth: 330,
            lineHeight: 1.55,
          }}
        >
          {t("body")}
        </p>
      </div>

      {/* Zona 3 — Tarjetas de contacto */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* WhatsApp */}
        <a
          href={SUPPORT_WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-interactive
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "16px 20px",
            background: "var(--card)",
            borderRadius: 24,
            boxShadow: "0 10px 30px rgba(11,27,51,0.07)",
            textDecoration: "none",
            transition: "transform 0.18s var(--ease), box-shadow 0.18s var(--ease)",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "var(--green-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="whatsapp" size={24} color="var(--green)" />
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "var(--ink)",
                fontFamily: "var(--font-title)",
              }}
            >
              {t("whatsapp.title")}
            </div>
            <div style={{ fontSize: 13.5, color: "var(--ink-3)" }}>
              {t("whatsapp.sub")}
            </div>
          </div>
          <Icon name="chevR" size={18} color="var(--ink-3)" />
        </a>

        {/* Phone */}
        <a
          href={SUPPORT_TEL_URL}
          data-interactive
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "16px 20px",
            background: "var(--card)",
            borderRadius: 24,
            boxShadow: "0 10px 30px rgba(11,27,51,0.07)",
            textDecoration: "none",
            transition: "transform 0.18s var(--ease), box-shadow 0.18s var(--ease)",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "var(--blue-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="phone" size={24} color="var(--accent)" />
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "var(--ink)",
                fontFamily: "var(--font-title)",
              }}
            >
              {t("phone.title")}
            </div>
            <div style={{ fontSize: 13.5, color: "var(--ink-3)" }}>
              {SUPPORT_PHONE_DISPLAY}
            </div>
          </div>
          <Icon name="chevR" size={18} color="var(--ink-3)" />
        </a>

        {/* Website */}
        <a
          href="https://usalatinoprime.com"
          target="_blank"
          rel="noopener noreferrer"
          data-interactive
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "16px 20px",
            background: "var(--card)",
            borderRadius: 24,
            boxShadow: "0 10px 30px rgba(11,27,51,0.07)",
            textDecoration: "none",
            transition: "transform 0.18s var(--ease), box-shadow 0.18s var(--ease)",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "var(--navy-soft, #EAF0FB)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="globe" size={24} color="var(--navy)" />
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "var(--ink)",
                fontFamily: "var(--font-title)",
              }}
            >
              {t("website.title")}
            </div>
            <div style={{ fontSize: 13.5, color: "var(--ink-3)" }}>
              {t("website.sub")}
            </div>
          </div>
          <Icon name="chevR" size={18} color="var(--ink-3)" />
        </a>
      </div>

      {/* Zona 4 — CTA principal */}
      <a
        href="https://usalatinoprime.com"
        target="_blank"
        rel="noopener noreferrer"
        style={{ textDecoration: "none" }}
      >
        <GradientBtn icon="external" size="lg">
          {t("cta")}
        </GradientBtn>
      </a>

      {/* Zona 5 — Link de escape */}
      <div style={{ textAlign: "center" }}>
        <Link
          href="/entrar"
          style={{
            fontSize: 15,
            color: "var(--ink-2)",
            textDecoration: "none",
          }}
        >
          {t("escape").split("→")[0]}
          <span
            style={{
              color: "var(--accent)",
              fontWeight: 700,
            }}
          >
            → {t("escape").split("→")[1]?.trim()}
          </span>
        </Link>
      </div>
    </div>
  );
}
