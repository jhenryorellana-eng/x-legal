import * as React from "react";
import { Icon, type IconName } from "@/frontend/components/brand/icon";

/** Small section header used across the shared-case tabs. */
export function SectionLabel({
  icon,
  children,
}: {
  icon: IconName;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Icon name={icon} size={17} color="var(--ink-3)" />
      <span
        style={{
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 14,
          color: "var(--ink)",
        }}
      >
        {children}
      </span>
    </div>
  );
}

/** Formats integer cents as USD. */
export function formatCents(cents: number, locale: "es" | "en" = "es"): string {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-US", {
    style: "currency",
    currency: "USD",
  }).format((cents ?? 0) / 100);
}
