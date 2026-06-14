/**
 * QStash job: ai-budget-aggregation
 *
 * Cron job that aggregates AI spending and alerts admin at 80%/100% threshold.
 * Runs daily (threshold mode) and monthly on day 1 (close mode).
 *
 * DOC-26 §2.9 — behavior, idempotence.
 * DOC-74 §5.3 — budget alerts.
 *
 * Idempotency:
 *   - Threshold alerts deduped by notifications.dedupe_key (one per threshold per month)
 *   - Monthly close deduped by same mechanism
 *   - dedupeId = ai-budget-aggregation:<date>[:close]
 *
 * Retries: 1 (cron — next run covers missed window).
 * Schedule (QStash):
 *   0 12 * * *   (daily, UTC 12:00 — threshold mode)
 *   0 13 1 * *   (monthly, UTC 13:00 day 1 — close mode, payload {mode:'monthly-close'})
 *
 * Boundary: imports ONLY from module-pub (ai-engine/index.ts, notifications/index.ts),
 *           platform/, shared/.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import { createServiceClient } from "@/backend/platform/supabase";
import { sumMonthlyCosts } from "@/backend/modules/ai-engine";
import { insertNotificationIdempotent } from "@/backend/modules/notifications";

// ---------------------------------------------------------------------------
// Payload schema
// ---------------------------------------------------------------------------

const AiBudgetPayloadSchema = z.object({
  jobKey: z.literal("ai-budget-aggregation"),
  entityId: z.null().optional(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
  mode: z.enum(["threshold", "monthly-close"]).optional().default("threshold"),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleAiBudgetAggregation(rawPayload: unknown): Promise<void> {
  const parseResult = AiBudgetPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "ai-budget-aggregation: invalid payload — skipping",
    );
    return;
  }

  const { mode } = parseResult.data;
  const now = new Date();
  const monthUtc = now.toISOString().slice(0, 7); // "YYYY-MM"

  // Get all active orgs with ai_budget_usd configured
  const supabase = createServiceClient();
  const { data: orgs } = await supabase
    .from("orgs")
    .select("id, settings");

  if (!orgs) return;

  for (const org of orgs) {
    const settings = (org.settings as Record<string, unknown> | null) ?? {};
    const budgetUsd = typeof settings["ai_budget_usd"] === "number"
      ? (settings["ai_budget_usd"] as number)
      : null;

    // Sum monthly costs for this org
    const targetMonth =
      mode === "monthly-close"
        ? getPrevMonthUtc(now)
        : monthUtc;

    const costs = await sumMonthlyCosts(org.id, targetMonth);

    if (mode === "monthly-close") {
      // Monthly close: notify admin with summary
      const monthlyAdminId = await getAdminUserId(org.id);
      if (!monthlyAdminId) continue;
      await insertNotificationIdempotent({
        userId: monthlyAdminId,
        type: "ai.budget.monthly_close",
        titleI18n: {
          en: `AI Spending Summary — ${targetMonth}`,
          es: `Resumen de Gasto IA — ${targetMonth}`,
        },
        bodyI18n: {
          en: `Total AI spending for ${targetMonth}: $${costs.totalUsd.toFixed(2)} USD${budgetUsd ? ` / $${budgetUsd} budget` : ""}.`,
          es: `Gasto total de IA en ${targetMonth}: $${costs.totalUsd.toFixed(2)} USD${budgetUsd ? ` / $${budgetUsd} presupuesto` : ""}.`,
        },
        icon: "chart",
        color: "blue",
        actionUrl: `/admin/ai-costs?month=${targetMonth}`,
        dedupeKey: `ai-budget-monthly-close:${org.id}:${targetMonth}`,
      }).catch(() => {/* non-fatal */});

      logger.info(
        { orgId: org.id, month: targetMonth, totalUsd: costs.totalUsd },
        "ai-budget-aggregation: monthly close notification sent",
      );
      continue;
    }

    // Threshold mode: alert at 80% and 100%
    if (!budgetUsd || budgetUsd <= 0) continue;

    const ratio = costs.totalUsd / budgetUsd;

    if (ratio >= 1) {
      const adminId = await getAdminUserId(org.id);
      if (adminId) {
        await insertNotificationIdempotent({
          userId: adminId,
          type: "ai.budget.over_100",
          titleI18n: {
            en: "AI Budget Exceeded",
            es: "Presupuesto de IA Superado",
          },
          bodyI18n: {
            en: `Your AI spending ($${costs.totalUsd.toFixed(2)}) has exceeded the monthly budget ($${budgetUsd}).`,
            es: `El gasto de IA ($${costs.totalUsd.toFixed(2)}) ha superado el presupuesto mensual ($${budgetUsd}).`,
          },
          icon: "alert",
          color: "red",
          actionUrl: `/admin/ai-costs`,
          dedupeKey: `ai-budget-over-100:${org.id}:${monthUtc}`,
        }).catch(() => {/* non-fatal */});
      }
    } else if (ratio >= 0.8) {
      const adminId = await getAdminUserId(org.id);
      if (adminId) {
        await insertNotificationIdempotent({
          userId: adminId,
          type: "ai.budget.over_80",
          titleI18n: {
            en: "AI Budget at 80%",
            es: "Presupuesto de IA al 80%",
          },
          bodyI18n: {
            en: `Your AI spending ($${costs.totalUsd.toFixed(2)}) has reached 80% of the monthly budget ($${budgetUsd}).`,
            es: `El gasto de IA ($${costs.totalUsd.toFixed(2)}) ha alcanzado el 80% del presupuesto mensual ($${budgetUsd}).`,
          },
          icon: "alert",
          color: "amber",
          actionUrl: `/admin/ai-costs`,
          dedupeKey: `ai-budget-over-80:${org.id}:${monthUtc}`,
        }).catch(() => {/* non-fatal */});
      }
    }

    logger.info(
      { orgId: org.id, month: monthUtc, totalUsd: costs.totalUsd, budgetUsd, ratio: ratio.toFixed(2) },
      "ai-budget-aggregation: threshold check done",
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPrevMonthUtc(now: Date): string {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

async function getAdminUserId(orgId: string): Promise<string | null> {
  const supabase = createServiceClient();
  // Get first admin staff of the org
  const { data } = await supabase
    .from("users")
    .select("id, staff_profiles!inner(role)")
    .eq("org_id", orgId)
    .eq("kind", "staff")
    .eq("staff_profiles.role", "admin")
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}
