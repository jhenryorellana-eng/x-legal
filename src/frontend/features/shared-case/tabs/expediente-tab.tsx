"use client";

/**
 * Expediente tab (DOC-53 §3.4 — legal file) — expediente assembly attempts for
 * the case (real data via getCaseExpedientes). Read-only summary per attempt
 * (status + page count); the drag&drop assembler + compile/send actions land in
 * the expediente-assembler wave. Admin-only.
 */

import { Card } from "@/frontend/components/brand/card";
import { StatusPill, type StatusKind } from "@/frontend/components/brand/status-pill";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import type { CaseWorkspaceVM, ExpedienteVM } from "../types";
import type { CasosStrings } from "../strings";
import { interp } from "../strings";

const EXP_PILL: Record<string, StatusKind> = {
  draft: "pendiente",
  compiling: "revision",
  compile_failed: "corregir",
  compiled: "revision",
  sent_to_lawyer: "revision",
  corrections_needed: "corregir",
  approved: "aprobado",
  sent_to_finance: "hecho",
  printed: "hecho",
};

export function ExpedienteTab({
  vm,
  strings,
  title,
}: {
  vm: CaseWorkspaceVM;
  strings: CasosStrings;
  title: string;
}) {
  const t = strings.detail;
  const statusLabels = t.expStatus as Record<string, string>;

  return (
    <Card>
      <h2 style={{ margin: 0, fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 18, color: "var(--ink)" }}>
        {title}
      </h2>
      <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{t.expSub}</p>

      {vm.expedientes.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState title={t.expEmpty} mood="calma" lexSize={104} />
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          {vm.expedientes.map((e: ExpedienteVM) => (
            <div key={e.id} className="formcard">
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>
                  {interp(t.expAttempt, { n: String(e.attemptNo) })}
                </p>
                {e.pageCount != null && (
                  <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>
                    {interp(t.expPages, { n: String(e.pageCount) })}
                  </p>
                )}
              </div>
              <StatusPill kind={EXP_PILL[e.status] ?? "pendiente"}>
                {statusLabels[e.status] ?? e.status}
              </StatusPill>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
