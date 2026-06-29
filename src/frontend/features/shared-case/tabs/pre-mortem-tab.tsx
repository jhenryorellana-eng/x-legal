"use client";

/**
 * Pre-Mortem tab (Etapa D) — AI risk analysis of the case. Runs the critic
 * (actions.runPreMortem) over the generated memo + similar precedents and shows
 * the predicted asylum denial reasons with probability + concrete corrections,
 * so staff can shore up weaknesses BEFORE filing. Persists history.
 *
 * Visible only when the case's service has an ai_letter with pre_mortem_enabled
 * (gated upstream via vm.preMortem.enabled → buildTabs).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import { toast } from "@/frontend/components/desktop/toast";
import { SectionLabel } from "../ui";
import type { CaseWorkspaceVM, CaseDetailActions, PreMortemAssessmentVM, PreMortemReasonVM } from "../types";
import type { CasosStrings } from "../strings";

const RISK_COLOR: Record<string, { bg: string; fg: string }> = {
  low: { bg: "var(--green-soft, #e7f6ec)", fg: "var(--green-deep, #1a7f43)" },
  medium: { bg: "var(--gold-soft, #fdf3da)", fg: "var(--gold-deep, #9a6b00)" },
  high: { bg: "var(--red-soft, #fde8e8)", fg: "var(--brand-red, #c0392b)" },
};

function riskLabel(risk: string | null, t: CasosStrings["detail"]["preMortem"]): string {
  if (risk === "low") return t.riskLow;
  if (risk === "medium") return t.riskMedium;
  if (risk === "high") return t.riskHigh;
  return "—";
}

function fmtDate(iso: string): string {
  // Stable, locale-agnostic short date (avoids hydration drift).
  return iso.slice(0, 10);
}

export function PreMortemTab({
  vm,
  actions,
  strings,
}: {
  vm: CaseWorkspaceVM;
  actions: CaseDetailActions;
  strings: CasosStrings;
}) {
  const t = strings.detail.preMortem;
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const assessments = vm.preMortem?.assessments ?? [];
  const latest: PreMortemAssessmentVM | undefined = assessments[0];

  async function onAnalyze() {
    if (!actions.runPreMortem) return;
    setBusy(true);
    try {
      const res = await actions.runPreMortem({ caseId: vm.header.caseId });
      if (res.ok) {
        toast.success(t.done);
        router.refresh();
      } else toast.error(t.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SectionLabel icon="shield">{t.title}</SectionLabel>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{t.sub}</p>
        </div>
        {typeof actions.runPreMortem === "function" && (
          <GradientBtn size="md" full={false} icon="shield" disabled={busy} onClick={onAnalyze}>
            {busy ? t.analyzing : t.analyze}
          </GradientBtn>
        )}
      </div>

      {!latest ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState title={t.empty} mood="calma" lexSize={104} />
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          <AssessmentView a={latest} t={t} />

          {assessments.length > 1 && (
            <div style={{ marginTop: 22 }}>
              <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                {t.historyTitle}
              </p>
              {assessments.slice(1).map((a) => {
                const c = RISK_COLOR[a.overallRisk ?? ""] ?? RISK_COLOR.medium;
                return (
                  <div key={a.id} className="formcard">
                    <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>{fmtDate(a.createdAt)}</span>
                    <div style={{ flex: 1 }} />
                    <span style={{ borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 800, background: c.bg, color: c.fg }}>
                      {t.overallRisk}: {riskLabel(a.overallRisk, t)}
                    </span>
                    <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>
                      {a.reasons.length} · {riskLabel(a.overallRisk, t)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function AssessmentView({ a, t }: { a: PreMortemAssessmentVM; t: CasosStrings["detail"]["preMortem"] }) {
  const c = RISK_COLOR[a.overallRisk ?? ""] ?? RISK_COLOR.medium;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ borderRadius: 999, padding: "6px 14px", fontSize: 13, fontWeight: 800, background: c.bg, color: c.fg }}>
          {t.overallRisk}: {riskLabel(a.overallRisk, t)}
        </span>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>{fmtDate(a.createdAt)}</span>
      </div>

      {a.summary && (
        <p style={{ margin: "12px 0 0", fontSize: 14, color: "var(--ink)", lineHeight: 1.55 }}>{a.summary}</p>
      )}

      <p style={{ margin: "18px 0 8px", fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ink-3)" }}>
        {t.reasonsTitle}
      </p>

      {a.reasons.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)" }}>{t.noReasons}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {a.reasons.map((r, i) => (
            <ReasonCard key={`${r.code}-${i}`} r={r} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReasonCard({ r, t }: { r: PreMortemReasonVM; t: CasosStrings["detail"]["preMortem"] }) {
  const pct = Math.round((Number.isFinite(r.probability) ? r.probability : 0) * 100);
  const tone = pct >= 66 ? "var(--brand-red, #c0392b)" : pct >= 33 ? "var(--gold-deep, #9a6b00)" : "var(--green-deep, #1a7f43)";
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px", background: "var(--card, #fff)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Chip tone="blue">{r.label}</Chip>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: tone }}>
          {t.probability}: {pct}%
        </span>
      </div>
      <div style={{ marginTop: 8, height: 6, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: tone }} />
      </div>
      {r.rationale && (
        <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--ink)", lineHeight: 1.5 }}>
          <strong style={{ color: "var(--ink-2)" }}>{t.rationale}: </strong>
          {r.rationale}
        </p>
      )}
      {r.correction && (
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--ink)", lineHeight: 1.5 }}>
          <strong style={{ color: "var(--accent)" }}>{t.correction}: </strong>
          {r.correction}
        </p>
      )}
    </div>
  );
}
