"use client";

/**
 * Historial / Bitácora tab (DOC-52 §5.10 / DOC-53 §3.4) — the case timeline
 * grouped by day (`.casetl` design). Cursor pagination ("cargar más") lands in
 * a later wave; for now it renders the recent window loaded by the page.
 */

import { Card } from "@/frontend/components/brand/card";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import type { CaseWorkspaceVM } from "../types";
import type { CasosStrings } from "../strings";
import { CaseHistory } from "../components/case-history";

export function HistorialTab({
  vm,
  strings,
  locale,
}: {
  vm: CaseWorkspaceVM;
  strings: CasosStrings;
  locale: "es" | "en";
}) {
  const t = strings.detail;
  return (
    <Card>
      <h2 style={{ margin: 0, fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 18, color: "var(--ink)" }}>
        {t.historialTitle}
      </h2>
      <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{t.historialSub}</p>

      <div style={{ marginTop: 18 }}>
        {vm.timeline.length === 0 ? (
          <EmptyState title={t.noMoreEvents} mood="calma" lexSize={104} />
        ) : (
          <CaseHistory events={vm.timeline} locale={locale} />
        )}
      </div>
    </Card>
  );
}
