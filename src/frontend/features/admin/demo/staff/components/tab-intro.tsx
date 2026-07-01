"use client";

import * as React from "react";
import { IconTile, type IconName } from "@/frontend/components/brand";

/** TabIntro — a small didactic banner at the top of a staff tab. */
export function TabIntro({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        background: "var(--blue-soft)",
        borderRadius: 16,
        padding: "12px 16px",
      }}
    >
      <IconTile name={icon} color="var(--accent)" size={38} radius={11} iconSize={20} />
      <span style={{ fontSize: 13.5, color: "var(--ink-2)", fontWeight: 600, lineHeight: 1.4 }}>{text}</span>
    </div>
  );
}
