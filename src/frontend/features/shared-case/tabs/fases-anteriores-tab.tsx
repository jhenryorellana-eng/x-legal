"use client";

/**
 * Fases anteriores tab (Etapa C) — READ-ONLY view of the documents + form
 * responses from service phases the case has already PASSED. Backed by
 * cases.getPriorPhaseMaterials (mapped to vm.priorPhases by the RSC page).
 *
 * Strictly read-only: documents preview in-app via the same /preview route as
 * Documentos; forms offer a download of the ALREADY-generated filled PDF
 * (getFilledPdfUrl → bridge.openExternal, RNF-036). No upload / approve / edit /
 * regenerate affordances live here.
 */

import * as React from "react";
import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { Icon } from "@/frontend/components/brand/icon";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { StatusPill, type StatusKind } from "@/frontend/components/brand/status-pill";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import { toast } from "@/frontend/components/desktop/toast";
import { getBridge } from "@/frontend/platform-bridge";
import { toDownloadFilename } from "@/shared/strings";
import type { CaseWorkspaceVM, CaseDetailActions } from "../types";
import type { CasosStrings } from "../strings";
import { SectionLabel } from "../ui";
import { DocumentPreviewModal } from "../document-preview-modal";

const DOC_PILL: Record<string, StatusKind> = {
  uploaded: "revision",
  approved: "aprobado",
  rejected: "corregir",
};

function docStatusLabel(s: string, t: CasosStrings["detail"]): string {
  if (s === "approved") return t.docStatus.approved;
  if (s === "rejected") return t.docStatus.rejected;
  if (s === "uploaded") return t.docStatus.uploaded;
  return s;
}

function formMeta(
  status: string,
  t: CasosStrings["detail"],
): { tone: "green" | "blue" | "amber"; label: string } {
  switch (status) {
    case "approved":
      return { tone: "green", label: t.formStatusApproved };
    case "submitted":
      return { tone: "blue", label: t.formStatusSubmitted };
    case "draft":
      return { tone: "amber", label: t.formStatusDraft };
    default:
      return { tone: "blue", label: t.formStatusPending };
  }
}

function docDownloadName(displayName: string, mimeType: string): string {
  return toDownloadFilename(displayName, mimeType === "image/png" ? "png" : "pdf");
}

export function FasesAnterioresTab({
  vm,
  actions,
  strings,
}: {
  vm: CaseWorkspaceVM;
  actions: CaseDetailActions;
  strings: CasosStrings;
}) {
  const t = strings.detail;
  const fa = t.fasesAnteriores;
  const tb = t.tabs;
  const groups = vm.priorPhases ?? [];
  const [previewDoc, setPreviewDoc] = React.useState<{ id: string; label: string; downloadName: string } | null>(null);
  const [busyForm, setBusyForm] = React.useState<string | null>(null);

  async function onDownloadForm(responseId: string) {
    if (!actions.getFilledPdfUrl) return;
    setBusyForm(responseId);
    const r = await actions.getFilledPdfUrl({ responseId });
    setBusyForm(null);
    if (r.ok && r.url) getBridge().share.openExternal(r.url);
    else toast.error(strings.errorTitle);
  }

  const subHead = (text: string) => (
    <p
      style={{
        margin: "14px 0 6px",
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--ink-3)",
      }}
    >
      {text}
    </p>
  );

  return (
    <Card>
      <SectionLabel icon="clock">{tb.fasesAnteriores}</SectionLabel>
      <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{fa.sub}</p>

      {groups.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState title={fa.empty} mood="calma" lexSize={104} />
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {groups.map((group) => (
            <div key={group.phaseId} style={{ marginTop: 18 }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontFamily: "var(--font-title)",
                  fontWeight: 800,
                  fontSize: 15,
                  color: "var(--ink)",
                  borderLeft: "3px solid var(--accent)",
                  paddingLeft: 10,
                }}
              >
                {group.label}
              </div>

              {group.documents.length > 0 && (
                <>
                  {subHead(tb.documentos)}
                  {group.documents.map((d) => (
                    <div key={d.documentId} className="formcard">
                      <span aria-hidden="true" style={{ flexShrink: 0 }}>
                        <Icon name="doc" size={20} color="var(--brand-red)" />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {d.displayName}
                        </p>
                        {d.partyName && (
                          <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>{d.partyName}</p>
                        )}
                      </div>
                      <StatusPill kind={DOC_PILL[d.status] ?? "hecho"} variant="subtle">
                        {docStatusLabel(d.status, t)}
                      </StatusPill>
                      <GhostBtn
                        size="md"
                        full={false}
                        icon="zoom"
                        onClick={() =>
                          setPreviewDoc({
                            id: d.documentId,
                            label: d.displayName,
                            downloadName: docDownloadName(d.displayName, d.mimeType),
                          })
                        }
                      >
                        {t.view}
                      </GhostBtn>
                    </div>
                  ))}
                </>
              )}

              {group.forms.length > 0 && (
                <>
                  {subHead(tb.formularios)}
                  {group.forms.map((f) => {
                    const m = formMeta(f.status, t);
                    return (
                      <div key={f.responseId} className="formcard">
                        <span aria-hidden="true" style={{ flexShrink: 0 }}>
                          <Icon name="form" size={20} color="var(--accent)" />
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>{f.label}</p>
                          {f.partyName && (
                            <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>{f.partyName}</p>
                          )}
                        </div>
                        <Chip tone={m.tone} dot>
                          {m.label}
                        </Chip>
                        {f.filledPdfPath ? (
                          <GhostBtn
                            size="md"
                            full={false}
                            icon="external"
                            disabled={busyForm === f.responseId}
                            onClick={() => onDownloadForm(f.responseId)}
                          >
                            {t.download}
                          </GhostBtn>
                        ) : (
                          <Chip tone="blue">{fa.noPdf}</Chip>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {previewDoc && (
        <DocumentPreviewModal
          open={previewDoc !== null}
          onOpenChange={(o) => !o && setPreviewDoc(null)}
          src={`/api/v1/cases/${vm.header.caseId}/documents/${previewDoc.id}/preview?kind=source`}
          title={previewDoc.label}
          downloadName={previewDoc.downloadName}
          strings={{ previewTitle: t.previewTitle, previewError: t.previewError, download: t.download }}
        />
      )}
    </Card>
  );
}
