"use client";

/**
 * AdvancePhaseAction — reusable "Avanzar de fase" control (button + confirm modal
 * + sales-owner picker) for the operations phase boundary (Andrium / admin).
 *
 * Mirrors the print-queue AdvanceModal flow (features/andrium/impresion), but
 * generalized: the surface injects the `advance` action + its own strings. On a
 * cycle restart with several eligible sales owners the backend answers
 * STAGE_OWNER_REQUIRED with `candidates` → we keep the modal open and ask.
 *
 * Boundaries: frontend-only. The action is a prop; no @/backend import.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { GradientBtn, GhostBtn } from "@/frontend/components/brand";
import { Modal, toast } from "@/frontend/components/desktop";

export interface AdvancePhaseOwnerOptionVM {
  userId: string;
  displayName: string;
  role: string;
}

/** The injected server action (subset of CaseDetailActions.advanceCasePhase). */
export type AdvancePhaseFn = (input: {
  caseId: string;
  toOwnerId?: string | null;
}) => Promise<{
  ok: boolean;
  completed?: boolean;
  candidates?: AdvancePhaseOwnerOptionVM[];
  error?: { code: string };
}>;

export interface AdvancePhaseStrings {
  button: string;
  /** Shown (muted) below the disabled button when the gate isn't met yet. */
  blocked: string;
  confirmTitle: string;
  confirmBody: string;
  ownerLabel: string;
  ownerHint: string;
  selectOwner: string;
  cancel: string;
  toastAdvanced: string;
  toastCompleted: string;
  errorTitle: string;
}

const selectStyle: React.CSSProperties = {
  height: 44,
  borderRadius: 12,
  border: "2px solid var(--line)",
  padding: "0 12px",
  fontSize: 15,
  color: "var(--ink)",
  background: "var(--card)",
  outline: "none",
  fontFamily: "var(--font-title)",
};

export function AdvancePhaseAction({
  caseId,
  advance,
  enabled,
  strings,
}: {
  caseId: string;
  advance: AdvancePhaseFn;
  /** Gate met (expediente printed). false → button disabled + hint. */
  enabled: boolean;
  strings: AdvancePhaseStrings;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // Populated only when the backend needs a sales owner pick (cycle restart).
  const [candidates, setCandidates] = React.useState<AdvancePhaseOwnerOptionVM[] | null>(null);
  const [owner, setOwner] = React.useState("");

  function openModal() {
    setCandidates(null);
    setOwner("");
    setOpen(true);
  }

  async function confirm() {
    setBusy(true);
    try {
      const res = await advance({ caseId, toOwnerId: owner || undefined });
      if (res.ok) {
        toast.success(res.completed ? strings.toastCompleted : strings.toastAdvanced);
        setOpen(false);
        router.refresh();
      } else if (res.error?.code === "STAGE_OWNER_REQUIRED" && res.candidates?.length) {
        // Several sales owners are eligible — keep the modal open and ask.
        setCandidates(res.candidates);
      } else {
        toast.error(strings.errorTitle);
      }
    } finally {
      setBusy(false);
    }
  }

  const needsOwner = !!candidates && candidates.length > 0;
  const confirmDisabled = busy || (needsOwner && !owner);

  return (
    <>
      <GradientBtn size="md" full icon="chevR" disabled={!enabled} onClick={openModal}>
        {strings.button}
      </GradientBtn>
      {!enabled && (
        <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--ink-3)", fontWeight: 600 }}>
          {strings.blocked}
        </p>
      )}

      <Modal
        open={open}
        onOpenChange={setOpen}
        title={strings.confirmTitle}
        footer={
          <>
            <GhostBtn size="md" full={false} onClick={() => setOpen(false)} disabled={busy}>
              {strings.cancel}
            </GhostBtn>
            <GradientBtn size="md" full={false} onClick={confirm} disabled={confirmDisabled}>
              {busy ? "…" : strings.button}
            </GradientBtn>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--ink-2)" }}>
          {strings.confirmBody}
        </p>
        {needsOwner && (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="advance-phase-owner" style={{ fontSize: 14, fontWeight: 700, color: "var(--ink-2)" }}>
              {strings.ownerLabel}
            </label>
            <select
              id="advance-phase-owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              style={selectStyle}
            >
              <option value="">{strings.selectOwner}</option>
              {candidates!.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.displayName}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{strings.ownerHint}</span>
          </div>
        )}
      </Modal>
    </>
  );
}
