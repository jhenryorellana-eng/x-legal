"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { GhostBtn, GradientBtn, IconTile } from "@/frontend/components/brand";
import { GenerationRow } from "../components/generation-row";
import { TabIntro } from "../components/tab-intro";
import { ExpedienteDocument, type ExpedienteDocLabels } from "../components/expediente-document";
import { PdfReader } from "../components/pdf-reader";
import type { DemoScenario } from "../../scenarios/types";
import type { StaffFlow } from "../use-staff-flow";

/**
 * ExpedienteTab — compiles the legal file (robot loader) and reveals it in a
 * full-screen, printable reader. With a real PDF uploaded ("⋯ → Data" on the
 * demo card) the reader is `PdfReader`; without one it falls back to the HTML
 * simulation (`ExpedienteDocument`, portaled to <body>).
 */
export function ExpedienteTab({
  scenario,
  flow,
  pdfBlobUrl,
}: {
  scenario: DemoScenario;
  flow: StaffFlow;
  pdfBlobUrl: string | null;
}) {
  const t = useTranslations("staff.demo");
  const status = flow.state.expediente;
  const exp = scenario.staff.expediente;
  // The compiled file spans every phase; its representative "official form" and
  // "generation" sample pages use the last phase (the culminating artifact).
  const repPhase = scenario.phases[scenario.phases.length - 1];
  const [reader, setReader] = React.useState(false);

  // Reveal the reader as soon as the expediente is compiled (and on every return
  // to a done tab). Closing it keeps the tab summary until it changes again.
  React.useEffect(() => {
    if (status === "done") setReader(true);
  }, [status]);

  const regenerate = React.useCallback(() => {
    setReader(false);
    flow.actions.startExpediente();
  }, [flow.actions]);

  if (status === "done") {
    const labels: ExpedienteDocLabels = {
      print: t("print"),
      regenerate: t("regenerate"),
      toolbarNote: exp.toolbarNote,
      close: t("expClose"),
      org: t("expOrg"),
      coverKicker: t("expCoverKicker"),
      confidential: t("expConfidential"),
      tocTitle: t("expTocTitle"),
      repNote: t("expRepNote"),
      pageWord: t("pageWord"),
      ofWord: t("ofWord"),
    };

    return (
      <>
        <div
          className="staff-rise"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            background: "var(--card)",
            border: "1px solid var(--line)",
            borderRadius: 18,
            padding: 16,
            boxShadow: "var(--shadow-soft)",
            flexWrap: "wrap",
          }}
        >
          <IconTile name="briefcase" color="var(--green)" size={48} radius={14} iconSize={24} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 15.5, color: "var(--navy)", fontWeight: 800 }}>{t("expCompiledTitle")}</div>
            <div style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 600, marginTop: 2 }}>
              {t("expCompiledMeta", { pages: exp.totalPages })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
            <GhostBtn icon="play" size="md" full={false} onClick={regenerate}>
              {t("regenerate")}
            </GhostBtn>
            <GradientBtn icon="doc" size="sm" full={false} onClick={() => setReader(true)}>
              {t("expViewPrint")}
            </GradientBtn>
          </div>
        </div>

        {pdfBlobUrl ? (
          <PdfReader
            open={reader}
            onClose={() => setReader(false)}
            blobUrl={pdfBlobUrl}
            title={exp.title}
            downloadName={exp.downloadName}
            labels={{
              close: t("expClose"),
              print: t("print"),
              download: t("pdfDownload"),
              toolbarNote: exp.toolbarNote,
              regenerate: t("regenerate"),
            }}
            onRegenerate={regenerate}
          />
        ) : (
          <ExpedienteDocument
            open={reader}
            onClose={() => setReader(false)}
            staff={scenario.staff}
            automation={repPhase.automation}
            generation={repPhase.generation}
            labels={labels}
            onRegenerate={regenerate}
          />
        )}
      </>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <TabIntro icon="briefcase" text={exp.intro} />
      <GenerationRow
        icon="briefcase"
        tone="var(--gold-deep)"
        title={exp.title}
        caption={exp.caption}
        status={status}
        generateLabel={t("generate")}
        generatingLabel={t("generating")}
        doneLabel={t("generated")}
        onGenerate={flow.actions.startExpediente}
      />
    </div>
  );
}
