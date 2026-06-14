"use client";

/**
 * Métricas — sales performance (DOC-52 §6, RF-VAN-006..009).
 *
 * Funnel + weekly bars + donuts + sources, all via SVG/CSS (no recharts — the
 * prototype uses raw SVG donuts and CSS bars). Period segmented control drives
 * searchParams (RSC recompute). Every number is a prop computed server-side
 * with the §6.2 formulas; donuts animate stroke-dasharray on mount (RF-VAN-008).
 */

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { MSym } from "../shared/msym";
import { Chip } from "../shared/ui";
import { LexBubble } from "../shared/lex";
import { useLexPrefs } from "../shared/lex-prefs";

export interface MetricKpi {
  label: string;
  value: string;
  trend: number | null;
  hint: string;
}
export interface FunnelStage {
  label: string;
  count: number;
  pct: number;
  drop: string | null;
}
export interface WeekBar {
  label: string;
  value: number;
  isToday: boolean;
}
export interface DonutVM {
  pct: number;
  color: string;
  label: string;
  sub: string;
}
export interface SourceRow {
  label: string;
  count: number;
  pct: number;
  conv: string;
  gradient: string;
}
export interface SecondaryCard {
  icon: string;
  label: string;
  value: string;
  sub: string;
  tone: "amber" | "green" | "blue";
}

export interface MetricasStrings {
  title: string;
  sub: string;
  thisWeek: string;
  month: string;
  custom: string;
  lexTipHtml: string;
  funnelTitle: string;
  activityTitle: string;
  clientsTitle: string;
  sourcesTitle: string;
  lexEnabled: boolean;
}

export interface MetricasViewProps {
  kpis: MetricKpi[];
  funnel: FunnelStage[];
  weekBars: WeekBar[];
  donuts: DonutVM[];
  sources: SourceRow[];
  secondary: SecondaryCard[];
  period: "week" | "month" | "custom";
  strings: MetricasStrings;
  /**
   * Optional override. Omitted by the server page (a Server Component can't pass
   * a function across the RSC boundary); when absent we push `?period=…` so the
   * server recomputes the §6.2 aggregates for the chosen window.
   */
  onPeriodChange?: (p: "week" | "month" | "custom") => void;
}

function Donut({ pct, color, label, sub }: DonutVM) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const [dash, setDash] = React.useState(0);
  React.useEffect(() => {
    const t = setTimeout(() => setDash((c * pct) / 100), 120);
    return () => clearTimeout(t);
  }, [pct, c]);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div className="donut">
        <svg width="120" height="120" style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--line)" strokeWidth="13" />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="13"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
            style={{ transition: "stroke-dasharray .9s cubic-bezier(.4,.8,.3,1)" }}
          />
        </svg>
        <div className="donut-c">
          {pct}%<small>{sub}</small>
        </div>
      </div>
      <div style={{ fontWeight: 800, fontSize: 13.5, color: "var(--ink)" }}>{label}</div>
    </div>
  );
}

export function MetricasView({
  kpis,
  funnel,
  weekBars,
  donuts,
  sources,
  secondary,
  period,
  strings,
  onPeriodChange,
}: MetricasViewProps) {
  const { bubbles } = useLexPrefs();
  const router = useRouter();
  const pathname = usePathname();
  // Client-side default: a Server Component can't hand us an event handler, so
  // when none is provided we drive the period through the URL (RSC recompute).
  const changePeriod =
    onPeriodChange ?? ((p: "week" | "month" | "custom") => router.push(`${pathname}?period=${p}`));
  const maxBar = Math.max(1, ...weekBars.map((b) => b.value));
  const periods: { id: "week" | "month" | "custom"; label: string }[] = [
    { id: "week", label: strings.thisWeek },
    { id: "month", label: strings.month },
    { id: "custom", label: strings.custom },
  ];

  return (
    <div className="fade-up">
      <div className="v-head">
        <div>
          <h1 className="v-title">{strings.title}</h1>
          <div className="v-sub">{strings.sub}</div>
        </div>
        <div className="seg">
          {periods.map((p) => (
            <button key={p.id} type="button" className={period === p.id ? "on" : ""} onClick={() => changePeriod(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <LexBubble dismissKey="met-tip" orb={30} enabled={strings.lexEnabled && bubbles} html={strings.lexTipHtml} />

      <div className="kpi-row stagger" style={{ marginBottom: 18 }}>
        {kpis.map((k, i) => (
          <div key={i} className="kpi">
            <div className="kpi-val">{k.value}</div>
            <div className="kpi-lbl">{k.label}</div>
            {k.trend !== null && (
              <div className={`kpi-trend ${k.trend >= 0 ? "up" : "down"}`}>
                <MSym name={k.trend >= 0 ? "trending_up" : "trending_down"} size={15} />
                {k.trend >= 0 ? "+" : ""}
                {k.trend} · {k.hint}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid2" style={{ marginBottom: 18 }}>
        <div className="vcard vcard-pad">
          <div className="vcard-title" style={{ marginBottom: 16 }}>
            <MSym name="filter_alt" size={20} />
            {strings.funnelTitle}
          </div>
          <div className="funnel">
            {funnel.map((f, i) => (
              <div className="fn-row" key={i}>
                <div className="fn-bar" style={{ width: `${Math.max(f.pct, 16)}%` }}>{f.count}</div>
                <div className="fn-meta">
                  <b>{f.label}</b> · {f.pct}%
                </div>
                {f.drop && <span className="fn-drop">▼ {f.drop}</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="vcard vcard-pad">
          <div className="vcard-title" style={{ marginBottom: 8 }}>
            <MSym name="bar_chart" size={20} />
            {strings.activityTitle}
          </div>
          <div className="bars">
            {weekBars.map((b, i) => (
              <div className="bar-col" key={i}>
                <div className="bar-val">{b.value}</div>
                <div className={`bar${b.isToday ? " gold" : ""}`} style={{ height: `${(b.value / maxBar) * 100}%` }} />
                <div className="bar-lbl">{b.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid2" style={{ marginBottom: 18 }}>
        <div className="vcard vcard-pad">
          <div className="vcard-title" style={{ marginBottom: 18 }}>
            <MSym name="donut_large" size={20} />
            {strings.clientsTitle}
          </div>
          <div style={{ display: "flex", justifyContent: "space-around", gap: 16, flexWrap: "wrap" }}>
            {donuts.map((d, i) => (
              <Donut key={i} {...d} />
            ))}
          </div>
        </div>

        <div className="vcard vcard-pad">
          <div className="vcard-title" style={{ marginBottom: 14 }}>
            <MSym name="hub" size={20} />
            {strings.sourcesTitle}
          </div>
          {sources.map((s, i) => (
            <div className="src-row" key={i}>
              <span style={{ fontWeight: 800, fontSize: 13, width: 110, color: "var(--ink)" }}>{s.label}</span>
              <div className="src-bar-track">
                <div className="src-bar-fill" style={{ width: `${s.pct}%`, background: s.gradient }} />
              </div>
              <span style={{ fontWeight: 900, fontSize: 13, width: 28, textAlign: "right", color: "var(--ink)" }}>{s.count}</span>
              <Chip tone="green" style={{ height: 22, fontSize: 11 }}>{s.conv}</Chip>
            </div>
          ))}
        </div>
      </div>

      <div className="grid3">
        {secondary.map((s, i) => {
          const tone = s.tone === "amber" ? "#F59E0B" : s.tone === "green" ? "var(--brand-green)" : "var(--accent)";
          return (
            <div className="vcard vcard-pad" key={i} style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div className="kpi-ico" style={{ margin: 0, background: `color-mix(in srgb, ${tone} 16%, transparent)`, color: tone }}>
                <MSym name={s.icon} size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-.5px", color: "var(--ink)" }}>{s.value}</div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-2)" }}>{s.label}</div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-3)" }}>{s.sub}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
