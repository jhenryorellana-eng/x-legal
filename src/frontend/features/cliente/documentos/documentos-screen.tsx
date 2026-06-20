"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/frontend/components/brand/icon";
import { IconTile } from "@/frontend/components/brand/icon-tile";
import { Card } from "@/frontend/components/brand/card";
import { ProgressRing } from "@/frontend/components/brand/progress-ring";
import { StatusPill } from "@/frontend/components/brand/status-pill";
import { ScreenHead } from "@/frontend/components/mobile";

/**
 * DocumentosScreen — `/caso/[caseId]/documentos` (DOC-51 §14, prototype
 * `screens2.jsx → DocsScreen`). Checklist by category, per-requirement status.
 *
 * Client component (category accordion is interactive). Rejected docs render in
 * AMBER (StatusPill never used for "corregir" → red button + reason text, per
 * the spec's tone rule RF-CLI-028).
 */

export interface DocItem {
  key: string;
  /** Effective label (includes party suffix when per-party). */
  label: string;
  category: string;
  status: "pendiente" | "revision" | "aprobado" | "corregir";
  rejectionReason: string | null;
  /** Query string for the upload/fix route (carries requirement + party). */
  query: string;
}

export interface DocumentosLabels {
  title: string;
  subtitle: string; // "...de tu fase de {phase}..."
  ofWord: string;
  completed: string;
  tip: string; // bold "Consejo:" prefix handled in copy
  approved: string;
  inReview: string;
  upload: string;
  fix: string;
}

export function DocumentosScreen({
  items,
  done,
  total,
  progress,
  phaseName,
  caseId,
  labels,
}: {
  items: DocItem[];
  done: number;
  total: number;
  progress: number;
  phaseName: string;
  caseId: string;
  labels: DocumentosLabels;
}) {
  const router = useRouter();
  const categories = React.useMemo(
    () => Array.from(new Set(items.map((d) => d.category))),
    [items],
  );
  const [open, setOpen] = React.useState<string[]>(categories);
  const toggle = (c: string) =>
    setOpen((o) => (o.includes(c) ? o.filter((x) => x !== c) : [...o, c]));

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "54px 20px var(--screen-pb)",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      <ScreenHead
        title={labels.title}
        sub={labels.subtitle.replace("{phase}", phaseName)}
        lexMood="señala"
      />

      <Card style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, padding: 18 }}>
        <ProgressRing pct={progress} size={78} stroke={9} />
        <div style={{ flex: 1 }}>
          <div
            className="t-title"
            style={{ fontSize: 21, color: "var(--navy)", fontWeight: 800 }}
          >
            {done} {labels.ofWord} {total}
          </div>
          <div style={{ fontSize: 15, color: "var(--ink-2)", fontWeight: 500 }}>
            {labels.completed}
          </div>
        </div>
      </Card>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          background: "var(--blue-soft)",
          borderRadius: 18,
          padding: "14px 16px",
          marginBottom: 20,
        }}
      >
        <IconTile name="camera" color="var(--accent)" size={38} radius={999} iconSize={22} />
        <div
          style={{
            fontSize: 14.5,
            color: "var(--navy)",
            fontWeight: 500,
            lineHeight: 1.4,
          }}
        >
          {labels.tip}
        </div>
      </div>

      {categories.map((cat) => (
        <div key={cat} style={{ marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => toggle(cat)}
            aria-expanded={open.includes(cat)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "none",
              border: "none",
              padding: "4px 4px 10px",
              cursor: "pointer",
            }}
          >
            <span
              className="t-title"
              style={{ fontSize: 17, color: "var(--navy)", fontWeight: 700 }}
            >
              {cat}
            </span>
            <span
              style={{
                transform: open.includes(cat) ? "rotate(0)" : "rotate(-90deg)",
                transition: "transform 0.2s",
                display: "flex",
              }}
            >
              <Icon name="chevD" size={20} color="var(--ink-3)" />
            </span>
          </button>
          {open.includes(cat) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {items
                .filter((d) => d.category === cat)
                .map((d) => (
                  <div
                    key={d.key}
                    className="mp-lift"
                    style={{
                      background: "var(--card)",
                      borderRadius: 20,
                      padding: 16,
                      display: "flex",
                      alignItems: "center",
                      gap: 13,
                      boxShadow: "var(--shadow-soft)",
                    }}
                  >
                    <IconTile name="doc" color="var(--accent)" size={44} radius={13} iconSize={24} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className="t-title"
                        style={{
                          fontSize: 16,
                          color: "var(--navy)",
                          fontWeight: 700,
                          lineHeight: 1.25,
                        }}
                      >
                        {d.label}
                      </div>
                      {d.status === "corregir" && d.rejectionReason && (
                        <div
                          style={{
                            fontSize: 13,
                            color: "var(--gold-deep)",
                            fontWeight: 700,
                            marginTop: 3,
                          }}
                        >
                          {d.rejectionReason}
                        </div>
                      )}
                      {(d.status === "aprobado" || d.status === "revision") && (
                        <div style={{ marginTop: 6 }}>
                          <StatusPill kind={d.status}>
                            {d.status === "aprobado" ? labels.approved : labels.inReview}
                          </StatusPill>
                        </div>
                      )}
                    </div>
                    {(d.status === "pendiente" || d.status === "corregir") && (
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            d.status === "corregir"
                              ? `/caso/${caseId}/corregir?${d.query}`
                              : `/caso/${caseId}/subir?${d.query}`,
                          )
                        }
                        className="mp-pop"
                        style={{
                          height: 44,
                          padding: "0 18px",
                          borderRadius: 999,
                          border: "none",
                          cursor: "pointer",
                          // "corregir" CTA is amber (gold-deep), NOT red — tone rule.
                          background:
                            d.status === "corregir"
                              ? "var(--gold-deep)"
                              : "var(--accent)",
                          color: "#fff",
                          fontFamily: "var(--font-title)",
                          fontWeight: 700,
                          fontSize: 15,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          boxShadow: `0 6px 14px color-mix(in srgb, ${d.status === "corregir" ? "var(--gold-deep)" : "var(--accent)"} 27%, transparent)`,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <Icon
                          name={d.status === "corregir" ? "edit" : "upload"}
                          size={18}
                          color="#fff"
                        />
                        {d.status === "corregir" ? labels.fix : labels.upload}
                      </button>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
