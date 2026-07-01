"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/frontend/components/brand";

/**
 * DemoBottomNav — a faithful replica of the client BottomNav (DOC-51 §0.1) that
 * drives the demo state machine via onClick instead of routing. Mirrors the two
 * variants ("cuenta" with the featured center hub, "caso") and the active-pill /
 * blue-soft styling. Tabs not relevant to the walkthrough render inert.
 */
type Variant = "cuenta" | "caso";

/** Item ids double as `cliente.nav` message keys, so they must be literals. */
type NavKey =
  | "servicios"
  | "comunidad"
  | "casos"
  | "avisos"
  | "pagos"
  | "inicio"
  | "citas"
  | "documentos"
  | "formularios"
  | "mas";

interface Item {
  id: NavKey;
  icon: IconName;
  featured?: boolean;
}

const ACCOUNT: Item[] = [
  { id: "servicios", icon: "grid" },
  { id: "comunidad", icon: "family" },
  { id: "casos", icon: "briefcase", featured: true },
  { id: "avisos", icon: "bell" },
  { id: "pagos", icon: "wallet" },
];

const CASE: Item[] = [
  { id: "inicio", icon: "home" },
  { id: "citas", icon: "calendar" },
  { id: "documentos", icon: "doc" },
  { id: "formularios", icon: "form" },
  { id: "mas", icon: "grid" },
];

export interface DemoBottomNavProps {
  variant: Variant;
  active: string;
  enabled: string[];
  onNavigate: (id: string) => void;
}

export function DemoBottomNav({ variant, active, enabled, onNavigate }: DemoBottomNavProps) {
  const t = useTranslations("cliente.nav");
  const items = variant === "cuenta" ? ACCOUNT : CASE;

  return (
    <nav
      aria-label={variant === "cuenta" ? t("ariaAccount") : t("ariaCase")}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        paddingBottom: "calc(18px + var(--safe-bottom))",
        paddingTop: 9,
        background: "var(--nav-bg)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderTop: "1px solid var(--line)",
        boxShadow: "0 -8px 24px rgba(11,27,51,0.07)",
        display: "flex",
        justifyContent: "space-around",
        alignItems: "flex-end",
      }}
    >
      {items.map((item) => {
        const on = active === item.id;
        const isEnabled = enabled.includes(item.id);
        const color = on ? "var(--accent)" : "var(--ink-3)";
        const handle = isEnabled ? () => onNavigate(item.id) : undefined;

        if (item.featured) {
          return (
            <button
              key={item.id}
              type="button"
              onClick={handle}
              aria-current={on ? "page" : undefined}
              style={{
                border: "none",
                background: "none",
                textDecoration: "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                padding: 4,
                minWidth: 56,
                color,
                cursor: isEnabled ? "pointer" : "default",
                opacity: isEnabled ? 1 : 0.5,
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 54,
                  height: 54,
                  marginTop: -20,
                  borderRadius: 999,
                  background: on
                    ? "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--brand-navy) 70%, var(--accent)))"
                    : "var(--card)",
                  border: on ? "none" : "1.5px solid var(--line)",
                  boxShadow: on
                    ? "0 10px 24px color-mix(in srgb, var(--accent) 42%, transparent)"
                    : "0 8px 20px rgba(11,27,51,0.20)",
                  transition: "background 0.2s var(--ease), box-shadow 0.2s var(--ease)",
                }}
              >
                <Icon name={item.icon} size={26} color={on ? "#fff" : "var(--accent)"} stroke={on ? 2.6 : 2.3} />
              </span>
              <span style={{ fontSize: 11.5, fontWeight: on ? 800 : 700, fontFamily: "var(--font-title)" }}>
                {t(item.id)}
              </span>
            </button>
          );
        }

        return (
          <button
            key={item.id}
            type="button"
            onClick={handle}
            aria-current={on ? "page" : undefined}
            style={{
              border: "none",
              background: "none",
              textDecoration: "none",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              padding: 4,
              minWidth: 54,
              color,
              cursor: isEnabled ? "pointer" : "default",
              opacity: isEnabled ? 1 : 0.5,
            }}
          >
            <span
              style={{
                padding: "5px 16px",
                borderRadius: 999,
                background: on ? "var(--blue-soft)" : "transparent",
                transition: "background 0.2s var(--ease)",
              }}
            >
              <Icon name={item.icon} size={25} color={color} stroke={on ? 2.6 : 2.2} />
            </span>
            <span style={{ fontSize: 11.5, fontWeight: on ? 800 : 700, fontFamily: "var(--font-title)" }}>
              {t(item.id)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
