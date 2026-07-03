"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon, IconTile, type IconName } from "@/frontend/components/brand";
import { ClientFlow } from "./flow/client-flow";
import { StaffView } from "./staff-view";
import { Caption } from "./components/caption";
import { DemoStyles } from "./components/demo-styles";
import { useDemoFlow, type DemoFlowState } from "./flow/use-demo-flow";
import { useDemoAssetBlobs, type DemoAssetUrlMap } from "./use-demo-asset-blobs";
import { serviceColorToken } from "./scenarios";
import type { DemoScenario } from "./scenarios/types";

export interface DemoExperienceProps {
  scenario: DemoScenario;
  service: { label: string; icon: IconName; colorKey: string };
  /** Signed URLs of the real demo PDFs (null = none / read failed). */
  assetUrls: DemoAssetUrlMap | null;
}

type Tab = "client" | "staff";

function captionFor(scenario: DemoScenario, state: DemoFlowState): string {
  if (state.reviewFormId) return scenario.captions.review;
  switch (state.stage) {
    case "cases":
      return scenario.captions.cases;
    case "signing":
      return scenario.captions.signing;
    case "pagos":
      return scenario.captions.pagos;
    case "disclaimer":
      return scenario.captions.disclaimer;
    case "caseDocs":
      return scenario.captions.documentos;
    case "caseForms":
      return scenario.captions.formularios;
    default:
      return "";
  }
}

export function DemoExperience({ scenario, service, assetUrls }: DemoExperienceProps) {
  const t = useTranslations("staff.demo");
  const flow = useDemoFlow(scenario);
  const [tab, setTab] = React.useState<Tab>("client");
  const [captions, setCaptions] = React.useState(true);
  // Bumped on reset so the staff view remounts and clears its local flow/timers.
  const [runId, setRunId] = React.useState(0);
  // Pre-loaded HERE (outside the key={runId} subtree) so resetting the demo
  // never re-fetches: the whole live runs without network.
  const assetBlobs = useDemoAssetBlobs(assetUrls);
  const color = serviceColorToken(service.colorKey);

  const handleReset = React.useCallback(() => {
    flow.actions.reset();
    setRunId((n) => n + 1);
  }, [flow.actions]);

  return (
    <div style={{ padding: "22px clamp(16px,3vw,32px) 56px", maxWidth: 760, margin: "0 auto" }}>
      <DemoStyles />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
        <Link
          href="/admin/demo"
          aria-label="Volver"
          style={{
            width: 42,
            height: 42,
            borderRadius: 999,
            background: "var(--card)",
            border: "1px solid var(--line)",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <Icon name="arrowL" size={20} color="var(--navy)" />
        </Link>
        <IconTile name={service.icon} color={color} size={44} radius={13} iconSize={23} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--ink-3)" }}>
            {t("title")}
          </div>
          <div className="t-title" style={{ fontSize: 19, fontWeight: 800, color: "var(--navy)" }}>
            {service.label}
          </div>
        </div>

        {/* Reset */}
        <button
          type="button"
          onClick={handleReset}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            height: 38,
            padding: "0 14px",
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: "var(--card)",
            color: "var(--ink-2)",
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 13.5,
            cursor: "pointer",
          }}
        >
          <Icon name="play" size={16} color="var(--ink-2)" />
          {t("reset")}
        </button>
      </div>

      {/* Tabs + captions toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div
          role="tablist"
          style={{
            display: "inline-flex",
            padding: 4,
            gap: 4,
            background: "var(--panel-2, var(--bg))",
            border: "1px solid var(--line)",
            borderRadius: 999,
          }}
        >
          {([
            { id: "client" as const, label: t("tabClient") },
            { id: "staff" as const, label: t("tabStaff") },
          ]).map((tb) => {
            const on = tab === tb.id;
            return (
              <button
                key={tb.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(tb.id)}
                style={{
                  height: 36,
                  padding: "0 18px",
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "var(--font-title)",
                  fontWeight: 800,
                  fontSize: 14,
                  color: on ? "#fff" : "var(--ink-2)",
                  background: on ? "linear-gradient(135deg, var(--accent), var(--brand-navy))" : "transparent",
                  boxShadow: on ? "0 6px 16px color-mix(in srgb, var(--accent) 30%, transparent)" : "none",
                  transition: "background .2s var(--ease), color .2s var(--ease)",
                }}
              >
                {tb.label}
              </button>
            );
          })}
        </div>

        {tab === "client" && (
          <button
            type="button"
            onClick={() => setCaptions((v) => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              height: 36,
              padding: "0 14px",
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: captions ? "var(--blue-soft)" : "var(--card)",
              color: captions ? "var(--accent)" : "var(--ink-3)",
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 13.5,
              cursor: "pointer",
            }}
          >
            <Icon name="sparkle" size={16} color={captions ? "var(--accent)" : "var(--ink-3)"} />
            {captions ? t("captionsHide") : t("captionsShow")}
          </button>
        )}
      </div>

      {/* Body */}
      {tab === "client" ? (
        <div>
          <ClientFlow flow={flow} service={service} />
          {captions && <Caption text={captionFor(scenario, flow.state)} />}
        </div>
      ) : (
        <StaffView key={runId} scenario={scenario} service={service} assetBlobs={assetBlobs} />
      )}
    </div>
  );
}
