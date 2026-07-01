"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Chip, GradientBtn, IconTile, StatusPill } from "@/frontend/components/brand";
import { TabIntro } from "../components/tab-intro";
import type { DemoDocItem, DemoScenario } from "../../scenarios/types";
import type { GenStatus, StaffFlow } from "../use-staff-flow";

/**
 * DocumentosTab — the same documents the client uploaded, shown to staff as
 * approved rows with a "Traducir" action that runs the AI extraction/translation
 * micro-experience. The loading + success overlays live at the staff-view level.
 */
export function DocumentosTab({ scenario, flow }: { scenario: DemoScenario; flow: StaffFlow }) {
  const t = useTranslations("staff.demo");
  const docs = scenario.documents;

  const groups = React.useMemo(() => {
    const map = new Map<string, DemoDocItem[]>();
    for (const d of docs) {
      const arr = map.get(d.category) ?? [];
      arr.push(d);
      map.set(d.category, arr);
    }
    return [...map.entries()];
  }, [docs]);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <TabIntro icon="sparkle" text={t("docsIntro")} />
      </div>

      {groups.map(([category, items]) => (
        <div key={category} style={{ marginBottom: 16 }}>
          <div className="t-title" style={{ fontSize: 14, fontWeight: 800, color: "var(--navy)", margin: "0 2px 8px" }}>
            {category}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((d) => (
              <DocRow
                key={d.id}
                doc={d}
                status={flow.state.translations[d.id] ?? "idle"}
                approvedLabel={t("docApproved")}
                translateLabel={t("translate")}
                translatedLabel={t("translated")}
                onTranslate={() => flow.actions.startTranslate(d.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DocRow({
  doc,
  status,
  approvedLabel,
  translateLabel,
  translatedLabel,
  onTranslate,
}: {
  doc: DemoDocItem;
  status: GenStatus;
  approvedLabel: string;
  translateLabel: string;
  translatedLabel: string;
  onTranslate: () => void;
}) {
  const translated = status === "done";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 18,
        padding: 15,
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <IconTile name="doc" color="var(--accent)" size={44} radius={13} iconSize={22} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, color: "var(--navy)", fontWeight: 700, lineHeight: 1.35 }}>{doc.label}</div>
        <div style={{ marginTop: 4 }}>
          <StatusPill kind="aprobado" variant="subtle">
            {approvedLabel}
          </StatusPill>
        </div>
      </div>
      {translated ? (
        <Chip tone="green" dot>
          {translatedLabel}
        </Chip>
      ) : (
        <div style={{ flexShrink: 0 }}>
          <GradientBtn icon="globe" size="sm" full={false} onClick={onTranslate}>
            {translateLabel}
          </GradientBtn>
        </div>
      )}
    </div>
  );
}
