"use client";

/**
 * Pre-Mortem tab — quality validation of a specific generation (ai_letter) or
 * automation (pdf_automation). Pick a document, run the validator, and read a
 * report: score 0-100 + semáforo + verdict ("¿se aprobaría?") + findings grouped
 * by severity (each with category, location, description, correction). The report
 * is produced against the admin filling guide, the case context, and web examples.
 *
 * Visible only when the case's service has a form with an enabled guide
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
import type {
  CaseWorkspaceVM,
  CaseDetailActions,
  PreMortemReportVM,
  PreMortemTargetVM,
  PreMortemFindingVM,
  PreMortemSemaforo,
  PreMortemSeverity,
} from "../types";
import type { CasosStrings } from "../strings";

type PmStrings = CasosStrings["detail"]["preMortem"];

const SEMAFORO_COLOR: Record<PreMortemSemaforo, { bg: string; fg: string }> = {
  green: { bg: "var(--green-soft, #e7f6ec)", fg: "var(--green-deep, #1a7f43)" },
  amber: { bg: "var(--gold-soft, #fdf3da)", fg: "var(--gold-deep, #9a6b00)" },
  red: { bg: "var(--red-soft, #fde8e8)", fg: "var(--brand-red, #c0392b)" },
};

const SEVERITY_COLOR: Record<PreMortemSeverity, string> = {
  critico: "var(--brand-red, #c0392b)",
  moderado: "var(--gold-deep, #9a6b00)",
  sugerencia: "var(--blue-deep, #1c6ea4)",
};

const SEVERITY_ORDER: PreMortemSeverity[] = ["critico", "moderado", "sugerencia"];

function semaforoLabel(s: PreMortemSemaforo, t: PmStrings): string {
  return s === "green" ? t.semaforoGreen : s === "amber" ? t.semaforoAmber : t.semaforoRed;
}

function severityLabel(s: PreMortemSeverity, t: PmStrings): string {
  return s === "critico" ? t.sevCritical : s === "moderado" ? t.sevModerate : t.sevSuggestion;
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

export function PreMortemTab({
  vm,
  actions,
  strings,
  selectedTargetKey,
  onSelectTarget,
}: {
  vm: CaseWorkspaceVM;
  actions: CaseDetailActions;
  strings: CasosStrings;
  selectedTargetKey: string | null;
  onSelectTarget: (key: string) => void;
}) {
  const t = strings.detail.preMortem;
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const targets = vm.preMortem?.targets ?? [];
  const reports = vm.preMortem?.reports ?? [];

  const selected: PreMortemTargetVM | undefined =
    targets.find((x) => x.key === selectedTargetKey) ?? targets[0];

  const letters = targets.filter((x) => x.kind === "ai_letter");
  const automations = targets.filter((x) => x.kind === "pdf_automation");

  const forSelected = selected ? reports.filter((r) => r.targetKey === selected.key) : [];
  const latest: PreMortemReportVM | undefined = forSelected[0];

  async function onValidate() {
    if (!actions.runPreMortem || !selected) return;
    setBusy(true);
    try {
      const res = await actions.runPreMortem({
        caseId: vm.header.caseId,
        target: { kind: selected.kind, formDefinitionId: selected.formDefinitionId, refId: selected.refId },
      });
      if (res.ok) {
        toast.success(t.done);
        router.refresh();
      } else {
        toast.error(t.error);
      }
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
      </div>

      {targets.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState title={t.selectorEmpty} mood="calma" lexSize={104} />
        </div>
      ) : (
        <>
          {/* Selector + validate */}
          <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                {t.selectorLabel}
              </span>
              <select
                aria-label={t.selectorLabel}
                value={selected?.key ?? ""}
                onChange={(e) => onSelectTarget(e.target.value)}
                style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--card, #fff)", fontSize: 14, color: "var(--ink)" }}
              >
                {letters.length > 0 && (
                  <optgroup label={t.selectorLetters}>
                    {letters.map((x) => (
                      <option key={x.key} value={x.key}>{x.label}</option>
                    ))}
                  </optgroup>
                )}
                {automations.length > 0 && (
                  <optgroup label={t.selectorAutomations}>
                    {automations.map((x) => (
                      <option key={x.key} value={x.key}>{x.label}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            {typeof actions.runPreMortem === "function" && (
              <GradientBtn size="md" full={false} icon="shield" disabled={busy || !selected} onClick={onValidate}>
                {busy ? t.validating : t.validate}
              </GradientBtn>
            )}
          </div>

          {busy && (
            <div role="progressbar" aria-busy="true" style={{ marginTop: 12, height: 6, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
              <div style={{ width: "40%", height: "100%", background: "var(--accent)", animation: "pm-indeterminate 1.2s ease-in-out infinite" }} />
            </div>
          )}

          {!latest ? (
            <div style={{ marginTop: 16 }}>
              <EmptyState title={t.empty} mood="calma" lexSize={92} />
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <ReportView r={latest} t={t} />

              {forSelected.length > 1 && (
                <div style={{ marginTop: 22 }}>
                  <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                    {t.historyTitle}
                  </p>
                  {forSelected.slice(1).map((r) => {
                    const c = SEMAFORO_COLOR[r.semaforo] ?? SEMAFORO_COLOR.amber;
                    return (
                      <div key={r.id} className="formcard">
                        <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>{fmtDate(r.createdAt)}</span>
                        <div style={{ flex: 1 }} />
                        <span style={{ borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 800, background: c.bg, color: c.fg }}>
                          {t.score}: {r.score}
                        </span>
                        <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>
                          {r.findings.length}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function ReportView({ r, t }: { r: PreMortemReportVM; t: PmStrings }) {
  const c = SEMAFORO_COLOR[r.semaforo] ?? SEMAFORO_COLOR.amber;
  return (
    <div>
      {/* Score + semáforo + verdict */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div
          aria-label={`${t.score}: ${r.score}`}
          style={{ width: 66, height: 66, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: c.bg, color: c.fg, fontSize: 22, fontWeight: 900, border: `2px solid ${c.fg}` }}
        >
          {r.score}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ borderRadius: 999, padding: "4px 12px", fontSize: 12.5, fontWeight: 800, background: c.bg, color: c.fg, alignSelf: "flex-start" }}>
            {semaforoLabel(r.semaforo, t)}
          </span>
          <Chip tone={r.approved ? "green" : "red"}>{r.approved ? t.verdictApproved : t.verdictRejected}</Chip>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>{fmtDate(r.createdAt)}</span>
      </div>

      {r.summary && (
        <p style={{ margin: "14px 0 0", fontSize: 14, color: "var(--ink)", lineHeight: 1.55 }}>{r.summary}</p>
      )}

      <p style={{ margin: "18px 0 8px", fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ink-3)" }}>
        {t.findingsTitle}
      </p>

      {r.findings.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)" }}>{t.noFindings}</p>
      ) : (
        SEVERITY_ORDER.map((sev) => {
          const group = r.findings.filter((f) => f.severity === sev);
          if (group.length === 0) return null;
          return (
            <div key={sev} style={{ marginTop: 12 }}>
              <p style={{ margin: "0 0 6px", fontSize: 12.5, fontWeight: 800, color: SEVERITY_COLOR[sev] }}>
                {severityLabel(sev, t)} · {group.length}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {group.map((f, i) => (
                  <FindingCard key={`${sev}-${i}`} f={f} t={t} />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function FindingCard({ f, t }: { f: PreMortemFindingVM; t: PmStrings }) {
  return (
    <div style={{ border: `1px solid var(--line)`, borderLeft: `3px solid ${SEVERITY_COLOR[f.severity]}`, borderRadius: 12, padding: "12px 14px", background: "var(--card, #fff)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Chip tone="blue">{f.category}</Chip>
        {f.location && (
          <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>
            {t.locationLabel}: {f.location}
          </span>
        )}
      </div>
      {f.description && (
        <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--ink)", lineHeight: 1.5 }}>{f.description}</p>
      )}
      {f.correction && (
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--ink)", lineHeight: 1.5 }}>
          <strong style={{ color: "var(--accent)" }}>{t.correction}: </strong>
          {f.correction}
        </p>
      )}
    </div>
  );
}
