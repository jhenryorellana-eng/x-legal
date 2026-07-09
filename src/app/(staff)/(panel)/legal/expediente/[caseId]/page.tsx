/**
 * Ensamblador de expediente — `/legal/expediente/[caseId]` (paralegal Diana).
 *
 * Server component: loads all expediente data for a case and mounts
 * <EnsambladorView/> with the data + injected server actions.
 * CaseError / ExpedienteError → friendly empty (never 500).
 */

export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import {
  getCaseExpedientes,
  getExpediente,
  getExpedienteMaterial,
  listCoverTemplates,
  ExpedienteError,
  type ExpedienteRow,
  type ExpedienteItemRow,
  type CoverTemplateRow,
  type ExpedienteMaterial,
} from "@/backend/modules/expediente";
import { CaseError, getCaseWorkspace } from "@/backend/modules/cases";
import { getExhibitsForCase } from "@/backend/modules/exhibits";
import { EnsambladorView, type EnsambladorVM } from "@/frontend/features/legal/ensamblador/ensamblador-view";
import {
  createExpedienteAction,
  generateCoverAction,
  addItemAction,
  removeItemAction,
  reorderItemsAction,
  updateItemAction,
  compileExpedienteAction,
  getCompiledPdfUrlAction,
  createCorrectionAttemptAction,
  autoAssembleWithAiAction,
  deleteCoverItemAction,
  regenerateCoverAction,
  markExpedienteReadyAction,
  retryExhibitAction,
  createExhibitUploadUrlAction,
  confirmManualExhibitAction,
} from "./actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Picks the "most relevant" expediente from the list:
 * - Prefer one in an editable status (draft or corrections_needed)
 * - Otherwise pick the highest attempt_no (first in DESC-ordered list)
 */
function pickRelevantExpediente(rows: ExpedienteRow[]): ExpedienteRow | null {
  if (rows.length === 0) return null;
  const editable = rows.find(
    (r) => r.status === "draft" || r.status === "corrections_needed",
  );
  return editable ?? rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function EnsambladorPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;

  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const t = await getTranslations("staff_ensamblador");

  // Back-link role-aware: Diana (paralegal) regresa a su workspace; el resto al
  // detalle de caso admin. Mantiene coherente la navegación kanban→workspace→ensamblador.
  const backHref =
    actor.role === "paralegal" ? `/legal/caso/${caseId}` : `/admin/casos/${caseId}`;

  // -------------------------------------------------------------------------
  // Data loading — all errors become friendly empty states (never 500).
  // -------------------------------------------------------------------------
  let vm: EnsambladorVM = {
    expediente: null,
    items: [],
    material: { covers: [], generations: [], forms: [], documents: [] },
    coverTemplates: [],
    parties: [],
    exhibits: [],
  };

  // Case parties feed the per-party cover generator (subtitle = party name).
  // Loaded regardless of expediente existence; degrade to [] on failure.
  const parties = await getCaseWorkspace(actor, caseId)
    .then((ws) => ws.parties.map((p) => ({ id: p.id, name: p.name ?? "—", role: p.role })))
    .catch(() => [] as { id: string; name: string; role: string }[]);

  // Auto-downloaded exhibits (anexos) — Diana's status panel; degrade to [] on failure.
  const exhibits = await getExhibitsForCase(actor, caseId)
    .then((rows) =>
      rows.map((e) => ({
        id: e.id,
        exhibitLabel: e.exhibit_label,
        sourceKind: e.source_kind,
        title: e.title,
        publisher: e.publisher,
        sourceUrl: e.source_url,
        status: e.status,
        pageCount: e.page_count,
        lastError: e.last_error,
      })),
    )
    .catch(() => [] as EnsambladorVM["exhibits"]);

  try {
    const allExpedientes = await getCaseExpedientes(actor, caseId);
    const picked = pickRelevantExpediente(allExpedientes);

    let items: ExpedienteItemRow[] = [];
    let material: ExpedienteMaterial = { covers: [], generations: [], forms: [], documents: [] };
    let coverTemplates: CoverTemplateRow[] = [];

    if (picked) {
      [{ items }, material, coverTemplates] = await Promise.all([
        getExpediente(actor, picked.id),
        getExpedienteMaterial(actor, caseId),
        listCoverTemplates(actor),
      ]);
    }

    vm = {
      expediente: picked
        ? {
            id: picked.id,
            attemptNo: picked.attempt_no,
            status: picked.status,
            hasPdf: picked.compiled_pdf_path !== null,
          }
        : null,
      items: items.map((it) => ({
        id: it.id,
        itemType: it.item_type,
        title: it.title,
        position: it.position,
        includeInToc: it.include_in_toc,
        pageCount: it.page_count,
      })),
      material: {
        covers: material.covers,
        generations: material.generations,
        forms: material.forms,
        documents: material.documents,
      },
      coverTemplates: coverTemplates.map((t) => ({ id: t.id, name: t.name })),
      parties,
      exhibits,
    };
  } catch (err) {
    // Membership / access denied / not-found → render empty rather than crash.
    if (!(err instanceof ExpedienteError) && !(err instanceof CaseError)) throw err;
  }

  // Ensure parties + exhibits are present even when the expediente load short-circuited.
  vm.parties = parties;
  vm.exhibits = exhibits;

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <Link
          href={backHref}
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            color: "var(--ink-3)",
            textDecoration: "none",
          }}
        >
          {t("backLink")}
        </Link>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 900,
            color: "var(--ink)",
            margin: "8px 0 2px",
            fontFamily: "var(--font-title)",
          }}
        >
          {t("pageTitle")}
        </h1>
        <p style={{ fontSize: 14, color: "var(--ink-2)" }}>
          {t("pageSubtitle")}
        </p>
      </div>

      <EnsambladorView
        caseId={caseId}
        vm={vm}
        actions={{
          createExpediente: createExpedienteAction,
          generateCover: generateCoverAction,
          addItem: addItemAction,
          removeItem: removeItemAction,
          reorderItems: reorderItemsAction,
          updateItem: updateItemAction,
          compileExpediente: compileExpedienteAction,
          getCompiledPdfUrl: getCompiledPdfUrlAction,
          createCorrectionAttempt: createCorrectionAttemptAction,
          autoAssembleWithAi: autoAssembleWithAiAction,
          deleteCoverItem: deleteCoverItemAction,
          regenerateCover: regenerateCoverAction,
          markReady: markExpedienteReadyAction,
          retryExhibit: retryExhibitAction,
          createExhibitUploadUrl: createExhibitUploadUrlAction,
          confirmManualExhibit: confirmManualExhibitAction,
        }}
      />
    </div>
  );
}
