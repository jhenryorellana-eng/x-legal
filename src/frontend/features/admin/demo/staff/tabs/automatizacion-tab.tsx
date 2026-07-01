"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Chip, Icon } from "@/frontend/components/brand";
import { GenerationRow } from "../components/generation-row";
import { TabIntro } from "../components/tab-intro";
import type { DemoScenario } from "../../scenarios/types";
import type { StaffFlow } from "../use-staff-flow";

/** AutomatizacionTab — the I-589 AcroForm automation (assembly animation on Generar). */
export function AutomatizacionTab({ scenario, flow }: { scenario: DemoScenario; flow: StaffFlow }) {
  const t = useTranslations("staff.demo");
  const i589 = scenario.staff.i589;
  const status = flow.state.i589;
  const done = status === "done";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <TabIntro icon="bolt" text={t("autoIntro")} />

      <GenerationRow
        icon="form"
        tone="var(--accent)"
        title={t("i589Title")}
        caption={i589.officialTitle}
        status={status}
        generateLabel={t("generate")}
        generatingLabel={t("generating")}
        doneLabel={t("generated")}
        doneMeta={t("i589DoneMeta", { pages: i589.pageCount, na: i589.naCount })}
        onGenerate={flow.actions.startI589}
      />

      {done && (
        <div
          className="staff-rise"
          style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 18, padding: 18, boxShadow: "var(--shadow-soft)" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
            <Icon name="shield" size={18} color="var(--gold-deep)" />
            <h3 className="t-title" style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "var(--navy)", flex: 1 }}>
              {t("i589PreviewTitle")}
            </h3>
            <Chip tone="gold" dot>
              {t("i589PdfChip")}
            </Chip>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px 20px" }}>
            {i589.fields.map((f) => {
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
            {t("i589NaNote", { n: i589.naCount })}
          </div>
        </div>
      )}
    </div>
  );
}
