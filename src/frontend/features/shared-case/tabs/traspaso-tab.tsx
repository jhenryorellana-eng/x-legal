"use client";

/**
 * Traspaso tab (DOC-52 §5.9) — stage-aware, ACTIONABLE handoff.
 *
 * Shows the current stage's task checklist (so the responsible never gets lost)
 * and a "Traspasar" button that is enabled only once every gating task is done
 * (an admin may force). Admin can also reassign the responsible within the stage.
 * The kanban card moves to the next owner automatically (case.owner_changed).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/frontend/components/brand/card";
import { Icon } from "@/frontend/components/brand/icon";
import { stageLabel } from "../stage-label";
import { interp } from "../strings";
import type { CaseWorkspaceVM, CaseDetailActions } from "../types";
import type { CasosStrings } from "../strings";

/** Maps a checklist item key → its i18n label key under strings.detail. */
const CHECK_LABEL: Record<string, keyof CasosStrings["detail"]> = {
  payment: "checkPayment",
  contract: "checkContract",
  citas: "checkCitas",
  docs: "checkDocs",
  forms: "checkForms",
  translation: "checkTranslation",
  expediente: "checkExpediente",
  expediente_compiled: "checkExpedienteCompiled",
  expediente_sent: "checkExpedienteSent",
  expediente_printed: "checkExpedientePrinted",
  print_send: "checkPrintSend",
};

export function TraspasoTab({
  vm,
  actions,
  strings,
}: {
  vm: CaseWorkspaceVM;
  actions: CaseDetailActions;
  strings: CasosStrings;
}) {
  const t = strings.detail;
  const router = useRouter();
  const stage = vm.stage ?? null;

  const [pending, startTransition] = React.useTransition();
  const [force, setForce] = React.useState(false);
  const [toOwner, setToOwner] = React.useState("");
  const [reassignTo, setReassignTo] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const [reassignErr, setReassignErr] = React.useState<string | null>(null);

  if (!stage) {
    return (
      <Card>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)" }}>{t.traspasoSub}</p>
      </Card>
    );
  }

  const isTerminal = stage.nextStage === null;
  const needsPick = stage.nextStageOwners.length > 1;
  const pickOk = !needsPick || toOwner !== "";
  const baseEnabled = stage.canTransfer || (stage.isAdmin && force);
  const canSubmitTransfer =
    !!actions.transferCase && !isTerminal && baseEnabled && pickOk && !pending;

  const nextLabel = stage.nextStage ? stageLabel(t, stage.nextStage) : "";

  function onTransfer() {
    if (!actions.transferCase) return;
    setErr(null);
    startTransition(async () => {
      const res = await actions.transferCase!({
        caseId: vm.header.caseId,
        toOwnerId: needsPick ? toOwner : undefined,
        force: force && stage!.isAdmin,
      });
      if (res?.ok) router.refresh();
      else setErr(res?.error?.code ?? "transferError");
    });
  }

  function onReassign() {
    if (!actions.assignCaseOwner || !reassignTo) return;
    setReassignErr(null);
    startTransition(async () => {
      const res = await actions.assignCaseOwner!({
        caseId: vm.header.caseId,
        ownerId: reassignTo,
      });
      if (res?.ok) router.refresh();
      else setReassignErr(res?.error?.code ?? "reassignError");
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <h2 style={{ margin: 0, fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 18, color: "var(--ink)" }}>
          {t.traspasoTasksTitle}
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{t.traspasoSub}</p>

        {/* Checklist */}
        <div style={{ marginTop: 18 }}>
          {stage.checklist.map((it) => {
            const labelKey = CHECK_LABEL[it.key];
            const label = labelKey ? t[labelKey] : it.key;
            // n/a = the category has nothing to do yet (total 0). Render it muted
            // ("no aplica") instead of a green check, so an empty case doesn't look
            // "all done" while the handoff stays blocked.
            const na = it.applicable === false;
            return (
              <div key={it.key} className={`tras-item${na ? " na" : ""}`}>
                <span className={`tras-check ${na ? "na" : it.done ? "ok" : "no"}`}>
                  <Icon name={na ? "x" : it.done ? "check" : "info"} size={16} color={na ? "var(--ink-3)" : it.done ? "#fff" : "#b5740b"} />
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: na ? "var(--ink-3)" : "var(--ink)" }}>
                  {String(label)}
                  {na && (
                    <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: "var(--ink-3)" }}>
                      · {t.taskNotApplicable}
                    </span>
                  )}
                  {it.placeholder && (
                    <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>
                      · {t.taskPlaceholder}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {/* Status line */}
        <div
          style={{
            marginTop: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: stage.allDone ? "var(--green-soft)" : "var(--gold-soft)",
            borderRadius: 12,
            padding: "12px 14px",
          }}
        >
          <Icon name={stage.allDone ? "check" : "clock"} size={18} color={stage.allDone ? "var(--green)" : "var(--gold-deep)"} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: stage.allDone ? "var(--green)" : "var(--gold-deep)" }}>
            {isTerminal ? t.stageTerminal : stage.allDone ? t.traspasoReady : t.transferBlocked}
          </span>
        </div>
      </Card>

      {/* Transfer action */}
      {!isTerminal && actions.transferCase && (
        <Card>
          {/* Next-owner picker (only when several candidates) */}
          {needsPick && (
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 6 }}>
                {interp(t.transferButton, { stage: nextLabel })}
              </span>
              <select
                value={toOwner}
                onChange={(e) => setToOwner(e.target.value)}
                style={selectStyle}
              >
                <option value="">{t.selectOwner}</option>
                {stage.nextStageOwners.map((o) => (
                  <option key={o.userId} value={o.userId}>{o.displayName}</option>
                ))}
              </select>
            </label>
          )}

          {/* Admin force (when tasks are not all done) */}
          {stage.isAdmin && !stage.allDone && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, color: "var(--ink-2)", fontWeight: 600 }}>
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              {t.transferForce}
            </label>
          )}

          <button
            type="button"
            disabled={!canSubmitTransfer}
            onClick={onTransfer}
            style={primaryBtnStyle(canSubmitTransfer)}
          >
            <Icon name="chevR" size={16} color="#fff" />
            {interp(t.transferButton, { stage: nextLabel })}
          </button>

          {err && (
            <p style={{ margin: "10px 0 0", fontSize: 13, fontWeight: 700, color: "var(--red)" }}>{t.transferError}</p>
          )}
        </Card>
      )}

      {/* Admin reassign within stage */}
      {stage.isAdmin && actions.assignCaseOwner && stage.eligibleOwners.length > 0 && (
        <Card>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>{t.reassignTitle}</h3>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} style={{ ...selectStyle, maxWidth: 260 }}>
              <option value="">{t.selectOwner}</option>
              {stage.eligibleOwners.map((o) => (
                <option key={o.userId} value={o.userId}>{o.displayName}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!reassignTo || pending}
              onClick={onReassign}
              style={secondaryBtnStyle(!!reassignTo && !pending)}
            >
              {t.reassignButton}
            </button>
          </div>
          {reassignErr && (
            <p style={{ margin: "10px 0 0", fontSize: 13, fontWeight: 700, color: "var(--red)" }}>{t.reassignError}</p>
          )}
        </Card>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  fontSize: 14,
  fontWeight: 600,
  color: "var(--ink)",
  background: "var(--card, #fff)",
};

function primaryBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "11px 18px",
    borderRadius: 12,
    border: "none",
    fontSize: 14,
    fontWeight: 800,
    color: "#fff",
    background: enabled ? "var(--accent)" : "var(--ink-3, #b8c0cc)",
    cursor: enabled ? "pointer" : "not-allowed",
  };
}

function secondaryBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    padding: "9px 16px",
    borderRadius: 10,
    border: "1px solid var(--line)",
    fontSize: 13.5,
    fontWeight: 700,
    color: enabled ? "var(--accent)" : "var(--ink-3, #b8c0cc)",
    background: "var(--card, #fff)",
    cursor: enabled ? "pointer" : "not-allowed",
  };
}
