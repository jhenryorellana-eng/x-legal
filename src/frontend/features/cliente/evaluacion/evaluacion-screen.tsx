"use client";

/**
 * EvaluacionScreen — `/caso/[caseId]/evaluacion` (external evaluation tool v1: Juez).
 *
 * Client component. The client generates their evaluation inside the embedded Juez
 * tool (iframe); x-legal is the source of truth for attempts and the delivered PDF.
 * States:
 *   - pending / in_progress / failed-with-attempts → instructions + attempts + iframe
 *     (polls every ~10s while a run is in progress; a manual "Actualizar" button too).
 *   - delivered → result card (headline / nivel / score) + "Ver mi evaluación (PDF)".
 *   - failed with no attempts left → error message + "contacta a tu asesor".
 *
 * RNF-036: the PDF opens through getBridge().share.openExternal (no window.open in features/**).
 */

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/frontend/components/brand/icon";
import { Card } from "@/frontend/components/brand/card";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { getBridge } from "@/frontend/platform-bridge";

const POLL_MS = 10_000;

export type ClientEvalStatus = "pending" | "in_progress" | "delivered" | "failed";

export interface ClientEvaluationVM {
  status: ClientEvalStatus;
  attemptsAllowed: number;
  attemptsUsed: number;
  /** `${base_url}/xlegal?t=${access_token}` — the client's own session credential. */
  iframeUrl: string;
  instructions: { es?: string; en?: string };
  pdfAvailable: boolean;
  reportMeta: { score?: number | null; nivel?: string | null; headline?: string | null; lastError?: string | null };
  deliveredAt: string | null;
}

export type ClientEvalResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

export interface EvaluacionLabels {
  back: string;
  title: string;
  intro: string;
  /** "{remaining}" placeholder. */
  attemptsRemaining: string;
  uploadNotice: string;
  refresh: string;
  generatingTitle: string;
  generatingBody: string;
  readyTitle: string;
  viewPdf: string;
  nivelLabel: string;
  scoreLabel: string;
  errorTitle: string;
  errorBody: string;
  noAttemptsTitle: string;
  noAttemptsBody: string;
}

export interface EvaluacionScreenProps {
  caseId: string;
  locale: "es" | "en";
  vm: ClientEvaluationVM;
  labels: EvaluacionLabels;
  onRefresh: (caseId: string) => Promise<ClientEvalResult<ClientEvaluationVM>>;
  onGetPdfUrl: (caseId: string) => Promise<ClientEvalResult<{ url: string }>>;
}

const SCREEN_BG =
  "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)";

export function EvaluacionScreen({ caseId, locale, vm: initialVm, labels, onRefresh, onGetPdfUrl }: EvaluacionScreenProps) {
  const [vm, setVm] = React.useState<ClientEvaluationVM>(initialVm);
  const [refreshing, setRefreshing] = React.useState(false);
  const [busyPdf, setBusyPdf] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await onRefresh(caseId);
      if (r.success) setVm(r.data);
    } finally {
      setRefreshing(false);
    }
  }, [caseId, onRefresh]);

  // Poll while a run is in progress — the delivered PDF arrives via the Juez
  // webhook, so the screen catches up without the client reloading.
  React.useEffect(() => {
    if (vm.status !== "in_progress") return;
    const id = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [vm.status, refresh]);

  const openPdf = React.useCallback(async () => {
    setBusyPdf(true);
    try {
      const r = await onGetPdfUrl(caseId);
      if (r.success && r.data.url) getBridge().share.openExternal(r.data.url);
    } finally {
      setBusyPdf(false);
    }
  }, [caseId, onGetPdfUrl]);

  const instructions =
    (locale === "en" ? vm.instructions.en ?? vm.instructions.es : vm.instructions.es ?? vm.instructions.en) ?? "";
  const remaining = Math.max(0, vm.attemptsAllowed - vm.attemptsUsed);

  const back = (
    <Link
      href={`/caso/${caseId}/camino`}
      className="mp-tap"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: "var(--accent)",
        fontFamily: "var(--font-title)",
        fontWeight: 800,
        fontSize: 15,
        textDecoration: "none",
        marginBottom: 14,
      }}
    >
      <Icon name="chevL" size={18} color="var(--accent)" /> {labels.back}
    </Link>
  );

  const heading = (
    <h1 className="t-black" style={{ margin: "0 0 6px", fontSize: 27, color: "var(--navy)" }}>
      {labels.title}
    </h1>
  );

  // ---- Delivered ---------------------------------------------------------
  if (vm.status === "delivered") {
    const meta = vm.reportMeta;
    return (
      <div style={{ minHeight: "100dvh", padding: "54px 20px var(--screen-pb)", background: SCREEN_BG }}>
        {back}
        {heading}
        <Card glow="var(--green)" style={{ marginTop: 12, padding: 22 }}>
          <div
            aria-hidden="true"
            style={{
              width: 64,
              height: 64,
              borderRadius: 999,
              margin: "0 auto 16px",
              background: "var(--green-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="trophy" size={34} color="var(--green)" />
          </div>
          <h2 className="t-title" style={{ margin: "0 0 8px", fontSize: 20, color: "var(--navy)", fontWeight: 800, textAlign: "center" }}>
            {meta.headline ?? labels.readyTitle}
          </h2>
          {(meta.nivel != null || meta.score != null) && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", margin: "0 0 6px" }}>
              {meta.nivel != null && <Pill tone="green">{`${labels.nivelLabel}: ${meta.nivel}`}</Pill>}
              {meta.score != null && <Pill tone="blue">{`${labels.scoreLabel}: ${meta.score}`}</Pill>}
            </div>
          )}
          {vm.pdfAvailable && (
            <div style={{ marginTop: 18 }}>
              <GradientBtn icon="doc" disabled={busyPdf} onClick={() => void openPdf()}>
                {labels.viewPdf}
              </GradientBtn>
            </div>
          )}
        </Card>
      </div>
    );
  }

  // ---- Failed, no attempts left -----------------------------------------
  if (vm.status === "failed" && remaining <= 0) {
    return (
      <div style={{ minHeight: "100dvh", padding: "54px 20px var(--screen-pb)", background: SCREEN_BG }}>
        {back}
        {heading}
        <Card style={{ marginTop: 12, padding: 22, textAlign: "center" }}>
          <div
            aria-hidden="true"
            style={{
              width: 60,
              height: 60,
              borderRadius: 999,
              margin: "0 auto 14px",
              background: "var(--gold-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="info" size={30} color="var(--gold-deep)" />
          </div>
          <h2 className="t-title" style={{ margin: "0 0 8px", fontSize: 20, color: "var(--navy)", fontWeight: 800 }}>
            {labels.noAttemptsTitle}
          </h2>
          <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 15.5, lineHeight: 1.5, fontWeight: 500 }}>
            {labels.noAttemptsBody}
          </p>
        </Card>
      </div>
    );
  }

  // ---- Active (pending / in_progress / failed-with-attempts) ------------
  const generating = vm.status === "in_progress";
  return (
    <div style={{ minHeight: "100dvh", padding: "54px 20px var(--screen-pb)", background: SCREEN_BG }}>
      {back}
      {heading}
      <p style={{ margin: "0 0 14px", color: "var(--ink-2)", fontSize: 16, fontWeight: 500, lineHeight: 1.45 }}>
        {labels.intro}
      </p>

      {/* Attempts + upload notice */}
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: instructions ? 10 : 0 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "var(--blue-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="bolt" size={20} color="var(--accent)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t-title" style={{ fontSize: 15.5, color: "var(--navy)", fontWeight: 700 }}>
              {labels.attemptsRemaining.replace("{remaining}", String(remaining))}
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 600, marginTop: 2 }}>
              {labels.uploadNotice}
            </div>
          </div>
        </div>
        {instructions && (
          <p style={{ margin: "0", fontSize: 13.5, color: "var(--ink-2)", fontWeight: 500, lineHeight: 1.5, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            {instructions}
          </p>
        )}
      </Card>

      {/* Generating banner + refresh */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        {generating ? (
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span
              aria-hidden="true"
              style={{
                width: 16,
                height: 16,
                borderRadius: 999,
                border: "2px solid color-mix(in srgb, var(--accent) 30%, transparent)",
                borderTopColor: "var(--accent)",
                animation: "spin 0.8s linear infinite",
                display: "inline-block",
              }}
            />
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>{labels.generatingTitle}</span>
          </div>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="mp-tap"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "var(--card)",
            border: "1px solid var(--line)",
            borderRadius: 999,
            padding: "7px 14px",
            fontSize: 13.5,
            fontWeight: 800,
            color: "var(--accent)",
            cursor: refreshing ? "default" : "pointer",
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          <Icon name="sparkle" size={15} color="var(--accent)" />
          {labels.refresh}
        </button>
      </div>
      {generating && (
        <p style={{ margin: "-4px 0 12px", fontSize: 13.5, color: "var(--ink-2)", fontWeight: 500 }}>
          {labels.generatingBody}
        </p>
      )}

      {/* Embedded Juez tool */}
      <iframe
        src={vm.iframeUrl}
        title={labels.title}
        allow="clipboard-write"
        style={{
          width: "100%",
          height: "calc(100dvh - 300px)",
          minHeight: 460,
          border: "1px solid var(--line)",
          borderRadius: 16,
          background: "#fff",
          boxShadow: "var(--shadow-soft)",
        }}
      />
    </div>
  );
}

/** Small rounded label pill (result meta). */
function Pill({ tone, children }: { tone: "green" | "blue"; children: React.ReactNode }) {
  const bg = tone === "green" ? "var(--green-soft)" : "var(--blue-soft)";
  const fg = tone === "green" ? "var(--green)" : "var(--accent)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: bg,
        color: fg,
        borderRadius: 999,
        padding: "5px 12px",
        fontSize: 13,
        fontWeight: 800,
      }}
    >
      {children}
    </span>
  );
}
