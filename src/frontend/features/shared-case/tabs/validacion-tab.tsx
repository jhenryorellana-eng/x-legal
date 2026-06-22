"use client";

/**
 * Validación tab (DOC-53 §3.4 — legal review) — legal validation attempts for
 * the case (real data via getValidationsForCase). Read-only summary with the
 * semáforo + AI score per attempt; resubmit / findings-correction actions land
 * in the validation-loop wave. Only shown for admin + with_lawyer plans.
 */

import { Card } from "@/frontend/components/brand/card";
import { StatusPill, type StatusKind } from "@/frontend/components/brand/status-pill";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import type { CaseWorkspaceVM, ValidationVM } from "../types";
import type { CasosStrings } from "../strings";
import { interp } from "../strings";

const VAL_PILL: Record<string, StatusKind> = {
  validated: "aprobado",
  needs_corrections: "corregir",
  error: "corregir",
  in_review: "revision",
  sent: "pendiente",
  queued: "pendiente",
};

const SEMAFORO_COLOR: Record<string, string> = {
  green: "var(--brand-green)",
  amber: "#f59e0b",
  red: "var(--brand-red)",
};

export function ValidacionTab({
  vm,
  strings,
  title,
}: {
  vm: CaseWorkspaceVM;
  strings: CasosStrings;
  title: string;
}) {
  const t = strings.detail;
  const statusLabels = t.valStatus as Record<string, string>;

  return (
    <Card>
      <h2 style={{ margin: 0, fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 18, color: "var(--ink)" }}>
        {title}
      </h2>
      <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{t.valSub}</p>

      {vm.validations.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState title={t.valEmpty} mood="calma" lexSize={104} />
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          {vm.validations.map((v: ValidationVM) => (
            <div key={v.id} className="formcard">
              <span
                aria-hidden="true"
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  flexShrink: 0,
                  background: v.semaforo ? (SEMAFORO_COLOR[v.semaforo] ?? "var(--line)") : "var(--line)",
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>
                  {interp(t.valAttempt, { n: String(v.attemptNo) })}
                </p>
                {v.aiScore != null && (
                  <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>
                    {t.valScore}: {v.aiScore}
                  </p>
                )}
              </div>
              <StatusPill kind={VAL_PILL[v.status] ?? "pendiente"}>
                {statusLabels[v.status] ?? v.status}
              </StatusPill>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
