"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Card, Icon, IconTile, ProgressRing, type IconName } from "@/frontend/components/brand";
import type { DemoStaffFixture } from "../../scenarios/types";

/** ResumenTab — key facts, progress rings and case history (all from the fixture). */
export function ResumenTab({ staff }: { staff: DemoStaffFixture }) {
  const t = useTranslations("staff.demo");
  const docsPct = Math.round((staff.docsApproved / staff.docsTotal) * 100);
  const formsPct = Math.round((staff.formsDone / staff.formsTotal) * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <Card>
          <CardHead icon="user" title={t("resumenKeyFacts")} />
          <div style={{ marginTop: 10 }}>
            {staff.keyFacts.map((f) => (
              <div
                key={f.label}
                style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "9px 0", borderBottom: "1px solid var(--line)" }}
              >
                <span style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 700 }}>{f.label}</span>
                <span style={{ fontSize: 13.5, color: "var(--navy)", fontWeight: 800, textAlign: "right" }}>{f.value}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHead icon="check" title={t("resumenProgress")} />
          <div style={{ display: "flex", gap: 20, marginTop: 16, flexWrap: "wrap", justifyContent: "space-around" }}>
            <RingBlock pct={docsPct} label={`${staff.docsApproved}/${staff.docsTotal}`} caption={t("resumenDocsApproved")} />
            <RingBlock pct={formsPct} label={`${staff.formsDone}/${staff.formsTotal}`} caption={t("resumenFormsDone")} />
          </div>
        </Card>
      </div>

      <Card>
        <CardHead icon="clock" title={t("resumenHistory")} />
        <div style={{ marginTop: 8 }}>
          {staff.timeline.map((e, i) => (
            <div
              key={e.title}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 0",
                borderBottom: i < staff.timeline.length - 1 ? "1px solid var(--line)" : "none",
              }}
            >
              <IconTile name={e.icon} color="var(--accent)" size={38} radius={11} iconSize={19} />
              <span style={{ flex: 1, fontSize: 14, color: "var(--navy)", fontWeight: 700, lineHeight: 1.35 }}>{e.title}</span>
              <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700, whiteSpace: "nowrap" }}>{e.when}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function CardHead({ icon, title }: { icon: IconName; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <Icon name={icon} size={18} color="var(--accent)" />
      <h3 className="t-title" style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "var(--navy)" }}>
        {title}
      </h3>
    </div>
  );
}

function RingBlock({ pct, label, caption }: { pct: number; label: string; caption: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <ProgressRing pct={pct} size={92} stroke={10} label={label} />
      <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-2)", fontWeight: 700 }}>{caption}</div>
    </div>
  );
}
