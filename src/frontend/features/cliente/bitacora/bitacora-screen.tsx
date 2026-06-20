"use client";

import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/frontend/components/brand/icon";

/**
 * BitacoraScreen — `/caso/[caseId]/bitacora` (DOC-51 §23, prototype `screens8.jsx
 * → HistorialScreen`). Filter chips + day-grouped timeline with actor chips.
 *
 * Client component (filter chips are interactive). Events are resolved + grouped
 * server-side in the user's timezone; the client just filters by category.
 */

export type BitacoraCategory = "todo" | "doc" | "cita" | "form" | "pago" | "msg";

export interface BitacoraEvent {
  id: string;
  category: Exclude<BitacoraCategory, "todo">;
  icon: IconName;
  color: string;
  text: string;
  time: string; // formatted in user TZ
  team: boolean; // true = "Tu equipo", false = "Tú"
}

export interface BitacoraDay {
  label: string; // "Hoy" / "Ayer" / "3 de junio"
  events: BitacoraEvent[];
}

export interface BitacoraLabels {
  back: string;
  title: string;
  subtitle: string;
  filterAll: string;
  filterDocs: string;
  filterMeetings: string;
  filterForms: string;
  filterPayments: string;
  filterMessages: string;
  you: string;
  team: string;
  emptyFilter: string;
}

export function BitacoraScreen({
  caseId,
  days,
  labels,
}: {
  caseId: string;
  days: BitacoraDay[];
  labels: BitacoraLabels;
}) {
  const [filter, setFilter] = React.useState<BitacoraCategory>("todo");

  const filters: { id: BitacoraCategory; label: string }[] = [
    { id: "todo", label: labels.filterAll },
    { id: "doc", label: labels.filterDocs },
    { id: "cita", label: labels.filterMeetings },
    { id: "form", label: labels.filterForms },
    { id: "pago", label: labels.filterPayments },
    { id: "msg", label: labels.filterMessages },
  ];

  const filtered = days
    .map((g) => ({
      ...g,
      events: g.events.filter((e) => filter === "todo" || e.category === filter),
    }))
    .filter((g) => g.events.length > 0);

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "54px 20px var(--screen-pb)",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      <Link
        href={`/caso/${caseId}/mas`}
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
        <Icon name="chevL" size={18} color="var(--accent)" /> {labels.back}
      </Link>
      <h1
        className="t-black"
        style={{ margin: "0 0 4px", fontSize: 27, color: "var(--navy)", textWrap: "balance" }}
      >
        {labels.title}
      </h1>
      <p style={{ margin: "0 0 18px", fontSize: 15.5, color: "var(--ink-2)", fontWeight: 600 }}>
        {labels.subtitle}
      </p>

      {/* Filter chips */}
      <div
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          margin: "0 -20px 18px",
          padding: "0 20px 4px",
        }}
      >
        {filters.map((x) => {
          const on = filter === x.id;
          return (
            <button
              key={x.id}
              type="button"
              onClick={() => setFilter(x.id)}
              className="mp-tap"
              style={{
                flexShrink: 0,
                height: 38,
                padding: "0 16px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--font-title)",
                fontWeight: 800,
                fontSize: 14,
                background: on ? "var(--accent)" : "var(--card)",
                color: on ? "#fff" : "var(--ink-2)",
                boxShadow: on
                  ? "0 6px 14px color-mix(in srgb, var(--accent) 27%, transparent)"
                  : "var(--shadow-soft)",
              }}
            >
              {x.label}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div
          style={{
            textAlign: "center",
            color: "var(--ink-3)",
            fontWeight: 600,
            fontSize: 15,
            padding: "30px 0",
          }}
        >
          {labels.emptyFilter}
        </div>
      )}

      {filtered.map((g, gi) => (
        <div key={gi} style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 800,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              margin: "6px 0 12px",
              paddingLeft: 4,
            }}
          >
            {g.label}
          </div>
          <div style={{ position: "relative", paddingLeft: 8 }}>
            {g.events.map((it, i) => (
              <div
                key={it.id}
                style={{ position: "relative", display: "flex", gap: 14, paddingBottom: 16 }}
              >
                {i < g.events.length - 1 && (
                  <span
                    style={{
                      position: "absolute",
                      left: 22,
                      top: 44,
                      bottom: 0,
                      width: 2,
                      background: "var(--line)",
                    }}
                  />
                )}
                <div
                  style={{
                    position: "relative",
                    zIndex: 1,
                    width: 44,
                    height: 44,
                    borderRadius: 999,
                    flexShrink: 0,
                    background: `radial-gradient(circle at 36% 30%, color-mix(in srgb, ${it.color} 18%, transparent), color-mix(in srgb, ${it.color} 7%, transparent) 70%)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${it.color} 19%, transparent)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name={it.icon} size={22} color={it.color} stroke={2.4} />
                </div>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: "var(--card)",
                    borderRadius: 16,
                    padding: "12px 14px",
                    boxShadow: "var(--shadow-soft)",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 14.5,
                      lineHeight: 1.45,
                      color: "var(--ink)",
                      fontWeight: 600,
                    }}
                  >
                    {it.text}
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6 }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12.5,
                        color: "var(--ink-3)",
                        fontWeight: 700,
                      }}
                    >
                      <Icon name="clock" size={13} color="var(--ink-3)" />
                      {it.time}
                    </span>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 800,
                        color: it.team ? "var(--accent)" : "var(--green)",
                        background: it.team ? "var(--blue-soft)" : "var(--green-soft)",
                        borderRadius: 999,
                        padding: "2px 8px",
                      }}
                    >
                      {it.team ? labels.team : labels.you}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
