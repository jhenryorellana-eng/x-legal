"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/frontend/components/brand/icon";
import { IconTile } from "@/frontend/components/brand/icon-tile";
import { Lex } from "@/frontend/components/brand/lex";

/**
 * ServicesScreen — `/servicios` (DOC-51 §6, prototype `screens6.jsx → ServicesScreen`).
 *
 * Client component: live local search over the catalog (resolved server-side and
 * passed as props). Tapping a card navigates to `/servicios/[slug]`.
 */

export interface ServiceCard {
  slug: string;
  name: string; // resolved for the active locale
  description: string;
  icon: IconName;
  color: string;
  owned: boolean;
}

export interface ServicesLabels {
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  owned: string;
  emptyTitle: string;
}

export function ServicesScreen({
  services,
  labels,
}: {
  services: ServiceCard[];
  labels: ServicesLabels;
}) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const list = services.filter((s) =>
    s.name.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "26px 20px 120px",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      <h1
        className="t-black"
        style={{ margin: "0 0 6px", fontSize: 28, color: "var(--navy)" }}
      >
        {labels.title}
      </h1>
      <p
        style={{
          margin: "0 0 18px",
          fontSize: 16,
          color: "var(--ink-2)",
          fontWeight: 500,
        }}
      >
        {labels.subtitle}
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--card)",
          borderRadius: 16,
          padding: "0 16px",
          height: 54,
          boxShadow: "var(--shadow-soft)",
          marginBottom: 18,
        }}
      >
        <Icon name="search" size={21} color="var(--ink-3)" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchPlaceholder}
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "none",
            fontFamily: "var(--font-body)",
            fontWeight: 600,
            fontSize: 16,
            color: "var(--navy)",
          }}
        />
      </div>

      {list.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            padding: "40px 20px",
            textAlign: "center",
          }}
        >
          <Lex size={92} mood="atento" />
          <p
            style={{
              fontSize: 16,
              color: "var(--ink-2)",
              fontWeight: 600,
              maxWidth: 260,
            }}
          >
            {labels.emptyTitle}
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {list.map((s) => (
            <button
              key={s.slug}
              type="button"
              onClick={() => router.push(`/servicios/${s.slug}`)}
              className="mp-lift"
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 11,
                background: "var(--card)",
                border: "none",
                borderRadius: 20,
                padding: 16,
                cursor: "pointer",
                textAlign: "left",
                boxShadow: "var(--shadow-soft)",
                overflow: "hidden",
              }}
            >
              {s.owned && (
                <span
                  style={{
                    position: "absolute",
                    top: 12,
                    right: 12,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    background: "var(--green-soft)",
                    color: "var(--green)",
                    borderRadius: 999,
                    padding: "4px 9px",
                    fontSize: 11.5,
                    fontWeight: 800,
                  }}
                >
                  <Icon name="check" size={13} color="var(--green)" stroke={3} />
                  {labels.owned}
                </span>
              )}
              <IconTile name={s.icon} color={s.color} size={46} radius={13} iconSize={24} />
              <div>
                <div
                  className="t-title"
                  style={{
                    fontSize: 16,
                    color: "var(--navy)",
                    fontWeight: 700,
                    lineHeight: 1.2,
                    textWrap: "balance",
                  }}
                >
                  {s.name}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                    fontWeight: 500,
                    marginTop: 4,
                    lineHeight: 1.4,
                  }}
                >
                  {s.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
