import * as React from "react";
import Link from "next/link";
import { Icon, IconTile, type IconName } from "@/frontend/components/brand";
import { ViewHead } from "@/frontend/features/admin/shared/chrome";
import { getDemoAssetSlots } from "@/shared/constants/demo-assets";
import { serviceColorToken } from "./scenarios";
import { DemoCardMenu } from "./demo-card-menu";
import type { DemoAssetActions } from "./demo-data-modal";

/**
 * DemoIndex — grid of service cards on /admin/demo. The card itself stays
 * presentational (hover-lift is pure CSS `.mp-lift`, navigation is a `<Link>`);
 * the "⋯ → Data" menu is a small client island rendered as a SIBLING of the
 * link (not a child) so opening it never navigates.
 */

export interface DemoCardVM {
  slug: string;
  label: string;
  icon: IconName;
  /** Catalog color key (e.g. "green"); resolved to a CSS token for the tile. */
  colorKey: string;
  /** Per-card CTA override (e.g. external tools) — falls back to `messages.cardCta`. */
  cta?: string;
}

export interface DemoIndexProps {
  cards: DemoCardVM[];
  messages: { title: string; subtitle: string; cardCta: string };
  /** demo-assets server actions, injected by the page (module-pub border). */
  assetActions: DemoAssetActions;
}

export function DemoIndex({ cards, messages, assetActions }: DemoIndexProps) {
  return (
    <div
      className="anim-fade-in-up"
      style={{ padding: "28px clamp(18px,3vw,36px) 64px", maxWidth: 1320 }}
    >
      <ViewHead title={messages.title} sub={messages.subtitle} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(264px, 1fr))",
          gap: 16,
        }}
      >
        {cards.map((c) => {
          const color = serviceColorToken(c.colorKey);
          const hasAssetSlots = getDemoAssetSlots(c.slug).length > 0;
          return (
            <div key={c.slug} style={{ position: "relative", display: "flex" }}>
            <Link
              href={`/admin/demo/${c.slug}`}
              className="mp-lift"
              style={{
                position: "relative",
                overflow: "hidden",
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 16,
                background: "var(--card)",
                border: "1px solid var(--line)",
                borderRadius: 20,
                padding: 20,
                textDecoration: "none",
                boxShadow: "var(--shadow-soft)",
              }}
            >
              {/* Soft brand halo top-right */}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  right: -36,
                  top: -36,
                  width: 130,
                  height: 130,
                  borderRadius: "50%",
                  background: `radial-gradient(circle, color-mix(in srgb, ${color} 16%, transparent), transparent 70%)`,
                }}
              />
              <IconTile name={c.icon} color={color} size={56} radius={16} iconSize={28} />
              <div style={{ position: "relative" }}>
                <div
                  className="t-title"
                  style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)" }}
                >
                  {c.label}
                </div>
              </div>
              <span
                className="t-title"
                style={{
                  position: "relative",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: "auto",
                  alignSelf: "flex-start",
                  color: "var(--accent)",
                  fontSize: 14.5,
                  fontWeight: 800,
                }}
              >
                {c.cta ?? messages.cardCta}
                <Icon name="chevR" size={17} color="var(--accent)" />
              </span>
            </Link>
            {hasAssetSlots && <DemoCardMenu slug={c.slug} assetActions={assetActions} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
