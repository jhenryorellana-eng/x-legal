"use client";

/**
 * Evaluación tab — external evaluation tool (v1: Juez). Read-only status of the
 * client's evaluation session (attempts, runs, delivered report) plus two staff
 * affordances: download the delivered PDF (getEvaluationPdfUrl → bridge.openExternal,
 * RNF-036) and — admin only — grant one extra attempt (onGrantAttempt injected).
 *
 * The tab is visible only when the case's service has an external tool enabled
 * (vm.hasExternalTool); the panel data comes fully resolved from the RSC page.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { Icon } from "@/frontend/components/brand/icon";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { StatusPill, type StatusKind } from "@/frontend/components/brand/status-pill";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import { toast } from "@/frontend/components/desktop/toast";
import { getBridge } from "@/frontend/platform-bridge";
import type { CaseWorkspaceVM, CaseDetailActions, EvaluationStatusVM, EvaluationRunStatusVM } from "../types";
import type { CasosStrings } from "../strings";
import { interp } from "../strings";
import { SectionLabel } from "../ui";

const STATUS_PILL: Record<EvaluationStatusVM, StatusKind> = {
  not_started: "pendiente",
  pending: "pendiente",
  in_progress: "revision",
  delivered: "aprobado",
  failed: "corregir",
};

const RUN_PILL: Record<EvaluationRunStatusVM, StatusKind> = {
  consumed: "revision",
  completed: "aprobado",
  failed: "corregir",
};

function fmtDate(iso: string, locale: "es" | "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale === "en" ? "en-US" : "es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function EvaluacionTab({
  vm,
  actions,
  strings,
  title,
  locale,
}: {
  vm: CaseWorkspaceVM;
  actions: CaseDetailActions;
  strings: CasosStrings;
  title: string;
  locale: "es" | "en";
}) {
  const router = useRouter();
  const t = strings.detail;
  const e = t.evaluacion;
  const statusLabels = e.status as Record<string, string>;
  const runStatusLabels = e.runStatus as Record<string, string>;
  const panel = vm.evaluationPanel;
  const caseId = vm.header.caseId;

  const [busyPdf, setBusyPdf] = React.useState(false);
  const [busyGrant, setBusyGrant] = React.useState(false);
  const [confirmGrant, setConfirmGrant] = React.useState(false);

  // Grant is admin-only — the admin page injects the action; other surfaces don't.
  const canGrant = typeof actions.grantEvaluationAttempt === "function";

  async function onDownloadPdf() {
    if (!actions.getEvaluationPdfUrl) return;
    setBusyPdf(true);
    try {
      const r = await actions.getEvaluationPdfUrl({ caseId });
      if (r.ok && r.url) getBridge().share.openExternal(r.url);
      else toast.error(strings.errorTitle);
    } finally {
      setBusyPdf(false);
    }
  }

  async function onGrant() {
    if (!actions.grantEvaluationAttempt) return;
    setBusyGrant(true);
    try {
      const r = await actions.grantEvaluationAttempt({ caseId });
      if (r.ok) {
        toast.success(e.grantSuccess);
        setConfirmGrant(false);
        // The panel is server-rendered — re-fetch so the new attempt count shows.
        router.refresh();
      } else {
        toast.error(e.grantError);
      }
    } finally {
      setBusyGrant(false);
    }
  }

  if (!panel || panel.status === "not_started") {
    return (
      <Card>
        <SectionLabel icon="scale">{title}</SectionLabel>
        <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{e.sub}</p>
        <div style={{ marginTop: 16 }}>
          <EmptyState title={e.empty} mood="calma" lexSize={104} />
        </div>
        {/* Even before the client opens the tool, admin may pre-grant an attempt. */}
        {panel && canGrant && (
          <div style={{ marginTop: 16 }}>
            <GrantControl
              confirming={confirmGrant}
              busy={busyGrant}
              labels={e}
              onAsk={() => setConfirmGrant(true)}
              onCancel={() => setConfirmGrant(false)}
              onConfirm={onGrant}
            />
          </div>
        )}
      </Card>
    );
  }

  const report = panel.reportMeta;
  const hasReport =
    panel.status === "delivered" &&
    (report.score != null || report.nivel != null || report.headline != null);

  return (
    <Card>
      <SectionLabel icon="scale">{title}</SectionLabel>
      <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{e.sub}</p>

      {/* Status + attempts */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
        <StatusPill kind={STATUS_PILL[panel.status]}>{statusLabels[panel.status] ?? panel.status}</StatusPill>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-2)" }}>
          {interp(e.attempts, { used: String(panel.attemptsUsed), allowed: String(panel.attemptsAllowed) })}
        </span>
        {panel.deliveredAt && (
          <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>
            {interp(e.deliveredAt, { date: fmtDate(panel.deliveredAt, locale) })}
          </span>
        )}
      </div>

      {/* Last error (failed) */}
      {panel.status === "failed" && report.lastError && (
        <div
          style={{
            marginTop: 14,
            display: "flex",
            alignItems: "flex-start",
            gap: 9,
            background: "var(--red-soft, #fef2f2)",
            borderRadius: 12,
            padding: "10px 14px",
          }}
        >
          <Icon name="info" size={17} color="var(--brand-red)" />
          <div>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: "var(--brand-red)" }}>{e.lastErrorLabel}</p>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--ink-2)", fontWeight: 600 }}>{report.lastError}</p>
          </div>
        </div>
      )}

      {/* Delivered report */}
      {hasReport && (
        <div
          style={{
            marginTop: 16,
            background: "var(--green-soft)",
            borderRadius: 14,
            padding: "14px 16px",
          }}
        >
          {report.headline && (
            <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>{report.headline}</p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: report.headline ? 10 : 0 }}>
            {report.nivel != null && <Chip tone="green" dot>{`${e.nivel}: ${report.nivel}`}</Chip>}
            {report.score != null && <Chip tone="blue">{`${e.score}: ${report.score}`}</Chip>}
          </div>
        </div>
      )}

      {/* Download PDF */}
      {panel.pdfAvailable && actions.getEvaluationPdfUrl && (
        <div style={{ marginTop: 16 }}>
          <GhostBtn size="md" full={false} icon="external" disabled={busyPdf} onClick={onDownloadPdf}>
            {e.download}
          </GhostBtn>
        </div>
      )}

      {/* Runs */}
      <div style={{ marginTop: 20 }}>
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
          }}
        >
          {e.runsTitle}
        </p>
        {panel.runs.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)", fontWeight: 600 }}>{e.noRuns}</p>
        ) : (
          panel.runs.map((run) => (
            <div key={run.jobId} className="formcard">
              <span aria-hidden="true" style={{ flexShrink: 0 }}>
                <Icon name="bolt" size={18} color="var(--accent)" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: "var(--ink)", fontFamily: "var(--font-mono, monospace)" }}>
                  {run.jobId.slice(0, 8)}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink-3)", fontWeight: 700 }}>
                  {fmtDate(run.createdAt, locale)}
                  {run.error ? ` · ${run.error}` : ""}
                </p>
              </div>
              <StatusPill kind={RUN_PILL[run.status]} variant="subtle">
                {runStatusLabels[run.status] ?? run.status}
              </StatusPill>
            </div>
          ))
        )}
      </div>

      {/* Grant extra attempt (admin) */}
      {canGrant && (
        <div style={{ marginTop: 20, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          <GrantControl
            confirming={confirmGrant}
            busy={busyGrant}
            labels={e}
            onAsk={() => setConfirmGrant(true)}
            onCancel={() => setConfirmGrant(false)}
            onConfirm={onGrant}
          />
        </div>
      )}
    </Card>
  );
}

/** Inline confirm control for the admin "+1 attempt" action. */
function GrantControl({
  confirming,
  busy,
  labels,
  onAsk,
  onCancel,
  onConfirm,
}: {
  confirming: boolean;
  busy: boolean;
  labels: CasosStrings["detail"]["evaluacion"];
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!confirming) {
    return (
      <GhostBtn size="md" full={false} icon="plus" onClick={onAsk}>
        {labels.grant}
      </GhostBtn>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>{labels.grantConfirm}</span>
      <div style={{ display: "flex", gap: 8 }}>
        <GradientBtn size="sm" icon="check" disabled={busy} onClick={onConfirm}>
          {labels.grantConfirmYes}
        </GradientBtn>
        <GhostBtn size="md" full={false} disabled={busy} onClick={onCancel}>
          {labels.grantCancel}
        </GhostBtn>
      </div>
    </div>
  );
}
