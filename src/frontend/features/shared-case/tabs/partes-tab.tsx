"use client";

/**
 * Partes tab — list of case_parties (DOC-53 §3.5, read-only in F2-W2-b).
 * Add/remove party flows arrive with the Asignaciones modal in a future phase.
 */

import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import type { CaseWorkspaceVM } from "../types";
import type { CasosStrings } from "../strings";
import { SectionLabel } from "../ui";

export function PartesTab({
  vm,
  strings,
}: {
  vm: CaseWorkspaceVM;
  strings: CasosStrings;
}) {
  const t = strings.detail;

  return (
    <Card>
      <SectionLabel icon="family">{t.partiesTitle}</SectionLabel>

      {vm.parties.length === 0 ? (
        <div style={{ marginTop: 14 }}>
          <EmptyState title={t.partiesEmpty} mood="calma" lexSize={104} />
        </div>
      ) : (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {vm.parties.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 14px",
                border: "1px solid var(--line)",
                borderRadius: 14,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  background: "linear-gradient(135deg, var(--accent), var(--navy))",
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  fontFamily: "var(--font-title)",
                  fontWeight: 800,
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                {p.name.charAt(0).toUpperCase()}
              </span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
                {p.name}
              </span>
              {p.role && <Chip tone="blue">{p.role}</Chip>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
