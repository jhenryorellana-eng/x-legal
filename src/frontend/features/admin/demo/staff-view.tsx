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
 * StaffView — "Vista staff": the team-panel view of the scenario's case. A case
 * header + subtabs (Resumen · Documentos · Automatización · Generaciones ·
 * Expediente) over a relative panel that hosts the AI micro-experience overlays
 * (translate / official-form assembly / AI generation / expediente) and their
 * success screens. All scenario copy comes from the fixture; i18n only carries
 * chrome. Owns its own local flow; the parent remounts it (via `key`) to reset.
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

  // The "Automatización" tab exists only for scenarios that generate an official
  // form (`staff.automation`). Reforzar Asilo omits it: the I-589 was filed by
  // the client, so there is nothing to generate — the tab derives from the data.
  const tabs: { id: TabId; label: string; icon: IconName }[] = [
    { id: "resumen", label: t("tabResumen"), icon: "grid" },
    { id: "documentos", label: t("tabDocumentos"), icon: "doc" },
    ...(staff.automation
      ? [{ id: "automatizacion" as const, label: t("tabAutomatizacion"), icon: "form" as IconName }]
      : []),
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
        {tab === "automatizacion" && staff.automation && (
          <AutomatizacionTab scenario={scenario} flow={flow} pdfBlobUrl={assetBlobs[staff.automation.slotKey] ?? null} />
        )}
        {tab === "generaciones" && (
          <GeneracionesTab scenario={scenario} flow={flow} pdfBlobUrl={assetBlobs[staff.generation.slotKey] ?? null} />
        )}
        {tab === "expediente" && (
          <ExpedienteTab scenario={scenario} flow={flow} pdfBlobUrl={assetBlobs[staff.expediente.slotKey] ?? null} />
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
  } else if (loader?.kind === "automation" && staff.automation) {
    content = (
      <AssemblyAnimation
        title={staff.automation.loaderTitle}
        officialTitle={staff.automation.officialTitle}
        fields={staff.automation.fields}
        steps={staff.automation.steps}
        naLabel={staff.automation.filledChipLabel}
        leftPanelLabel={staff.automation.sourcePanelLabel}
        rightPanelLabel={staff.automation.targetPanelLabel}
        onComplete={flow.actions.loadedAutomation}
      />
    );
  } else if (loader?.kind === "generation") {
    content = (
      <SequenceLoader
        title={staff.generation.loaderTitle}
        steps={staff.generation.steps}
        accent="var(--gold-deep)"
        visual={<AiCoreVisual counters={staff.generation.loaderCounters} />}
        onComplete={flow.actions.loadedGeneration}
      />
    );
  } else if (loader?.kind === "expediente") {
    content = (
      <SequenceLoader
        title={staff.expediente.loaderTitle}
        steps={staff.expediente.steps}
        accent="var(--accent)"
        visual={<RobotBuilder />}
        onComplete={flow.actions.loadedExpediente}
      />
    );
  } else if (splash) {
    // Resolve lazily so we never dereference an absent micro-experience fixture
    // (e.g. `staff.automation` for scenarios that omit the Automatización tab).
    const c =
      splash === "generation"
        ? staff.generation.splash
        : splash === "expediente"
          ? staff.expediente.splash
          : splash === "automation" && staff.automation
            ? staff.automation.splash
            : { title: t("splashTranslateTitle"), body: t("splashTranslateBody") };
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
