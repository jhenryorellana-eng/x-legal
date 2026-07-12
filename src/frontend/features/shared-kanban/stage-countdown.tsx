"use client";

/**
 * Stage countdown badge — the kanban card footer clock (DOC-54 §1.3, reshaped).
 *
 * Replaces the old "tiempo transcurrido" badge ("hace 11 días") with a live COUNTDOWN
 * of the días restantes of the responsible member's current stage. The deadline comes
 * from `cases.stage_due_at` (snapshotted server-side at each stage entry from the
 * per-service `service_stage_slas`). Re-evaluates every 60 s so it ticks down without a
 * page reload. `dueAt` null → the badge is hidden (payment_pending / done / a stage with
 * no SLA configured).
 *
 * Pure tier/label logic lives in ./stage-countdown-logic (unit-tested). Copy is built
 * per-locale in-component (mirror of buildNotesStrings) — no message keys, so it needs
 * no es/en parity plumbing across the three case boards that share this card.
 *
 * Boundary: frontend → frontend | shared. Uses only React + a Material symbol.
 */

import * as React from "react";
import { MSym } from "@/frontend/features/vanessa/shared/msym";
import { daysUntil, countdownTier, countdownLabel, TIER_COLOR } from "./stage-countdown-logic";

export function StageCountdownBadge({
  dueAt,
  locale,
}: {
  dueAt: string | null;
  locale: "es" | "en";
}) {
  const dueMs = React.useMemo(() => {
    if (!dueAt) return null;
    const t = new Date(dueAt).getTime();
    return Number.isNaN(t) ? null : t;
  }, [dueAt]);

  // Tick: recompute "now" every 60 s (day-granularity countdown — cheap, and it
  // flips color/label the moment a card crosses a threshold without a reload).
  const [nowMs, setNowMs] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (dueMs == null) return;
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [dueMs]);

  if (dueMs == null) return null;

  const days = daysUntil(dueMs, nowMs);
  const tier = countdownTier(days);
  const urgent = tier === "hot" || tier === "overdue";
  const tooltip = locale === "es" ? "Tiempo restante de esta etapa" : "Time left in this stage";

  return (
    <span
      title={tooltip}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11.5,
        fontWeight: 700,
        color: TIER_COLOR[tier],
        ...(urgent ? { animation: "vblink 1.4s ease-in-out infinite" } : null),
      }}
    >
      <MSym name="schedule" size={13} />
      {countdownLabel(days, tier, locale)}
    </span>
  );
}
