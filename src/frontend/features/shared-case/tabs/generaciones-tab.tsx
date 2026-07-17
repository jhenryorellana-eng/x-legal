"use client";

/**
 * Generaciones (Henry) / Cartas (Vanessa) tab — the case's AI LETTERS (ai_letter
 * form definitions of the phase) with their current generation run. Each letter
 * gets 3 staff actions (Ola 2, Henry 2026-07-08): **Ver** (open the generated
 * letter PDF, when a run exists), **Generar/Regenerar** (a new version — async),
 * and **Revisión** (side-by-side: generated letter ↔ editable companion-questionnaire
 * answers). Listing letters (not runs) means a not-yet-generated letter still shows,
 * so Diana can edit answers and generate the first version. Regenerating reflects the
 * edited answers (the resolved_inputs fix).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { StatusPill, type StatusKind } from "@/frontend/components/brand/status-pill";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import { toast } from "@/frontend/components/desktop";
import { getBridge } from "@/frontend/platform-bridge";
import type { CaseWorkspaceVM, CaseDetailActions, FormVM, GenerationVM } from "../types";
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

/** Poll cadence for the async generation (precedent: pre-mortem pollUntilDone). */
const POLL_MS = 4000;
/** Safety cap ≈ 16 min — past the job's own zombie cutoff, so it always resolves. */
const MAX_POLLS = 240;

export function GeneracionesTab({
  vm,
  actions,
  strings,
  locale,
  title,
  onOpenPreMortem,
  preMortemEnabled,
}: {
  vm: CaseWorkspaceVM;
  actions: CaseDetailActions;
  strings: CasosStrings;
  locale: "es" | "en";
  title: string;
  /** Opens the Pre-Mortem tab focused on this letter (deep-link). */
  onOpenPreMortem?: (key: string) => void;
  preMortemEnabled?: boolean;
}) {
  const t = strings.detail;
  const statusLabels = t.genStatus as Record<string, string>;
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  const caseId = vm.header.caseId;
  const base =
    vm.role === "paralegal"
      ? `/legal/caso/${caseId}`
      : vm.isAdmin
        ? `/admin/casos/${caseId}`
        : `/ventas/clientes/${caseId}`;

  // The case's AI letters (from the client-forms set), with their current run.
  const letters = vm.forms.filter((f) => f.kind === "ai_letter");
  const currentRunFor = (f: FormVM): GenerationVM | undefined =>
    vm.generations.find(
      (g) => g.formDefinitionId === f.id && g.isCurrent && (f.partyId ? g.partyId === f.partyId : g.partyId === null),
    );
  // isCurrent is only set on completed runs, so a queued/running run needs its own
  // lookup — otherwise a first generation reads "Sin generar" while in flight.
  const activeRunFor = (f: FormVM): GenerationVM | undefined =>
    vm.generations.find(
      (g) =>
        g.formDefinitionId === f.id &&
        (g.status === "queued" || g.status === "running") &&
        (f.partyId ? g.partyId === f.partyId : g.partyId === null),
    );

  const pollRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const startedForRef = React.useRef<Set<string>>(new Set());
  // Guards the in-flight tick that resolves AFTER unmount (the await can land
  // post-cleanup and would re-schedule a leaked timeout).
  const disposedRef = React.useRef(false);
  // Bridges the gap between "enqueue returned" and the next server render: the
  // VM only reflects the queued run after router.refresh() lands, and without a
  // local override the button re-enables and the pill reverts to idle for that
  // window. Keyed per letter (formId-partyId) so other letters stay unaffected.
  const [pendingByKey, setPendingByKey] = React.useState<Record<string, string>>({});

  const pollUntilDone = React.useCallback(
    (runId: string, clearKey?: string) => {
      if (typeof actions.getRunStatus !== "function") return;
      const clearPending = () => {
        if (clearKey) {
          setPendingByKey((m) => {
            if (!(clearKey in m)) return m;
            const next = { ...m };
            delete next[clearKey];
            return next;
          });
        }
      };
      let polls = 0;
      const tick = async () => {
        if (disposedRef.current) {
          pollRef.current.delete(runId);
          return;
        }
        // Pause while the tab is hidden — no point polling a page nobody sees.
        if (typeof document !== "undefined" && document.hidden) {
          pollRef.current.set(runId, setTimeout(tick, POLL_MS));
          return;
        }
        polls += 1;
        const res = await actions.getRunStatus!({ runId }).catch(() => null);
        // The await may resolve after unmount — never toast or reschedule then.
        if (disposedRef.current) {
          pollRef.current.delete(runId);
          return;
        }
        const status = res && res.ok ? res.status : undefined;
        if (status === "completed" || status === "failed" || status === "cancelled") {
          pollRef.current.delete(runId);
          clearPending();
          if (status === "completed") toast.success(t.toastLetterReady);
          else toast.error(t.toastLetterFailed);
          // Single refresh at the terminal transition (not per tick) — rebuilds
          // the VM server-side with the new current run.
          router.refresh();
          return;
        }
        if (polls >= MAX_POLLS) {
          pollRef.current.delete(runId);
          clearPending();
          // Clear the started guard so a later render RESUMES a still-in-flight
          // run (self-chaining generations can legitimately outlive one cap
          // window); the refresh also runs the server-side stale-run sweep.
          startedForRef.current.delete(runId);
          router.refresh();
          return;
        }
        pollRef.current.set(runId, setTimeout(tick, POLL_MS));
      };
      pollRef.current.set(runId, setTimeout(tick, POLL_MS));
    },
    [actions, router, t],
  );

  // Resume polling for any in-flight run delivered by the VM (page reload).
  React.useEffect(() => {
    for (const f of letters) {
      const active = activeRunFor(f);
      if (active && !startedForRef.current.has(active.id)) {
        startedForRef.current.add(active.id);
        pollUntilDone(active.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vm.generations, pollUntilDone]);

  // Cleanup on unmount.
  React.useEffect(
    () => () => {
      disposedRef.current = true;
      for (const id of pollRef.current.values()) clearTimeout(id);
      pollRef.current.clear();
    },
    [],
  );

  function reviewHref(f: FormVM): string {
    const q = new URLSearchParams();
    if (f.partyId) q.set("party", f.partyId);
    if (f.partyName) q.set("name", f.partyName);
    const qs = q.toString();
    return `${base}/generacion/${f.id}${qs ? `?${qs}` : ""}`;
  }

  async function viewLetter(runId: string, key: string) {
    if (!actions.getGenerationOutputUrl) return;
    setBusy(key);
    const r = await actions.getGenerationOutputUrl({ runId });
    setBusy(null);
    if (r.ok && r.url) getBridge().share.openExternal(r.url);
    else toast.error(t.toastLetterError);
  }

  async function regenerate(f: FormVM, key: string) {
    if (!actions.startLetterGeneration) return;
    setBusy(key);
    const r = await actions.startLetterGeneration({ caseId, formDefinitionId: f.id, partyId: f.partyId });
    setBusy(null);
    if (r.ok) {
      toast.success(t.toastLetterQueued);
      // Local override + refresh: the VM only reflects the queued run after the
      // next server render — without both, the button re-enables and the pill
      // reads idle for the whole generation window.
      if (r.runId) {
        setPendingByKey((m) => ({ ...m, [key]: r.runId! }));
        if (!startedForRef.current.has(r.runId)) {
          startedForRef.current.add(r.runId);
          pollUntilDone(r.runId, key);
        }
      }
      router.refresh();
    } else toast.error(r.error?.code === "AI_RUN_DUPLICATE" ? t.toastLetterDuplicate : t.toastLetterError);
  }

  return (
    <Card>
      <h2 style={{ margin: 0, fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 18, color: "var(--ink)" }}>
        {title}
      </h2>
      <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{t.genSub}</p>

      {letters.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState title={t.genEmpty} mood="calma" lexSize={104} />
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          {letters.map((f: FormVM) => {
            const key = `${f.id}-${f.partyId ?? ""}`;
            const run = currentRunFor(f);
            const active = activeRunFor(f);
            // Just-enqueued run not yet in the VM (pre-refresh window).
            const pendingLocal = !active && pendingByKey[key] ? true : false;
            const isBusy = busy === key;
            // The pill reflects the in-flight run when there is one; the completed
            // version info below stays visible alongside it.
            const shown = active ?? run;
            const statusText = active
              ? (statusLabels[active.status] ?? active.status)
              : pendingLocal
                ? (statusLabels["queued"] ?? "queued")
                : shown
                  ? (statusLabels[shown.status] ?? shown.status)
                  : t.genNotStarted;
            const pill = active
              ? (GEN_PILL[active.status] ?? "pendiente")
              : pendingLocal
                ? (GEN_PILL["queued"] ?? "pendiente")
                : shown
                  ? (GEN_PILL[shown.status] ?? "pendiente")
                  : ("pendiente" as StatusKind);
            return (
              <div key={key} className="letter-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>{f.label}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>
                    {run ? interp(t.genVersion, { n: String(run.version) }) : t.genNotStarted}
                    {f.partyName ? ` · ${f.partyName}` : ""}
                    {run?.costUsd != null ? ` · ${fmtUsd(run.costUsd, locale)}` : ""}
                  </p>
                </div>
                {run?.isCurrent && <Chip tone="blue">{t.genCurrent}</Chip>}
                <StatusPill kind={pill}>{statusText}</StatusPill>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {/* Ver — the generated letter PDF (when a run has produced one). */}
                  {run?.outputAvailable && actions.getGenerationOutputUrl && (
                    <GhostBtn size="md" full={false} icon="doc" disabled={isBusy} onClick={() => viewLetter(run.id, key)}>
                      {t.viewForm}
                    </GhostBtn>
                  )}
                  {/* Generar / Regenerar — a new version (async). Blocked while a run is in flight. */}
                  {actions.startLetterGeneration && (
                    <GhostBtn size="md" full={false} icon="sparkle" disabled={isBusy || !!active || pendingLocal} onClick={() => regenerate(f, key)}>
                      {isBusy || active || pendingLocal ? t.generatingForm : run ? t.regenerateLetter : t.generateLetter}
                    </GhostBtn>
                  )}
                  {/* Pre-Mortem — validate this generated letter's quality. */}
                  {preMortemEnabled && onOpenPreMortem && run?.outputAvailable && (
                    <GhostBtn size="md" full={false} icon="shield" onClick={() => onOpenPreMortem(`ai_letter:${f.id}:${f.partyId ?? ""}`)}>
                      {t.preMortem.title}
                    </GhostBtn>
                  )}
                  {/* Revisión — side-by-side letter ↔ editable questionnaire answers. */}
                  <GradientBtn size="md" full={false} icon="chevR" onClick={() => router.push(reviewHref(f))}>
                    {t.openReview}
                  </GradientBtn>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
