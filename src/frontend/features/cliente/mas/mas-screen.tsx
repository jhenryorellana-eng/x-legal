import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/frontend/components/brand/icon";
import { IconTile } from "@/frontend/components/brand/icon-tile";

/**
 * MasScreen — `/caso/[caseId]/mas` (DOC-51 §26, prototype `screens4.jsx →
 * MoreScreen`). Hub grid of case accesses, grouped. Items that arrive in later
 * phases render with a "Pronto" badge (no link). Server-safe.
 */

export interface MasItem {
  icon: IconName;
  color: string;
  title: string;
  description: string;
  /** Internal href; when null + soon=true the item is a disabled "Pronto" row. */
  href: string | null;
  badge?: number;
  soon?: boolean;
}

export interface MasGroup {
  label: string;
  items: MasItem[];
}

export function MasScreen({
  header,
  subtitle,
  back,
  soonLabel,
  groups,
}: {
  header: string;
  subtitle: string;
  back: string;
  soonLabel: string;
  groups: MasGroup[];
}) {
  const Row = ({ it }: { it: MasItem }) => {
    const inner = (
      <>
        <IconTile name={it.icon} color={it.color} size={48} radius={14} iconSize={25} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="t-title"
            style={{ fontSize: 17, color: "var(--navy)", fontWeight: 700 }}
          >
            {it.title}
          </div>
          <div
            style={{
              fontSize: 13.5,
              color: "var(--ink-2)",
              fontWeight: 500,
              lineHeight: 1.4,
            }}
          >
            {it.description}
          </div>
        </div>
        {it.soon ? (
          <span
            style={{
              background: "var(--gold-soft)",
              color: "var(--gold-deep)",
              borderRadius: 999,
              padding: "4px 10px",
              fontSize: 11.5,
              fontWeight: 800,
            }}
          >
            {soonLabel}
          </span>
        ) : (
          <>
            {it.badge != null && it.badge > 0 && (
              <span
                style={{
                  minWidth: 24,
                  height: 24,
                  borderRadius: 999,
                  background: "var(--red)",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 7px",
                }}
              >
                {it.badge}
              </span>
            )}
            <Icon name="chevR" size={20} color="var(--ink-3)" />
          </>
        )}
      </>
    );

    const baseStyle: React.CSSProperties = {
      display: "flex",
      alignItems: "center",
      gap: 15,
      background: "var(--card)",
      borderRadius: 20,
      padding: 16,
      boxShadow: "var(--shadow-soft)",
      textAlign: "left",
      width: "100%",
      textDecoration: "none",
      opacity: it.soon ? 0.7 : 1,
    };

    if (it.href && !it.soon) {
      return (
        <Link href={it.href} className="mp-lift" style={{ ...baseStyle, cursor: "pointer" }}>
          {inner}
        </Link>
      );
    }
    return (
      <div aria-disabled style={{ ...baseStyle, cursor: "default" }}>
        {inner}
      </div>
    );
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "54px 20px 116px",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      <Link
        href="/home"
        className="mp-tap"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--accent)",
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 15,
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        <Icon name="chevL" size={18} color="var(--accent)" /> {back}
      </Link>
      <h1
        className="t-black"
        style={{ margin: "0 0 4px", fontSize: 27, color: "var(--navy)" }}
      >
        {header}
      </h1>
      <p style={{ margin: "0 0 20px", fontSize: 15.5, color: "var(--ink-2)", fontWeight: 600 }}>
        {subtitle}
      </p>

      {groups.map((g, gi) => (
        <div key={gi} style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 800,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: 10,
              paddingLeft: 4,
            }}
          >
            {g.label}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {g.items.map((it, i) => (
              <Row key={gi + "-" + i} it={it} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
