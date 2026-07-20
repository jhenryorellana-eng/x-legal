"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/frontend/components/brand/icon";
import { Avatar } from "@/frontend/components/brand/avatar";
import { Logo } from "@/frontend/components/brand/logo";

/**
 * Sidebar — staff navigation rail (DOC-01 §5.3, DOC-53 §0.2).
 *
 * 248px fixed (`--sb-w`), `--sidebar` background. Brand header (logo + PRIME +
 * panel subtitle), groups with `nav-group-label` (10.5px/800 uppercase), nav
 * items (radius 12px; active = gradient accent→navy white text + accent shadow;
 * hover `--hover`), red numeric badges, and a footer user-chip with Avatar.
 *
 * Presentational: the filtered groups + resolved labels + badge counts arrive
 * as props (the server layout does the permission filtering — DOC-22 §5.4).
 */

export interface SidebarItem {
  label: string;
  href: string;
  icon: string;
  badge?: number;
}

export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

export interface SidebarUser {
  name: string;
  /** Resolved role/title line (e.g. "Administrador"). */
  title: string;
  avatarUrl?: string;
}

export interface SidebarProps {
  /** Panel subtitle under the brand (e.g. "Panel de administración"). */
  panelLabel: string;
  groups: SidebarGroup[];
  user: SidebarUser;
  /** Footer — logout control (rendered by the layout; needs the action). */
  footerSlot?: React.ReactNode;
  /** Drawer open state on mobile (≤860px); ignored on desktop (always visible). */
  open?: boolean;
}

/** Active when the pathname equals the href or is a sub-route of it. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({ panelLabel, groups, user, footerSlot, open }: SidebarProps) {
  const pathname = usePathname() ?? "";

  // Resolve a SINGLE active item. Two nav entries can legitimately share an href
  // (e.g. "Calendario" in Operación and "Citas" in Ventas both → /ventas/citas);
  // matching per-item would light BOTH. Pick the most specific match (longest
  // href); on an exact tie the later entry wins, so the group that "owns" the
  // URL (Ventas "Citas") lights rather than the cross-linked alias.
  let activeGi = -1;
  let activeIi = -1;
  let bestLen = -1;
  groups.forEach((group, gi) => {
    group.items.forEach((item, ii) => {
      if (isActive(pathname, item.href) && item.href.length >= bestLen) {
        bestLen = item.href.length;
        activeGi = gi;
        activeIi = ii;
      }
    });
  });

  return (
    <aside
      id="staff-sidebar"
      className="staff-sidebar"
      data-open={open ? "true" : "false"}
      style={{
        width: "var(--sb-w)",
        flexShrink: 0,
        // `/ var(--text-scale)` compensates the ancestor `.surface-staff` zoom so
        // the rail still spans exactly one viewport at every text size (no gap at
        // sm, no overflow at lg). See the note on `.surface-staff` in globals.css.
        height: "calc(100dvh / var(--text-scale, 1))",
        position: "sticky",
        top: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--sidebar, var(--card))",
        borderRight: "1px solid var(--line)",
      }}
    >
      {/* Brand header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "18px 18px 14px",
        }}
      >
        <Logo size={38} elevated />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 15,
              color: "var(--navy)",
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
            }}
          >
            X{" "}
            <span style={{ color: "var(--accent)" }}>LEGAL</span>
          </div>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: "0.7px",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginTop: 2,
            }}
          >
            {panelLabel}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav
        aria-label={panelLabel}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 12px 12px",
        }}
      >
        {groups.map((group, gi) => (
          <div key={group.label} style={{ marginTop: 14 }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 800,
                letterSpacing: "0.7px",
                textTransform: "uppercase",
                color: "var(--ink-3)",
                padding: "0 10px 6px",
              }}
            >
              {group.label}
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {group.items.map((item, ii) => {
                const active = gi === activeGi && ii === activeIi;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className="nav-item"
                      data-active={active ? "" : undefined}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 11,
                        padding: "9px 10px",
                        borderRadius: 12,
                        marginBottom: 2,
                        textDecoration: "none",
                        fontFamily: "var(--font-title)",
                        fontWeight: active ? 800 : 700,
                        fontSize: 14,
                        color: active ? "#fff" : "var(--ink-2)",
                        background: active
                          ? "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--brand-navy) 70%, var(--accent)))"
                          : "transparent",
                        boxShadow: active
                          ? "0 8px 20px color-mix(in srgb, var(--accent) 32%, transparent)"
                          : "none",
                        transition:
                          "background-color 0.16s var(--ease), color 0.16s var(--ease)",
                      }}
                    >
                      <Icon
                        name={item.icon as never}
                        size={20}
                        color={active ? "#fff" : "var(--ink-3)"}
                        stroke={2.2}
                      />
                      <span
                        style={{
                          flex: 1,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {item.label}
                      </span>
                      {item.badge != null && item.badge > 0 && (
                        <span
                          aria-label={`${item.badge} pendientes`}
                          style={{
                            display: "inline-grid",
                            placeItems: "center",
                            minWidth: 20,
                            height: 20,
                            padding: "0 6px",
                            borderRadius: 999,
                            background: "var(--red)",
                            color: "#fff",
                            fontSize: 11,
                            fontWeight: 800,
                            lineHeight: 1,
                          }}
                        >
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer user-chip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "12px 14px",
          borderTop: "1px solid var(--line)",
        }}
      >
        <Avatar
          name={user.name}
          variant="staff"
          size={38}
          src={user.avatarUrl}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 13,
              color: "var(--ink)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {user.name}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--ink-3)",
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {user.title}
          </div>
        </div>
        {footerSlot}
      </div>
    </aside>
  );
}
