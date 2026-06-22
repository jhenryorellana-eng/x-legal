"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/frontend/components/brand/icon";

/**
 * BottomNav — las DOS barras de navegación de la app cliente
 * (DOC-01 §5.2, DOC-51 §0.1). Ported from the prototype
 * `V2/UI Cliente/app/ui.jsx → NavBar / CaseNav / AccountNav`.
 *
 * - variant "cuenta": Servicios · Comunidad · Mis casos · Avisos · Pagos
 *   ("Mis casos" sits in the center as a raised, featured hub button.)
 * - variant "caso":   Inicio · Citas · Documentos · Formularios · Más
 *
 * Fixed to the bottom, `--nav-bg` fill + 16px backdrop blur, top border `--line`.
 * Active tab: `--accent` icon/label inside a `--blue-soft` pill. Inactive: `--ink-3`.
 * Red badge with a 2px `--card` ring (e.g. unread alerts).
 *
 * Navigation is route-based (`<Link>`); the active tab is derived from the URL.
 */

export type BottomNavVariant = "cuenta" | "caso";

interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  href: string;
  /** Numeric badge (e.g. unread alerts). 0/undefined hides it. */
  badge?: number;
  /** Extra path prefixes that should mark this tab active. */
  match?: string[];
  /**
   * Center "hub" tab: rendered as a raised, shadowed circular puck instead of
   * the flat pill. The elevation is the "featured" cue; the accent fill stays
   * reserved for the active state, so the prominent center never reads as
   * "you are here" on its own.
   */
  featured?: boolean;
}

export interface BottomNavLabels {
  /** cuenta: servicios, casos, comunidad, avisos, pagos */
  /** caso:   inicio, citas, documentos, formularios, mas */
  [key: string]: string;
}

export interface BottomNavProps {
  variant: BottomNavVariant;
  /** Translated labels keyed by item id. */
  labels: BottomNavLabels;
  /** Unread alerts count → red badge on the "Avisos" tab (cuenta variant). */
  notifCount?: number;
  /** Case id — required for the "caso" variant to build the hrefs. */
  caseId?: string;
  /** Position absolutely inside a phone-frame instead of fixed to viewport. */
  absolute?: boolean;
  /** Force a given item id active (showcase/preview only; ignores the URL). */
  activeOverride?: string;
}

function buildAccountItems(labels: BottomNavLabels, notifCount?: number): NavItem[] {
  return [
    { id: "servicios", label: labels.servicios, icon: "grid", href: "/servicios" },
    { id: "comunidad", label: labels.comunidad, icon: "family", href: "/comunidad" },
    { id: "casos", label: labels.casos, icon: "briefcase", href: "/home", featured: true },
    { id: "avisos", label: labels.avisos, icon: "bell", href: "/avisos", badge: notifCount },
    { id: "pagos", label: labels.pagos, icon: "wallet", href: "/pagos" },
  ];
}

function buildCaseItems(labels: BottomNavLabels, caseId: string): NavItem[] {
  const base = `/caso/${caseId}`;
  return [
    {
      id: "inicio",
      label: labels.inicio,
      icon: "home",
      href: `${base}/camino`,
      match: [`${base}/disclaimer`, `${base}/proceso`],
    },
    {
      id: "citas",
      label: labels.citas,
      icon: "calendar",
      href: `${base}/agendar`,
      match: [`${base}/cita`],
    },
    {
      id: "documentos",
      label: labels.documentos,
      icon: "doc",
      href: `${base}/documentos`,
      match: [`${base}/subir`, `${base}/corregir`],
    },
    {
      id: "formularios",
      label: labels.formularios,
      icon: "form",
      href: `${base}/formularios`,
      match: [`${base}/historia`],
    },
    {
      id: "mas",
      label: labels.mas,
      icon: "grid",
      href: `${base}/mas`,
      match: [`${base}/bitacora`, `${base}/datos`, `${base}/expedientes`],
    },
  ];
}

function isActive(pathname: string, item: NavItem): boolean {
  if (pathname === item.href || pathname.startsWith(item.href + "/")) return true;
  return (item.match ?? []).some(
    (m) => pathname === m || pathname.startsWith(m + "/"),
  );
}

export function BottomNav({
  variant,
  labels,
  notifCount,
  caseId,
  absolute = false,
  activeOverride,
}: BottomNavProps) {
  const pathname = usePathname() ?? "";
  const items =
    variant === "cuenta"
      ? buildAccountItems(labels, notifCount)
      : buildCaseItems(labels, caseId ?? "");

  return (
    <nav
      aria-label={variant === "cuenta" ? labels.navAccount : labels.navCase}
      style={{
        position: absolute ? "absolute" : "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        maxWidth: absolute ? undefined : 430,
        margin: absolute ? undefined : "0 auto",
        zIndex: 30,
        // Reserve the device gesture-bar inset BELOW the tab row so the bar's
        // fill extends to the screen edge while the icons stay tappable.
        paddingBottom: "calc(22px + var(--safe-bottom))",
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
        const on = activeOverride
          ? activeOverride === item.id
          : isActive(pathname, item);
        const color = on ? "var(--accent)" : "var(--ink-3)";

        // Featured center tab ("Mis casos" — the client's home/primary hub): a
        // raised circular puck that floats above the bar with a shadow. The
        // SHAPE (raised + shadow) signals "featured hub"; the FILL (accent
        // gradient + white icon) signals the
        // active state — two independent cues, so it never gets confused with
        // the flat blue-soft pill the other tabs use when selected.
        if (item.featured) {
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={on ? "page" : undefined}
              style={{
                textDecoration: "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                padding: "4px",
                minWidth: 56,
                color,
                position: "relative",
                cursor: "pointer",
              }}
            >
              <span
                aria-hidden="true"
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
                  transition:
                    "background 0.2s var(--ease), box-shadow 0.2s var(--ease)",
                }}
              >
                <Icon
                  name={item.icon}
                  size={26}
                  color={on ? "#fff" : "var(--accent)"}
                  stroke={on ? 2.6 : 2.3}
                />
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: on ? 800 : 700,
                  fontFamily: "var(--font-title)",
                }}
              >
                {item.label}
              </span>
            </Link>
          );
        }

        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={on ? "page" : undefined}
            style={{
              textDecoration: "none",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              padding: "4px",
              minWidth: 54,
              color,
              position: "relative",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                position: "relative",
                padding: "5px 16px",
                borderRadius: 999,
                background: on ? "var(--blue-soft)" : "transparent",
                transition: "background 0.2s var(--ease)",
              }}
            >
              <Icon
                name={item.icon}
                size={25}
                color={color}
                stroke={on ? 2.6 : 2.2}
              />
              {item.badge && item.badge > 0 ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 6,
                    minWidth: 17,
                    height: 17,
                    padding: "0 4px",
                    borderRadius: 999,
                    background: "var(--red)",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 0 0 2px var(--card)",
                  }}
                >
                  {item.badge}
                </span>
              ) : null}
            </span>
            <span
              style={{
                fontSize: 11.5,
                fontWeight: on ? 800 : 700,
                fontFamily: "var(--font-title)",
              }}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
