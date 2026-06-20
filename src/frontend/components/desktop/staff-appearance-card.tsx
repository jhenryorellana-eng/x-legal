"use client";

/**
 * StaffAppearanceCard — theme (light/dark) + text-size control for the staff
 * Configuración pages (DOC-01 §4, §8.5). On mobile the topbar hides these
 * controls (they overflowed → horizontal scroll), so this card is where staff
 * change appearance on phones; on desktop the topbar shortcut still works too.
 *
 * Wraps the shared `ThemeToggle` (which owns the theme + text-scale logic via the
 * no-flash theme lib / localStorage) in a token-styled card matching
 * StaffLanguageCard.
 */

import * as React from "react";
import { ThemeToggle } from "@/frontend/components/brand/theme-toggle";

export interface StaffAppearanceCardProps {
  strings: { title: string; subtitle?: string };
}

export function StaffAppearanceCard({ strings }: StaffAppearanceCardProps) {
  return (
    <div
      style={{
        maxWidth: 760,
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 18,
        padding: "20px 22px",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 15.5,
          color: "var(--ink)",
        }}
      >
        {strings.title}
      </div>
      {strings.subtitle ? (
        <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2, fontWeight: 600 }}>
          {strings.subtitle}
        </div>
      ) : null}
      <div style={{ marginTop: 14 }}>
        <ThemeToggle />
      </div>
    </div>
  );
}
