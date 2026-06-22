"use client";

/**
 * Información / Formularios tab (DOC-52 §5.7 / DOC-53 §3.4.3) — the client forms
 * for the current phase with their real status (`.formcard` design). The form
 * wizard ("Revisar") is wired in a later wave.
 */

import { useRouter } from "next/navigation";
import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { ProgressRing } from "@/frontend/components/brand/progress-ring";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import type { CaseWorkspaceVM, FormVM } from "../types";
import type { CasosStrings } from "../strings";
import { SectionLabel } from "../ui";

function formMeta(status: string | null, t: CasosStrings["detail"]): { pct: number; tone: "green" | "blue" | "amber"; label: string } {
  switch (status) {
    case "approved":
      return { pct: 100, tone: "green", label: t.formStatusApproved };
    case "submitted":
      return { pct: 100, tone: "blue", label: t.formStatusSubmitted };
    case "draft":
      return { pct: 50, tone: "amber", label: t.formStatusDraft };
    default:
      return { pct: 0, tone: "blue", label: t.formStatusPending };
  }
}

export function InformacionTab({
  vm,
  strings,
}: {
  vm: CaseWorkspaceVM;
  strings: CasosStrings;
}) {
  const t = strings.detail;
  const router = useRouter();
  const formsHref = `/admin/casos/${vm.header.caseId}/formularios`;
  return (
    <Card>
      <SectionLabel icon="form">{t.formsTitle}</SectionLabel>
      <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{t.formsSub}</p>

      {vm.forms.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState title={t.formsEmpty} mood="calma" lexSize={104} />
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          {vm.forms.map((f: FormVM) => {
            const m = formMeta(f.status, t);
            return (
              <div key={`${f.id}-${f.partyName ?? ""}`} className="formcard">
                <ProgressRing pct={m.pct} size={46} stroke={6} aria-label={f.label} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>{f.label}</p>
                  {f.partyName && (
                    <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>{f.partyName}</p>
                  )}
                </div>
                <Chip tone={m.tone} dot>
                  {m.label}
                </Chip>
                <GhostBtn
                  size="md"
                  full={false}
                  icon="chevR"
                  disabled={!vm.isAdmin}
                  onClick={vm.isAdmin ? () => router.push(formsHref) : undefined}
                >
                  {t.reviewForm}
                </GhostBtn>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
