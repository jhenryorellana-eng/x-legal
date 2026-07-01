"use client";

import * as React from "react";
import { GhostBtn, GradientBtn, IconTile, StatusPill, type IconName } from "@/frontend/components/brand";
import type { GenStatus } from "../use-staff-flow";

/**
 * GenerationRow — the shared "artifact + action" row used by the Automatización,
 * Generaciones and Expediente tabs: an icon tile, a title + caption, and a right
 * side that swaps between "Generar", a running pill, and a done chip (+ optional
 * "Ver"). Keeps the three generation tabs consistent and DRY.
 */
export interface GenerationRowProps {
  icon: IconName;
  tone: string;
  title: string;
  caption: string;
  status: GenStatus;
  generateLabel: string;
  generatingLabel: string;
  doneLabel: string;
  viewLabel?: string;
  onGenerate: () => void;
  onView?: () => void;
  /** Extra info shown under the caption once done (e.g. "12 págs · PDF oficial"). */
  doneMeta?: string;
}

export function GenerationRow({
  icon,
  tone,
  title,
  caption,
  status,
  generateLabel,
  generatingLabel,
  doneLabel,
  viewLabel,
  onGenerate,
  onView,
  doneMeta,
}: GenerationRowProps) {
  const done = status === "done";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 18,
        padding: 16,
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <IconTile name={icon} color={done ? "var(--green)" : tone} size={48} radius={14} iconSize={24} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15.5, color: "var(--navy)", fontWeight: 800, lineHeight: 1.3 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 600, marginTop: 2 }}>
          {done && doneMeta ? doneMeta : caption}
        </div>
      </div>

      {status === "running" ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "var(--blue-soft)",
            color: "var(--accent)",
            borderRadius: 999,
            padding: "9px 15px",
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
          {generatingLabel}
        </span>
      ) : done ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <StatusPill kind="hecho">{doneLabel}</StatusPill>
          {viewLabel && onView && (
            <GhostBtn icon="chevR" size="md" full={false} onClick={onView}>
              {viewLabel}
            </GhostBtn>
          )}
        </div>
      ) : (
        <div style={{ flexShrink: 0 }}>
          <GradientBtn icon="sparkle" size="sm" full={false} animated onClick={onGenerate}>
            {generateLabel}
          </GradientBtn>
        </div>
      )}
    </div>
  );
}
