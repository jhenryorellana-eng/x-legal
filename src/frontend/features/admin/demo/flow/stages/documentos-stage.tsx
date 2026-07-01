"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Card, Icon, IconTile, ProgressRing, StatusPill } from "@/frontend/components/brand";
import { ScreenHead } from "@/frontend/components/mobile/screen-head";
import type { DemoFlow } from "../use-demo-flow";
import type { DemoDocItem } from "../../scenarios/types";
import type { DocStatus } from "../use-demo-flow";

/**
 * DocumentosStage — replica of the client Documentos tab (DOC-51). Documents are
 * combined (one row per type, not per party) and grouped into accordions. Each
 * row's "Subir" → "Subiendo…" → "Subido" is pure UI; the success screen is the
 * docSuccess overlay raised by the state machine.
 */
export function DocumentosStage({ flow }: { flow: DemoFlow }) {
  const t = useTranslations("cliente.documentos");
  const td = useTranslations("staff.demo");
  const { state, actions, scenario } = flow;
  const docs = scenario.documents;

  const done = docs.filter((d) => state.docStatus[d.id] === "subido").length;
  const total = docs.length;
  const pct = Math.round((done / total) * 100);
  const allDone = done === total;

  // Group by category preserving first-seen order.
  const groups = React.useMemo(() => {
    const map = new Map<string, DemoDocItem[]>();
    for (const d of docs) {
      const arr = map.get(d.category) ?? [];
      arr.push(d);
      map.set(d.category, arr);
    }
    return [...map.entries()];
  }, [docs]);

  const [open, setOpen] = React.useState<string[]>(() => groups.map(([c]) => c));
  const toggle = (c: string) => setOpen((o) => (o.includes(c) ? o.filter((x) => x !== c) : [...o, c]));

  return (
    <div style={{ minHeight: "100%", padding: "16px 20px 130px" }}>
      <ScreenHead
        title={t("title")}
        sub={t("subtitle", { phase: "preparación" })}
        lexMood="señala"
      />

      {/* Progress + tip */}
      <Card style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
        <ProgressRing pct={pct} size={78} stroke={9} />
        <div>
          <div className="t-title" style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)" }}>
            {done} {t("of")} {total}
          </div>
          <div style={{ fontSize: 13.5, color: "var(--ink-2)", fontWeight: 600 }}>{t("completed")}</div>
        </div>
      </Card>

      {allDone ? (
        <div
          className="demo-pop"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            background: "var(--green-soft)",
            borderRadius: 18,
            padding: "13px 16px",
            marginBottom: 14,
          }}
        >
          <Icon name="check" size={20} color="var(--green)" stroke={2.8} />
          <span style={{ fontSize: 14, color: "var(--green)", fontWeight: 800 }}>{td("allDocsDone")}</span>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            background: "var(--blue-soft)",
            borderRadius: 18,
            padding: "13px 16px",
            marginBottom: 14,
          }}
        >
          <IconTile name="camera" color="var(--accent)" size={38} radius={11} iconSize={20} />
          <span style={{ fontSize: 13.5, color: "var(--ink-2)", fontWeight: 600, lineHeight: 1.4 }}>{t("tip")}</span>
        </div>
      )}

      {/* Accordions */}
      {groups.map(([category, items]) => {
        const isOpen = open.includes(category);
        return (
          <div key={category} style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => toggle(category)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "6px 2px",
              }}
            >
              <span className="t-title" style={{ fontSize: 15, fontWeight: 800, color: "var(--navy)" }}>
                {category}
              </span>
              <span style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .25s var(--ease)" }}>
                <Icon name="chevD" size={18} color="var(--ink-3)" />
              </span>
            </button>
            {isOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
                {items.map((d) => (
                  <DocRow
                    key={d.id}
                    doc={d}
                    status={state.docStatus[d.id]}
                    uploadLabel={t("upload")}
                    uploadingLabel={td("uploading")}
                    uploadedLabel={td("uploaded")}
                    onUpload={() => actions.uploadDoc(d.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DocRow({
  doc,
  status,
  uploadLabel,
  uploadingLabel,
  uploadedLabel,
  onUpload,
}: {
  doc: DemoDocItem;
  status: DocStatus;
  uploadLabel: string;
  uploadingLabel: string;
  uploadedLabel: string;
  onUpload: () => void;
}) {
  const uploaded = status === "subido";
  return (
    <div
      className={`mp-lift ${uploaded ? "demo-row-done" : ""}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: uploaded ? "color-mix(in srgb, var(--green) 9%, transparent)" : "var(--card)",
        borderRadius: 20,
        padding: 16,
        boxShadow: "var(--shadow-soft)",
        transition: "background .5s ease",
      }}
    >
      <IconTile name="doc" color={uploaded ? "var(--green)" : "var(--accent)"} size={44} radius={13} iconSize={22} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, color: "var(--navy)", fontWeight: 700, lineHeight: 1.35 }}>{doc.label}</div>
        {doc.hint && !uploaded && (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 600, marginTop: 2 }}>{doc.hint}</div>
        )}
      </div>
      {uploaded ? (
        <StatusPill kind="hecho">{uploadedLabel}</StatusPill>
      ) : status === "subiendo" ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            background: "var(--blue-soft)",
            color: "var(--accent)",
            borderRadius: 999,
            padding: "8px 14px",
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 13.5,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 15,
              height: 15,
              borderRadius: 999,
              border: "2.5px solid color-mix(in srgb, var(--accent) 35%, transparent)",
              borderTopColor: "var(--accent)",
              animation: "demo-spin .7s linear infinite",
            }}
          />
          {uploadingLabel}
        </span>
      ) : (
        <button
          type="button"
          onClick={onUpload}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            borderRadius: 999,
            padding: "9px 16px",
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 13.5,
            flexShrink: 0,
            boxShadow: "0 6px 16px color-mix(in srgb, var(--accent) 27%, transparent)",
          }}
        >
          <Icon name="upload" size={16} color="#fff" />
          {uploadLabel}
        </button>
      )}
    </div>
  );
}
