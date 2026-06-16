/**
 * API-BIL-19 — GET /api/v1/billing/ledger/export
 *
 * Streams the ledger (libro) as CSV for the current filters. Synchronous
 * (no QStash job / Storage): a single org+month dataset is small. Reuses
 * listLedger, which enforces can(actor, 'billing', 'view').
 *
 * Query params: from, to (YYYY-MM-DD), kind (income|expense), category, caseId.
 *
 * Boundary: app → module-pub only (requireActor via identity, listLedger via billing).
 */

import { type NextRequest } from "next/server";
import { requireActor } from "@/backend/modules/identity";
import { listLedger, BillingError, type LedgerEntryDto } from "@/backend/modules/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAGES = 50; // 50 × 500 = 25k rows safety cap (logged if hit)
const PAGE_SIZE = 500;

function csvCell(value: string): string {
  // CSV formula injection (OWASP): prefix a quote so spreadsheets don't execute
  // staff-entered cells starting with = + - @ (or a leading tab/CR).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function formatAmount(kind: "income" | "expense", cents: number): string {
  const sign = kind === "expense" ? "-" : "";
  return `${sign}${(cents / 100).toFixed(2)}`;
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const actor = await requireActor();
    const sp = request.nextUrl.searchParams;

    const filters = {
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      kind: (sp.get("kind") as "income" | "expense" | null) ?? undefined,
      category: sp.get("category") ?? undefined,
      caseId: sp.get("caseId") ?? undefined,
      limit: PAGE_SIZE,
    };

    // Collect all pages (keyset cursor), bounded by MAX_PAGES.
    const rows: LedgerEntryDto[] = [];
    let cursor: string | null = null;
    let pages = 0;
    let truncated = false;
    do {
      const page = await listLedger(actor, { ...filters, cursor: cursor ?? undefined });
      rows.push(...page.items);
      cursor = page.nextCursor;
      pages += 1;
      if (pages >= MAX_PAGES && cursor) {
        truncated = true;
        break;
      }
    } while (cursor);

    const header = ["Fecha", "Tipo", "Categoría", "Descripción", "Caso", "Origen", "Monto (USD)"];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          csvCell(r.entryDate),
          csvCell(r.kind === "income" ? "Ingreso" : "Egreso"),
          csvCell(r.category),
          csvCell(r.description ?? ""),
          csvCell(r.caseNumber ?? ""),
          csvCell(r.isAutomatic ? "Automático" : "Manual"),
          csvCell(formatAmount(r.kind, r.amountCents)),
        ].join(","),
      );
    }
    if (truncated) {
      lines.push("# Exportación truncada: se alcanzó el máximo de filas. Afina los filtros.");
    }

    // UTF-8 BOM so Excel reads accents correctly.
    const csv = "﻿" + lines.join("\r\n") + "\r\n";
    const filename = `libro-${filters.from ?? "todo"}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof BillingError) {
      return Response.json({ error: { code: err.code, message: err.code } }, { status: 400 });
    }
    if (err instanceof Error && err.name === "AuthzError") {
      return Response.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
    }
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal Server Error" } },
      { status: 500 },
    );
  }
}
