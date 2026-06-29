/**
 * GET /admin/ai-costs/export — CSV of the per-query AI cost report (RF-ADM-005).
 *
 * Synchronous (no QStash / Storage): one org's AI runs for a period is a small
 * dataset. Reuses getAiCostsReport, which enforces can(actor, 'dashboard',
 * 'view'); admin-only on top (mirrors the page redirect). Query params: period,
 * from, to (same as the page filter).
 *
 * Boundary: app → module-pub only (requireActor via identity, getAiCostsReport
 * via ai-engine). Route handlers aren't wrapped by the (panel) layout, so this
 * returns raw CSV without the staff chrome.
 */

import { type NextRequest } from "next/server";
import { requireActor } from "@/backend/modules/identity";
import { getAiCostsReport } from "@/backend/modules/ai-engine";
import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_TZ, type Period } from "@/shared/period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(value: string): string {
  // CSV formula injection (OWASP): prefix a quote so spreadsheets don't execute
  // cells starting with = + - @ (or a leading tab/CR).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const SOURCE_ES: Record<string, string> = {
  generations: "Generación",
  extractions: "Extracción",
  translations: "Traducción",
};
const STATUS_ES: Record<string, string> = {
  completed: "Completado",
  failed: "Fallido",
  queued: "En cola",
  running: "En proceso",
  cancelled: "Cancelado",
};

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const actor = await requireActor();
    if (actor.kind !== "staff" || (actor.role && actor.role !== "admin")) {
      return Response.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
    }

    const sp = request.nextUrl.searchParams;
    const period: Period =
      sp.get("period") === "today" || sp.get("period") === "month" || sp.get("period") === "custom"
        ? (sp.get("period") as Period)
        : "week";

    const report = await getAiCostsReport(actor, {
      period,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
    });

    const header = ["Fecha", "Caso", "Fuente", "Modelo", "Tokens", "Costo (USD)", "Estado"];
    const lines = [header.join(",")];
    for (const q of report.queries) {
      lines.push(
        [
          csvCell(formatInTimeZone(new Date(q.createdAt), DEFAULT_TZ, "yyyy-MM-dd HH:mm")),
          csvCell(q.caseNumber ?? ""),
          csvCell(SOURCE_ES[q.source] ?? q.source),
          csvCell(q.model ?? ""),
          csvCell(String(q.tokens)),
          csvCell(q.costUsd.toFixed(4)),
          csvCell(STATUS_ES[q.status] ?? q.status),
        ].join(","),
      );
    }

    // UTF-8 BOM so Excel reads accents correctly.
    const csv = "﻿" + lines.join("\r\n") + "\r\n";
    const filename = `costes-ia-${period}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AuthzError") {
      return Response.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
    }
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal Server Error" } },
      { status: 500 },
    );
  }
}
