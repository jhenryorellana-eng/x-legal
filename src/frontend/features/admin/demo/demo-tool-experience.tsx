import * as React from "react";
import Link from "next/link";
import { Icon, IconTile, type IconName } from "@/frontend/components/brand";
import { serviceColorToken } from "./scenarios";

/**
 * DemoToolExperience — /admin/demo/{slug} for an external embedded tool
 * (`src/shared/constants/demo-tools.ts`). Pure Server Component: the browser
 * renders the <iframe> on its own, so the page ships zero client JS. Header
 * mirrors DemoExperience; the "open in new tab" anchor doubles as fallback
 * when the embed cannot render (the tool's `frame-ancestors` only allows the
 * production origin — on localhost/previews the frame stays blank by design).
 */

export interface DemoToolExperienceProps {
  label: string;
  url: string;
  icon: IconName;
  colorKey: string;
  messages: { eyebrow: string; openExternal: string };
}

export function DemoToolExperience({
  label,
  url,
  icon,
  colorKey,
  messages,
}: DemoToolExperienceProps) {
  const color = serviceColorToken(colorKey);

  return (
    <div style={{ padding: "22px clamp(16px,3vw,32px) 32px", maxWidth: 1320, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/admin/demo"
          aria-label="Volver"
          style={{
            width: 42,
            height: 42,
            borderRadius: 999,
            background: "var(--card)",
            border: "1px solid var(--line)",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <Icon name="arrowL" size={20} color="var(--navy)" />
        </Link>
        <IconTile name={icon} color={color} size={44} radius={13} iconSize={23} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            {messages.eyebrow}
          </div>
          <div className="t-title" style={{ fontSize: 19, fontWeight: 800, color: "var(--navy)" }}>
            {label}
          </div>
        </div>

        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            height: 38,
            padding: "0 14px",
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: "var(--card)",
            color: "var(--ink-2)",
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 13.5,
            textDecoration: "none",
          }}
        >
          <Icon name="external" size={16} color="var(--ink-2)" />
          {messages.openExternal}
        </a>
      </div>

      {/* No `sandbox`: the tool is a trusted first-party embed, and a sandbox
          with allow-scripts + allow-same-origin grants no real isolation. */}
      <iframe
        src={url}
        title={label}
        style={{
          width: "100%",
          height: "calc(100dvh - 190px)",
          minHeight: 480,
          border: "1px solid var(--line)",
          borderRadius: 20,
          background: "var(--card)",
          boxShadow: "var(--shadow-soft)",
          display: "block",
        }}
      />
    </div>
  );
}
