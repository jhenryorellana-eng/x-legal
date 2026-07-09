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
import { Icon } from "@/frontend/components/brand/icon";
import type { CaseWorkspaceVM, ExpedienteVM } from "../types";
import type { CasosStrings } from "../strings";
import { interp } from "../strings";

const EXP_PILL: Record<string, StatusKind> = {
  draft: "pendiente",
  compiling: "revision",
  compile_failed: "corregir",
  compiled: "revision",
  ready: "aprobado",
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
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 18, color: "var(--ink)" }}>
            {title}
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{t.expSub}</p>
        </div>
        {/*
          Native <a> (not next/link) on purpose: the client-side <Link> nav did NOT
          fire from inside the shared-case-view tab tree (worked from the sidebar) —
          a plain anchor lets the browser navigate reliably. The assembler route is
          force-dynamic, so a full navigation is expected anyway.
        */}
        <a
          href={`/legal/expediente/${vm.header.caseId}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            fontWeight: 800,
            color: "#fff",
            textDecoration: "none",
            borderRadius: 999,
            padding: "8px 16px",
            background: "linear-gradient(120deg, var(--accent), var(--navy, #002855))",
            whiteSpace: "nowrap",
          }}
        >
          <Icon name="doc" size={15} color="#fff" />
          {t.expOpenAssembler}
        </a>
      </div>

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
