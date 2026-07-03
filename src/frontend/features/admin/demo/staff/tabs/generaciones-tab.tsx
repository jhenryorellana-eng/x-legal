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
 * GeneracionesTab — the credible-fear memo (disruptive AI-core loader on
 * Generar). With a real PDF uploaded ("⋯ → Data" on the demo card) the done
 * state opens the full-screen PdfReader; without one it keeps the HTML memo
 * preview (simulation fallback).
 */
export function GeneracionesTab({
  scenario,
  flow,
  pdfBlobUrl,
}: {
  scenario: DemoScenario;
  flow: StaffFlow;
  pdfBlobUrl: string | null;
}) {
  const t = useTranslations("staff.demo");
  const memo = scenario.staff.memo;
  const status = flow.state.memo;
  const done = status === "done";
  const [reader, setReader] = React.useState(false);

  // Same contract as ExpedienteTab: reveal the real PDF on done (the splash at
  // z 9999 covers the reader at z 9998 until dismissed).
  React.useEffect(() => {
    if (done && pdfBlobUrl) setReader(true);
  }, [done, pdfBlobUrl]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <TabIntro icon="scale" text={t("genIntro")} />

      <GenerationRow
        icon="scale"
        tone="var(--gold-deep)"
        title={t("memoTitle")}
        caption={t("memoCaption")}
        status={status}
        generateLabel={t("generate")}
        generatingLabel={t("generating")}
        doneLabel={t("generated")}
        doneMeta={t("memoDoneMeta", { words: memo.wordCount.toLocaleString("en-US"), pages: memo.pageCount })}
        viewLabel={done && pdfBlobUrl ? t("viewPdf") : undefined}
        onView={pdfBlobUrl ? () => setReader(true) : undefined}
        onGenerate={flow.actions.startMemo}
      />

      {done && pdfBlobUrl && (
        <PdfReader
          open={reader}
          onClose={() => setReader(false)}
          blobUrl={pdfBlobUrl}
          title={t("memoTitle")}
          downloadName="memorandum.pdf"
          labels={{
            close: t("expClose"),
            print: t("print"),
            download: t("pdfDownload"),
            toolbarNote: t("splashMemoTitle"),
          }}
        />
      )}

      {done && !pdfBlobUrl && (
        <div
          className="staff-rise"
          style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 18, padding: 18, boxShadow: "var(--shadow-soft)" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
            <Icon name="scale" size={18} color="var(--gold-deep)" />
            <h3 className="t-title" style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "var(--navy)", flex: 1 }}>
              {t("memoPreviewTitle")}
            </h3>
            <Chip tone="green" dot>
              {t("generated")}
            </Chip>
          </div>

          <p style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6, margin: "0 0 14px", fontWeight: 500 }}>
            {t("memoSnippet")}
          </p>

          <div style={{ background: "var(--gold-soft)", borderRadius: 12, padding: "12px 16px", marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "var(--gold-deep)", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {t("memoIndexTitle")}
            </div>
            <ol style={{ margin: "8px 0 0", paddingLeft: 20, color: "var(--navy)", fontSize: 13, lineHeight: 1.75 }}>
              {memo.sections.map((s) => (
                <li key={s} style={{ fontWeight: 600 }}>{s}</li>
              ))}
            </ol>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Stat n={memo.wordCount.toLocaleString("en-US")} label={t("memoStatWords")} />
            <Stat n={String(memo.pageCount)} label={t("memoStatPages")} />
            <Stat n={String(memo.exhibits)} label={t("memoStatExhibits")} />
            <Stat n={String(memo.sources)} label={t("memoStatSources")} />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div style={{ flex: 1, minWidth: 92, background: "var(--blue-soft)", borderRadius: 12, padding: "12px 8px", textAlign: "center" }}>
      <div className="t-black" style={{ fontSize: 20, color: "var(--navy)", lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: 10.5, color: "var(--ink-2)", fontWeight: 700, marginTop: 4 }}>{label}</div>
    </div>
  );
}
