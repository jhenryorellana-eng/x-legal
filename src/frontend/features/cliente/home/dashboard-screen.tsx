import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/frontend/components/brand/icon";
import { IconTile } from "@/frontend/components/brand/icon-tile";
import { StatusPill } from "@/frontend/components/brand/status-pill";
import { Logo } from "@/frontend/components/brand/logo";

/**
 * DashboardScreen — `/home` (DOC-51 §5, prototype `screens6.jsx → DashboardScreen`).
 *
 * Server component: receives already-resolved, serializable data from the page
 * (RSC reads via modules/* index.ts) and renders the multi-case dashboard.
 * The only interactive affordances are links (bell → /avisos, avatar → /config,
 * case cards → their case). No client JS needed here.
 */

export interface DashboardCase {
  caseId: string;
  /** Service + party title, e.g. "Visa Juvenil — Mateo". */
  title: string;
  /** "Fase 1 de 3 · Custodia" — already localized by the page. */
  phaseLabel: string | null;
  serviceIcon: IconName;
  serviceColor: string;
  progress: number;
  pendingDocuments: number;
  /** When false, the card renders as a compact secondary row. */
  highlighted: boolean;
  /** Status text for compact cards (e.g. "En revisión"). */
  statusText?: string;
  statusKind?: "revision" | "aprobado" | "pendiente";
}

export interface DashboardLabels {
  greetingEyebrow: string;
  greeting: string; // already interpolated with {name}
  yourCases: string;
  documentsLeft: string; // "{n} documents left" → uses {n}
  openCase: string;
  quickAccess: string;
  qServices: string;
  qServicesSub: string;
  qPayments: string;
  qPaymentsSub: string; // already interpolated or "Al día"
  qCommunity: string;
  qCommunitySub: string;
  qSettings: string;
  qSettingsSub: string;
  bellAria: string;
  avatarAria: string;
}

export interface DashboardScreenProps {
  displayName: string;
  avatarInitial: string;
  cases: DashboardCase[];
  unreadCount: number;
  labels: DashboardLabels;
}

const BRAND_NAVY = "var(--brand-navy)";

export function DashboardScreen({
  displayName,
  avatarInitial,
  cases,
  unreadCount,
  labels,
}: DashboardScreenProps) {
  const highlighted = cases.find((c) => c.highlighted);
  const others = cases.filter((c) => !c.highlighted);

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "26px 20px var(--screen-pb)",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
        <Logo size={26} withWordmark wordmarkSize={15} />
      </div>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 22,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--ink-2)", fontSize: 15, fontWeight: 600 }}>
            {labels.greetingEyebrow}
          </div>
          <h1
            className="t-black"
            style={{ margin: "2px 0 0", fontSize: 28, color: "var(--navy)" }}
          >
            {labels.greeting.replace("{name}", displayName)}
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link
            href="/avisos"
            aria-label={labels.bellAria}
            className="mp-pop"
            style={{
              position: "relative",
              width: 48,
              height: 48,
              borderRadius: 999,
              background: "var(--card)",
              boxShadow: "var(--shadow-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon name="bell" size={24} color="var(--navy)" />
            {unreadCount > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: 6,
                  right: 7,
                  minWidth: 18,
                  height: 18,
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
                {unreadCount}
              </span>
            )}
          </Link>
          <Link
            href="/config"
            aria-label={labels.avatarAria}
            className="mp-pop"
            style={{
              width: 48,
              height: 48,
              borderRadius: 999,
              background: `linear-gradient(135deg, var(--accent), ${BRAND_NAVY})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              color: "#fff",
              fontSize: 19,
              cursor: "pointer",
              boxShadow: "var(--shadow-soft)",
              textDecoration: "none",
            }}
          >
            {avatarInitial}
          </Link>
        </div>
      </div>

      {/* Tus casos */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <Icon name="briefcase" size={21} color="var(--navy)" />
        <h2
          className="t-title"
          style={{ margin: 0, fontSize: 20, color: "var(--navy)", fontWeight: 700 }}
        >
          {labels.yourCases}
        </h2>
      </div>

      {/* Highlighted case */}
      {highlighted && (
        <Link
          href={`/caso/${highlighted.caseId}`}
          className="mp-lift"
          style={{
            position: "relative",
            display: "block",
            overflow: "hidden",
            background: `linear-gradient(135deg, ${BRAND_NAVY}, #013a73)`,
            borderRadius: 24,
            padding: 20,
            marginBottom: 14,
            cursor: "pointer",
            textDecoration: "none",
            boxShadow:
              "0 18px 40px color-mix(in srgb, var(--brand-navy) 25%, transparent)",
          }}
        >
          <div
            style={{
              position: "absolute",
              right: -30,
              top: -30,
              width: 140,
              height: 140,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--gold) 20%, transparent), transparent 70%)",
            }}
          />
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 13,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                width: 50,
                height: 50,
                borderRadius: 15,
                background: "rgba(255,255,255,0.14)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon name={highlighted.serviceIcon} size={27} color="#fff" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="t-title"
                style={{ fontSize: 19, color: "#fff", fontWeight: 800 }}
              >
                {highlighted.title}
              </div>
              {highlighted.phaseLabel && (
                <div
                  style={{
                    fontSize: 13.5,
                    color: "rgba(255,255,255,0.72)",
                    fontWeight: 600,
                    marginTop: 1,
                  }}
                >
                  {highlighted.phaseLabel}
                </div>
              )}
            </div>
          </div>
          <div
            style={{
              position: "relative",
              height: 9,
              borderRadius: 999,
              background: "rgba(255,255,255,0.16)",
              overflow: "hidden",
              marginBottom: 14,
            }}
          >
            <div
              style={{
                width: `${highlighted.progress}%`,
                height: "100%",
                borderRadius: 999,
                background: "linear-gradient(90deg, var(--gold), var(--gold-deep))",
                transition: "width 0.9s cubic-bezier(.4,0,.2,1)",
              }}
            />
          </div>
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                color: "#fff",
                fontSize: 14.5,
                fontWeight: 700,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: "var(--gold)",
                  boxShadow:
                    "0 0 0 4px color-mix(in srgb, var(--gold) 20%, transparent)",
                }}
              />
              {labels.documentsLeft.replace(
                "{n}",
                String(highlighted.pendingDocuments),
              )}
            </div>
            <span
              className="t-title"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: "#fff",
                color: "var(--accent)",
                borderRadius: 999,
                padding: "9px 16px",
                fontSize: 14.5,
                fontWeight: 800,
              }}
            >
              {labels.openCase}{" "}
              <Icon name="chevR" size={17} color="var(--accent)" />
            </span>
          </div>
        </Link>
      )}

      {/* Secondary cases */}
      {others.map((c) => (
        <Link
          key={c.caseId}
          href={`/caso/${c.caseId}`}
          className="mp-lift"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 13,
            background: "var(--card)",
            borderRadius: 20,
            padding: 16,
            marginBottom: 14,
            boxShadow: "var(--shadow-soft)",
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          <IconTile
            name={c.serviceIcon}
            color={c.serviceColor}
            size={46}
            radius={13}
            iconSize={24}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="t-title"
              style={{ fontSize: 16.5, color: "var(--navy)", fontWeight: 700 }}
            >
              {c.title}
            </div>
            {c.statusText && (
              <div
                style={{
                  fontSize: 13.5,
                  color: "var(--ink-2)",
                  fontWeight: 600,
                  marginTop: 1,
                }}
              >
                {c.statusText}
              </div>
            )}
          </div>
          {c.statusKind && c.statusText && (
            <StatusPill kind={c.statusKind}>{c.statusText}</StatusPill>
          )}
        </Link>
      ))}

      {/* Accesos rápidos */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          margin: "22px 0 12px",
        }}
      >
        <Icon name="bolt" size={20} color="var(--navy)" />
        <h2
          className="t-title"
          style={{ margin: 0, fontSize: 20, color: "var(--navy)", fontWeight: 700 }}
        >
          {labels.quickAccess}
        </h2>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[
          {
            href: "/servicios",
            icon: "grid" as const,
            color: "var(--accent)",
            label: labels.qServices,
            sub: labels.qServicesSub,
          },
          {
            href: "/pagos",
            icon: "wallet" as const,
            color: "var(--gold)",
            label: labels.qPayments,
            sub: labels.qPaymentsSub,
          },
          {
            href: "/comunidad",
            icon: "family" as const,
            color: "var(--green)",
            label: labels.qCommunity,
            sub: labels.qCommunitySub,
          },
          {
            href: "/config",
            icon: "gear" as const,
            color: "var(--purple, #7C5CFF)",
            label: labels.qSettings,
            sub: labels.qSettingsSub,
          },
        ].map((q) => (
          <Link
            key={q.href}
            href={q.href}
            className="mp-lift"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 11,
              background: "var(--card)",
              borderRadius: 20,
              padding: 16,
              cursor: "pointer",
              textAlign: "left",
              boxShadow: "var(--shadow-soft)",
              textDecoration: "none",
            }}
          >
            <IconTile
              name={q.icon}
              color={q.color}
              size={44}
              radius={13}
              iconSize={23}
            />
            <div>
              <div
                className="t-title"
                style={{ fontSize: 16, color: "var(--navy)", fontWeight: 700 }}
              >
                {q.label}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                  fontWeight: 600,
                  marginTop: 1,
                }}
              >
                {q.sub}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
