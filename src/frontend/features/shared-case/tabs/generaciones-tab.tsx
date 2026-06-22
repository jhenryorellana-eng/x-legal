"use client";

/**
 * Generaciones (Henry) / Cartas (Vanessa) tab — ai-engine generation runs for
 * the case (`.letter-row` design). Real data via getRunsForCase; the same
 * component serves both surfaces with a different title. Generate / retry /
 * download actions land in a later wave.
 */

import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { StatusPill, type StatusKind } from "@/frontend/components/brand/status-pill";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import type { CaseWorkspaceVM, GenerationVM } from "../types";
import type { CasosStrings } from "../strings";
import { interp } from "../strings";

const GEN_PILL: Record<string, StatusKind> = {
  completed: "aprobado",
  running: "revision",
  queued: "pendiente",
  failed: "corregir",
  cancelled: "pendiente",
};

function fmtUsd(v: number | null, locale: "es" | "en"): string {
  if (v == null) return "—";
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(v);
}

export function GeneracionesTab({
  vm,
  strings,
  locale,
  title,
}: {
  vm: CaseWorkspaceVM;
  strings: CasosStrings;
  locale: "es" | "en";
  title: string;
}) {
  const t = strings.detail;
  const statusLabels = t.genStatus as Record<string, string>;

  return (
    <Card>
      <h2 style={{ margin: 0, fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 18, color: "var(--ink)" }}>
        {title}
      </h2>
      <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{t.genSub}</p>

      {vm.generations.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState title={t.genEmpty} mood="calma" lexSize={104} />
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          {vm.generations.map((g: GenerationVM) => (
            <div key={g.id} className="letter-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>{g.formLabel}</p>
                <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>
                  {interp(t.genVersion, { n: String(g.version) })}
                  {g.partyName ? ` · ${g.partyName}` : ""}
                  {g.costUsd != null ? ` · ${fmtUsd(g.costUsd, locale)}` : ""}
                </p>
              </div>
              {g.isCurrent && <Chip tone="blue">{t.genCurrent}</Chip>}
              <StatusPill kind={GEN_PILL[g.status] ?? "pendiente"}>
                {statusLabels[g.status] ?? g.status}
              </StatusPill>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
