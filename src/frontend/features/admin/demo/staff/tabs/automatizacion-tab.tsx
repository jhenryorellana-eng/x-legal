"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Chip, Icon } from "@/frontend/components/brand";
import { GenerationRow } from "../components/generation-row";
import { TabIntro } from "../components/tab-intro";
import { PdfReader } from "../components/pdf-reader";
import type { DemoScenario } from "../../scenarios/types";
import type { StaffFlow } from "../use-staff-flow";

/**
 * AutomatizacionTab — the official-form AcroForm automation (assembly animation
 * on Generar), driven entirely by `scenario.staff.automation`. With a real PDF
 * uploaded ("⋯ → Data" on the demo card) the done state opens the full-screen
 * PdfReader; without one it keeps the HTML field preview (simulation fallback).
 */
export function AutomatizacionTab({
  scenario,
  flow,
  pdfBlobUrl,
}: {
  scenario: DemoScenario;
  flow: StaffFlow;
  pdfBlobUrl: string | null;
}) {
  const t = useTranslations("staff.demo");
  const auto = scenario.staff.automation;
  const status = flow.state.automation;
  const done = status === "done";
  const [reader, setReader] = React.useState(false);

  // Reveal the real PDF as soon as the assembly finishes (and on every return
  // to a done tab) — same contract as ExpedienteTab. The splash (z 9999) covers
  // the reader (z 9998); dismissing it reveals the document.
  React.useEffect(() => {
    if (done && pdfBlobUrl) setReader(true);
  }, [done, pdfBlobUrl]);

  // Rendered only when the scenario has an automation fixture (see StaffView);
  // this guard (after all hooks) keeps the component total for scenarios that
  // omit it, without breaking the Rules of Hooks.
  if (!auto) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <TabIntro icon="bolt" text={auto.intro} />

      <GenerationRow
        icon="form"
        tone="var(--accent)"
        title={auto.title}
        caption={auto.officialTitle}
        status={status}
        generateLabel={t("generate")}
        generatingLabel={t("generating")}
        doneLabel={t("generated")}
        doneMeta={auto.doneMeta}
        viewLabel={done && pdfBlobUrl ? t("viewPdf") : undefined}
        onView={pdfBlobUrl ? () => setReader(true) : undefined}
        onGenerate={flow.actions.startAutomation}
      />

      {done && pdfBlobUrl && (
        <PdfReader
          open={reader}
          onClose={() => setReader(false)}
          blobUrl={pdfBlobUrl}
          title={auto.title}
          downloadName={auto.downloadName}
          labels={{
            close: t("expClose"),
            print: t("print"),
            download: t("pdfDownload"),
            toolbarNote: auto.splash.title,
          }}
        />
      )}

      {done && !pdfBlobUrl && (
        <div
          className="staff-rise"
          style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 18, padding: 18, boxShadow: "var(--shadow-soft)" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
            <Icon name="shield" size={18} color="var(--gold-deep)" />
            <h3 className="t-title" style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "var(--navy)", flex: 1 }}>
              {auto.previewTitle}
            </h3>
            <Chip tone="gold" dot>
              {t("autoPdfChip")}
            </Chip>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px 20px" }}>
            {auto.fields.map((f) => {
              const na = f.value == null;
              return (
                <div key={f.fieldName} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
                  <div style={{ fontSize: 10.5, color: "var(--ink-3)", fontWeight: 700 }}>{f.official}</div>
                  <div style={{ fontSize: 13, color: na ? "var(--gold-deep)" : "var(--navy)", fontWeight: 800, marginTop: 2 }}>
                    {na ? "N/A" : f.value}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 14, fontSize: 12, color: "var(--ink-3)", fontWeight: 600, fontStyle: "italic" }}>
            {auto.fillNote}
          </div>
        </div>
      )}
    </div>
  );
}
