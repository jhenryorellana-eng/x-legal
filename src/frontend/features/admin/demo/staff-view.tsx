"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Chip, Icon, IconTile, type IconName } from "@/frontend/components/brand";
import { StaffStyles } from "./staff/staff-styles";
import { useStaffFlow } from "./staff/use-staff-flow";
import { serviceColorToken } from "./scenarios";
import type { DemoScenario } from "./scenarios/types";
import type { DemoService } from "./flow/client-flow";
import { ResumenTab } from "./staff/tabs/resumen-tab";
import { DocumentosTab } from "./staff/tabs/documentos-tab";
import { AutomatizacionTab } from "./staff/tabs/automatizacion-tab";
import { GeneracionesTab } from "./staff/tabs/generaciones-tab";
import { ExpedienteTab } from "./staff/tabs/expediente-tab";
import { SequenceLoader } from "./staff/components/sequence-loader";
import { AssemblyAnimation } from "./staff/components/assembly-animation";
import { ExtractionVisual } from "./staff/components/extraction-visual";
import { AiCoreVisual } from "./staff/components/ai-core-visual";
import { RobotBuilder } from "./staff/components/robot-builder";
import { SuccessOverlay } from "./components/success-overlay";

type TabId = "resumen" | "documentos" | "automatizacion" | "generaciones" | "expediente";

/**
 * StaffView — "Vista staff": the team-panel view of the Karelis case. A case
 * header + subtabs (Resumen · Documentos · Automatización · Generaciones ·
 * Expediente) over a relative panel that hosts the AI micro-experience overlays
 * (translate / I-589 assembly / memo / expediente) and their success screens.
 * Owns its own local flow; the parent remounts it (via `key`) to reset the demo.
 */
export function StaffView({
  scenario,
  service,
  assetBlobs,
}: {
  scenario: DemoScenario;
  service: DemoService;
  /** slot key → blob URL of the real PDF (preloaded by the parent). */
  assetBlobs: Record<string, string>;
}) {
  const t = useTranslations("staff.demo");
  const flow = useStaffFlow();
  const [tab, setTab] = React.useState<TabId>("resumen");
  const staff = scenario.staff;
  const color = serviceColorToken(service.colorKey);

  const tabs: { id: TabId; label: string; icon: IconName }[] = [
    { id: "resumen", label: t("tabResumen"), icon: "grid" },
    { id: "documentos", label: t("tabDocumentos"), icon: "doc" },
    { id: "automatizacion", label: t("tabAutomatizacion"), icon: "form" },
    { id: "generaciones", label: t("tabGeneraciones"), icon: "sparkle" },
    { id: "expediente", label: t("tabExpediente"), icon: "briefcase" },
  ];

  return (
    <div className="anim-fade-in-up">
      <StaffStyles />

      {/* Case header */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <IconTile name={service.icon} color={color} size={46} radius={13} iconSize={24} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-title" style={{ fontSize: 20, fontWeight: 800, color: "var(--navy)" }}>
            {staff.caseNumber}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 600, marginTop: 2 }}>
            {staff.clientLegalName} · {staff.planLabel}
          </div>
        </div>
        <Chip tone="green" dot>
          {staff.statusLabel}
        </Chip>
      </div>

      {/* Subtabs */}
      <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 20, overflowX: "auto" }}>
        {tabs.map((tb) => {
          const on = tab === tb.id;
          return (
            <button
              key={tb.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(tb.id)}
              style={{
                position: "relative",
                padding: "12px 15px",
                fontWeight: 800,
                fontSize: 14,
                whiteSpace: "nowrap",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: on ? "var(--accent)" : "var(--ink-2)",
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontFamily: "inherit",
              }}
            >
              <Icon name={tb.icon} size={17} color={on ? "var(--accent)" : "var(--ink-3)"} />
              {tb.label}
              {on && (
                <span
                  aria-hidden
                  style={{ position: "absolute", left: 10, right: 10, bottom: -1, height: 3, borderRadius: "3px 3px 0 0", background: "var(--accent)" }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Panel (natural height — the page scrolls, the tab box does not) */}
      <div>
        {tab === "resumen" && <ResumenTab staff={staff} />}
        {tab === "documentos" && <DocumentosTab scenario={scenario} flow={flow} />}
        {tab === "automatizacion" && (
          <AutomatizacionTab scenario={scenario} flow={flow} pdfBlobUrl={assetBlobs["i589"] ?? null} />
        )}
        {tab === "generaciones" && (
          <GeneracionesTab scenario={scenario} flow={flow} pdfBlobUrl={assetBlobs["memo"] ?? null} />
        )}
        {tab === "expediente" && (
          <ExpedienteTab scenario={scenario} flow={flow} pdfBlobUrl={assetBlobs["expediente"] ?? null} />
        )}
      </div>

      {/* Full-screen, fixed overlay layer (loaders + success splash) — always
          centered in the viewport so it never requires scrolling to be seen. */}
      <Overlays scenario={scenario} flow={flow} />
    </div>
  );
}

/**
 * The single overlay layer: whichever loader is running, else the success splash.
 * Rendered in a `position: fixed` full-viewport layer so the loading screen fills
 * the whole screen and stays centered regardless of page scroll. The inner
 * loader/splash components fill this layer via their own `inset: 0`.
 */
function Overlays({ scenario, flow }: { scenario: DemoScenario; flow: ReturnType<typeof useStaffFlow> }) {
  const t = useTranslations("staff.demo");
  const staff = scenario.staff;
  const { loader, splash } = flow.state;

  let content: React.ReactNode = null;

  if (loader?.kind === "translate") {
    const doc = scenario.documents.find((d) => d.id === loader.docId);
    content = (
      <SequenceLoader
        title={t("translateTitle")}
        steps={staff.translateSteps}
        accent="var(--accent)"
        visual={<ExtractionVisual extract={doc?.extract ?? []} fieldsTitle={t("extractedFields")} />}
        onComplete={flow.actions.loadedTranslate}
      />
    );
  } else if (loader?.kind === "i589") {
    content = (
      <AssemblyAnimation
        title={t("i589AssemblyTitle")}
        officialTitle={staff.i589.officialTitle}
        fields={staff.i589.fields}
        steps={staff.i589.steps}
        naLabel={t("i589NaChip", { n: staff.i589.naCount })}
        leftPanelLabel={t("i589LeftPanel")}
        rightPanelLabel={t("i589RightPanel")}
        onComplete={flow.actions.loadedI589}
      />
    );
  } else if (loader?.kind === "memo") {
    const counters = [
      { label: t("memoStatWords"), value: staff.memo.wordCount },
      { label: t("memoStatPages"), value: staff.memo.pageCount },
      { label: t("memoStatCites"), value: staff.memo.exhibits + staff.memo.sources },
    ];
    content = (
      <SequenceLoader
        title={t("memoLoaderTitle")}
        steps={staff.memo.steps}
        accent="var(--gold-deep)"
        visual={<AiCoreVisual counters={counters} />}
        onComplete={flow.actions.loadedMemo}
      />
    );
  } else if (loader?.kind === "expediente") {
    content = (
      <SequenceLoader
        title={t("expLoaderTitle")}
        steps={staff.expediente.steps}
        accent="var(--accent)"
        visual={<RobotBuilder />}
        onComplete={flow.actions.loadedExpediente}
      />
    );
  } else if (splash) {
    const copy: Record<NonNullable<typeof splash>, { title: string; body: string }> = {
      translate: { title: t("splashTranslateTitle"), body: t("splashTranslateBody") },
      i589: { title: t("splashI589Title"), body: t("splashI589Body") },
      memo: { title: t("splashMemoTitle"), body: t("splashMemoBody") },
      expediente: { title: t("splashExpTitle"), body: t("splashExpBody") },
    };
    const c = copy[splash];
    content = (
      <SuccessOverlay
        title={c.title}
        body={c.body}
        continueLabel={t("continue")}
        onContinue={flow.actions.dismissSplash}
      />
    );
  }

  if (!content || typeof document === "undefined") return null;

  // Portal to <body> so the fixed layer truly covers the whole screen: the staff
  // shell wraps content in a transformed ancestor, which would otherwise clip a
  // `position: fixed` element to the content column. Brand tokens live on
  // <html data-theme> and inherit down to the portaled node.
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 9999 }}>{content}</div>,
    document.body,
  );
}
