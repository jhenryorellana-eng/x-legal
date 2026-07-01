"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Icon, Lex } from "@/frontend/components/brand";

/**
 * StaffView — placeholder for the "Vista staff" tab. The second delivery will
 * render the same Karelis case from the team panel (documents, validations, AI
 * generation). Kept as a structured stub so the tab already exists.
 */
export function StaffView() {
  const t = useTranslations("staff.demo");
  return (
    <div
      className="anim-fade-in-up"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 14,
        padding: "56px 24px",
        background: "var(--card)",
        border: "1px dashed var(--line)",
        borderRadius: 24,
        maxWidth: 520,
        margin: "0 auto",
      }}
    >
      <Lex size={92} mood="atento" />
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          color: "var(--gold-deep)",
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 12.5,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        <Icon name="sparkle" size={16} color="var(--gold-deep)" /> {t("comingSoon")}
      </span>
      <h2 className="t-black" style={{ margin: 0, fontSize: 24, color: "var(--navy)" }}>
        {t("staffSoonTitle")}
      </h2>
      <p style={{ margin: 0, maxWidth: 380, fontSize: 15, color: "var(--ink-2)", lineHeight: 1.55 }}>
        {t("staffSoonBody")}
      </p>
    </div>
  );
}
