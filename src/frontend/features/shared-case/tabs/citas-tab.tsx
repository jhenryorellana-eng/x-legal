"use client";

/**
 * Ruta de citas / Citas tab (DOC-52 §5.5 / DOC-53 §3.4) — the phase route
 * stepper (real phaseIndex/phaseCount). Appointment list + scheduling actions
 * (book / reschedule / cancel) land in the scheduling wave.
 */

import { Card } from "@/frontend/components/brand/card";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import type { CaseWorkspaceVM } from "../types";
import type { CasosStrings } from "../strings";
import { SectionLabel } from "../ui";
import { PhaseStepper } from "../components/phase-stepper";

export function CitasTab({
  vm,
  strings,
}: {
  vm: CaseWorkspaceVM;
  strings: CasosStrings;
}) {
  const t = strings.detail;
  return (
    <Card>
      <SectionLabel icon="route">{t.routeTitle}</SectionLabel>

      {vm.header.phaseCount > 0 ? (
        <div style={{ marginTop: 18, overflowX: "auto", paddingBottom: 4 }}>
          <PhaseStepper
            index={vm.header.phaseIndex}
            count={vm.header.phaseCount}
            currentLabel={vm.header.phaseLabel}
            phaseWord={strings.colPhase}
          />
        </div>
      ) : (
        <p style={{ margin: "12px 0 0", fontSize: 14, color: "var(--ink-2)" }}>{t.bannerNoPhase}</p>
      )}

      <div style={{ marginTop: 20 }}>
        <EmptyState title={t.tabStubTitle} subtitle={t.tabStubSub} mood="calma" lexSize={96} />
      </div>
    </Card>
  );
}
