"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/frontend/components/brand/icon";
import { IconTile } from "@/frontend/components/brand/icon-tile";
import { Chip } from "@/frontend/components/brand/chip";
import { ScreenHead } from "@/frontend/components/mobile";

/**
 * FormulariosList — the forms list of the "Formularios" tab (DOC-51 §21 vista A).
 *
 * Shown when the phase has more than one client-facing form. Each card links into
 * the wizard (`/caso/[caseId]/formulario/[formId]`), passing the party id + name
 * for per-party forms. Status maps to a "Borrador" (blue) / "Enviado" (green) pill.
 */

export interface FormListEntry {
  formDefinitionId: string;
  label: string;
  kind: string;
  partyId: string | null;
  partyName: string | null;
  status: string | null;
}

export interface FormulariosListLabels {
  eyebrow: string;
  title: string;
  subtitle: string;
  draft: string;
  submitted: string;
  pending: string;
}

export function FormulariosList({
  caseId,
  entries,
  labels,
}: {
  caseId: string;
  entries: FormListEntry[];
  labels: FormulariosListLabels;
}) {
  const router = useRouter();

  const open = (e: FormListEntry) => {
    // Mi Historia (ai_letter) keeps its dedicated route; PDF forms use the wizard.
    const base =
      e.kind === "ai_letter" && !e.partyId
        ? `/caso/${caseId}/historia`
        : `/caso/${caseId}/formulario/${e.formDefinitionId}`;
    const qs = new URLSearchParams();
    if (e.partyId) qs.set("party", e.partyId);
    if (e.partyName) qs.set("name", e.label.includes("—") ? "" : e.partyName);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    router.push(`${base}${suffix}`);
  };

  return (
    <div style={{ minHeight: "100dvh", padding: "26px 20px var(--screen-pb)" }}>
      <ScreenHead eyebrow={labels.eyebrow} title={labels.title} sub={labels.subtitle} lexMood="atento" />
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
        {entries.map((e) => {
          const submitted = e.status === "submitted" || e.status === "approved" || e.status === "in_validation";
          const draft = e.status === "draft";
          return (
            <button
              key={`${e.formDefinitionId}:${e.partyId ?? "_"}`}
              type="button"
              onClick={() => open(e)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                width: "100%",
                background: "var(--card)",
                border: "1px solid var(--line)",
                borderRadius: 22,
                padding: "16px 16px",
                cursor: "pointer",
                textAlign: "left",
                boxShadow: "0 10px 30px rgba(11,27,51,0.06)",
              }}
            >
              <IconTile name="form" color="var(--accent)" size={48} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "var(--font-title)",
                    fontWeight: 800,
                    fontSize: 16,
                    color: "var(--navy)",
                    marginBottom: 6,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {e.label}
                </div>
                {submitted ? (
                  <Chip tone="green" dot>
                    {labels.submitted}
                  </Chip>
                ) : draft ? (
                  <Chip tone="blue" dot>
                    {labels.draft}
                  </Chip>
                ) : (
                  <Chip tone="gold">{labels.pending}</Chip>
                )}
              </div>
              <Icon name="chevR" size={20} color="var(--ink-3)" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
