"use client";

import * as React from "react";
import { Kpi } from "@/frontend/components/desktop";
import { Card, Icon } from "@/frontend/components/brand";
import { ViewHead } from "../shared/chrome";

/**
 * AiCostsView — /admin/ai-costs (RF-ADM-005).
 *
 * AI spend dashboard: total + budget bar (80/100% alerts), spend by source
 * (Claude generations vs Gemini extractions vs translations) and by month.
 *
 * The current getCostsSummary aggregate returns { totalUsd, bySource, byMonth }.
 * The ranking ("5 most expensive generations"), failure rate, token totals, and
 * the is_test split (RF-ADM-037) need a richer aggregate — flagged for backend
 * (see <<NEED-BACKEND>> + the scaffolded sections below).
 */

const SOURCE_META: Record<string, { label: string; tone: string; engine: string }> = {
  generations: { label: "Generaciones", tone: "var(--accent)", engine: "Claude" },
  extractions: { label: "Extracciones", tone: "var(--green)", engine: "Gemini" },
  translations: { label: "Traducciones", tone: "var(--gold-deep)", engine: "Gemini" },
};

export interface AiCostsVM {
  totalUsd: number;
  bySource: Record<string, number>;
  byMonth: Record<string, number>;
  budgetUsd: number;
  from: string;
  to: string;
}

export function AiCostsView({ vm }: { vm: AiCostsVM }) {
  const pct = vm.budgetUsd > 0 ? Math.round((vm.totalUsd / vm.budgetUsd) * 100) : 0;
  const overBudget = pct >= 100;
  const nearBudget = pct >= 80 && pct < 100;
  const months = Object.entries(vm.byMonth).sort(([a], [b]) => a.localeCompare(b));
  const sources = Object.entries(vm.bySource).sort(([, a], [, b]) => b - a);
  const maxMonth = Math.max(1, ...Object.values(vm.byMonth));

  return (
    <div style={{ padding: 28 }}>
      <ViewHead title="Costes IA" sub="Gasto de generaciones (Claude) y extracciones (Gemini) vs presupuesto." />

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 18 }}>
        <Kpi icon="dollar" label="Gasto del mes" value={`$${vm.totalUsd.toFixed(2)}`} hot={overBudget} />
        <Kpi icon="wallet" label="Presupuesto" value={`$${vm.budgetUsd.toFixed(0)}`} />
        <Kpi icon="bolt" label="Uso del presupuesto" value={`${pct}%`} />
      </div>

      {/* Budget bar */}
      <Card>
        <div style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)" }}>
              ${vm.totalUsd.toFixed(2)} de ${vm.budgetUsd.toFixed(0)} usados
            </span>
            {nearBudget && <span style={{ fontSize: 12, color: "var(--gold-deep)", fontWeight: 700 }}><Icon name="info" size={13} /> Vas al {pct}% del presupuesto</span>}
            {overBudget && <span style={{ fontSize: 12, color: "var(--red)", fontWeight: 700 }}><Icon name="info" size={13} /> Presupuesto superado</span>}
          </div>
          <div style={{ height: 12, borderRadius: 999, background: overBudget ? "var(--red-soft)" : nearBudget ? "var(--gold-soft)" : "var(--line)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, borderRadius: 999, background: "linear-gradient(90deg, var(--gold), var(--gold-deep))" }} />
          </div>
        </div>
      </Card>

      {/* By source + by month */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <Card>
          <div style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", margin: "0 0 14px" }}>Por fuente</h3>
            {sources.length === 0 && <p style={{ color: "var(--ink-3)", fontSize: 13 }}>Sin gasto en este período.</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {sources.map(([src, cost]) => {
                const m = SOURCE_META[src] ?? { label: src, tone: "var(--ink-2)", engine: "" };
                const sharePct = vm.totalUsd > 0 ? Math.round((cost / vm.totalUsd) * 100) : 0;
                return (
                  <div key={src}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                      <span style={{ color: "var(--ink-2)" }}>{m.label} <span style={{ color: "var(--ink-3)" }}>· {m.engine}</span></span>
                      <span style={{ fontWeight: 700, color: "var(--ink)" }}>${cost.toFixed(2)}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 99, background: "var(--chip)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${sharePct}%`, borderRadius: 99, background: m.tone }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", margin: "0 0 14px" }}>Por mes</h3>
            {months.length === 0 && <p style={{ color: "var(--ink-3)", fontSize: 13 }}>Sin gasto en este período.</p>}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 140 }}>
              {months.map(([month, cost]) => (
                <div key={month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink)" }}>${cost.toFixed(0)}</span>
                  <div style={{ width: "100%", height: `${Math.round((cost / maxMonth) * 100)}%`, minHeight: 4, borderRadius: 8, background: "linear-gradient(180deg, var(--accent), var(--brand-navy))" }} />
                  <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{month}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Scaffolded sections — need a richer aggregate (flagged for backend) */}
      <Card>
        <div style={{ padding: 18, marginTop: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", margin: "0 0 6px" }}>Ranking, tasa de fallos, tokens y pruebas del editor</h3>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
            El ranking de las 5 generaciones más caras, la tasa de fallos, el total de tokens y la fila separada
            &nbsp;<b>&quot;Pruebas del editor (no cuentan en métricas)&quot;</b> (RF-ADM-037) requieren un agregado más rico
            que el actual <code>getCostsSummary</code> (hoy devuelve total · por fuente · por mes).
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--ink-3)" }}>
            TODO(F4-W2): extender el read del módulo ai-engine para incluir <code>ranking</code>, <code>failureRate</code>,
            <code>totalTokens</code> y el split <code>is_test</code>. Flag: &lt;&lt;NEED-BACKEND&gt;&gt;.
          </p>
        </div>
      </Card>
    </div>
  );
}
