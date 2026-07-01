"use client";

import * as React from "react";
import { Icon } from "@/frontend/components/brand";

/**
 * Caption — the didactic narrator banner shown under the phone. Re-keys on the
 * text so each stage change replays the cascade entrance. Toggle lives in the
 * experience header.
 */
export function Caption({ text }: { text: string }) {
  return (
    <div
      key={text}
      className="demo-cascade"
      style={{
        maxWidth: 392,
        margin: "16px auto 0",
        display: "flex",
        gap: 11,
        alignItems: "center",
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        padding: "13px 16px",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 34,
          height: 34,
          borderRadius: 11,
          display: "grid",
          placeItems: "center",
          background: "color-mix(in srgb, var(--gold) 16%, transparent)",
        }}
      >
        <Icon name="sparkle" size={19} color="var(--gold-deep)" />
      </span>
      <p style={{ margin: 0, fontSize: 14.5, color: "var(--ink-2)", fontWeight: 600, lineHeight: 1.45 }}>
        {text}
      </p>
    </div>
  );
}
