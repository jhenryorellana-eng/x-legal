/**
 * Expediente module — service layer (use cases).
 *
 * Authorization: can() is ALWAYS the first line for staff mutations.
 * requireCaseAccess() is used for case-scoped reads.
 * Mutations: writeAudit on every staff mutation.
 * Events: appEvents via emitExpedienteCompiled() etc.
 *
 * @module expediente/service
 */

import { z } from "zod";
import crypto from "crypto";

import { can, requireCaseAccess } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { logger } from "@/backend/platform/logger";
import {
  uploadBytesToStorage,
  createSignedUploadUrl,
  createSignedDownloadUrl,
  validateUploadedObject,
} from "@/backend/platform/storage";
import {
  renderCoverPdf,
  compileExpedientePdf,
  flattenAcroAppearances,
} from "@/backend/platform/pdf";
import type { ExpedienteItemInput } from "@/backend/platform/pdf";
import { writeAudit } from "@/backend/modules/audit";
import { PRINCIPAL_ROLE_KEY } from "@/shared/constants/party-roles";
import { emitExpedienteCompiled, emitExpedienteSentToFinance, emitExpedientePrinted } from "./events";
import {
  isEditableStatus,
  canonicalClientLabel,
  validateItemRef,
  exhibitItemTitle,
  placeExhibitsAfterMemo,
  type ExpedienteItemType,
} from "./domain";
import {
  listActiveCoverTemplates,
  findCoverTemplateById,
  insertCoverRender,
  findCoverRenderById,
  listCompletedTranslationsForCase,
  findTranslationById,
  findExhibitById,
  countCoverItemRefs,
  deleteCoverRender,
  findExpedienteById,
  listExpedientesForCase,
  maxAttemptNoForCase,
  findDraftExpedienteForCase,
  insertExpediente,
  updateExpediente,
  listItemsForExpediente,
  maxItemPositionForExpediente,
  findItemById,
  insertItem,
  deleteItem,
  updateItemPosition,
  updateItemPageCount,
  updateItemMeta,
  verifyCoverRenderExists,
  findGenerationRunById,
  findFormResponseById,
  findCaseDocumentById,
  listCoverRendersForMaterial,
  listGenerationRunsForMaterial,
  loadLatestMailingCoverPdf,
  isMailingCoverForm,
  listFormResponsesForMaterial,
  listApprovedDocumentsForMaterial,
  findCasePlanRequiresLawyerValidation,
  listPrintQueue as repoPrintQueue,
  listPrintHistory as repoPrintHistory,
  type ExpedienteRow,
  type ExpedienteItemRow,
  type CoverTemplateRow,
  type CoverRenderRow,
  type PrintHistoryAttemptRepo,
} from "./repository";

// ---------------------------------------------------------------------------
// Lenient UUID schema — same pattern as cases/service.ts
// ---------------------------------------------------------------------------
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const zUuid = z.string().regex(UUID_RE, "uuid");

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ExpedienteError extends Error {
  constructor(
    public readonly code:
      | "EXPEDIENTE_NOT_FOUND"
      | "EXPEDIENTE_DRAFT_EXISTS"
      | "EXPEDIENTE_NOT_EDITABLE"
      | "EXPEDIENTE_NOT_COMPILABLE"
      | "EXPEDIENTE_COMPILE_FAILED"
      | "EXPEDIENTE_NOT_COMPILED"
      | "EXPEDIENTE_NOT_READY"
      | "EXPEDIENTE_NOT_APPROVED"
      | "EXPEDIENTE_ALREADY_SENT_TO_FINANCE"
      | "EXPEDIENTE_NOT_IN_PRINT_QUEUE"
      | "EXPEDIENTE_NOT_PRINTED"
      | "COMPILE_SOURCE_MISSING"
      | "EXPEDIENTE_ITEM_NOT_FOUND"
      | "EXPEDIENTE_ITEM_REF_INVALID"
      | "COVER_TEMPLATE_NOT_FOUND"
      | "COVER_RENDER_NOT_FOUND"
      | "COVER_IN_USE"
      | "EXPEDIENTE_NOT_EMPTY"
      | "EXTERNAL_FILE_UPLOAD_INVALID",
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "ExpedienteError";
  }
}

// ---------------------------------------------------------------------------
// COVERS
// ---------------------------------------------------------------------------

/**
 * Lists active cover templates for the actor's org.
 *
 * @api-id API-EXP-01
 */
export async function listCoverTemplates(
  actor: Actor,
): Promise<CoverTemplateRow[]> {
  can(actor, "expedientes", "view");
  return listActiveCoverTemplates(actor.orgId);
}

const GenerateCoverSchema = z.object({
  caseId: zUuid,
  templateId: zUuid,
  // Cover data Diana edits in the assembler: a custom title, an optional subtitle,
  // and an optional partyId for per-party covers ("Documentos del menor: {nombre}").
  // Kept open (passthrough) so future template fields persist into cover_renders.data.
  data: z
    .object({
      title: z.string().trim().min(1).optional(),
      subtitle: z.string().trim().min(1).optional(),
      partyId: zUuid.optional(),
    })
    .passthrough(),
});

export type GenerateCoverInput = z.infer<typeof GenerateCoverSchema>;

/**
 * Generates a cover page PDF for a case, stores it, and records the render.
 *
 * The clientLabel is derived as "{initial}. {lastName}" — no full PII in the PDF.
 *
 * @api-id API-EXP-02
 */
export async function generateCover(
  actor: Actor,
  input: GenerateCoverInput,
): Promise<CoverRenderRow> {
  can(actor, "expedientes", "edit");
  const parsed = GenerateCoverSchema.parse(input);
  await requireCaseAccess(actor, parsed.caseId);

  // Load template (org ownership implied by actor.orgId in listActiveCoverTemplates,
  // but we verify the template exists and belongs to this org)
  const template = await findCoverTemplateById(parsed.templateId);
  if (!template || template.org_id !== actor.orgId) {
    throw new ExpedienteError("COVER_TEMPLATE_NOT_FOUND");
  }

  // Load case workspace to derive caseNumber, serviceLabel, clientLabel
  const { getCaseWorkspace } = await import("@/backend/modules/cases") as {
    getCaseWorkspace: (actor: Actor, caseId: string) => Promise<{
      caseNumber: string;
      service: { labelI18n: { es: string; en: string } } | null;
      parties: Array<{ id: string; role: string; name: string | null }>;
    }>;
  };
  const workspace = await getCaseWorkspace(actor, parsed.caseId);

  // Build canonical client label from the petitioner (principal) party name.
  // Falls back to "—" if no party name resolves. (Role is PRINCIPAL_ROLE_KEY,
  // not the legacy "primary_applicant" — that mismatch left every cover as "—".)
  const primaryParty = workspace.parties.find((p) => p.role === PRINCIPAL_ROLE_KEY);
  let clientLabel = "—";
  if (primaryParty?.name) {
    const parts = primaryParty.name.trim().split(/\s+/);
    clientLabel =
      parts.length >= 2
        ? canonicalClientLabel(parts[0], parts.slice(1).join(" "))
        : (parts[0] ?? "—");
  }

  const serviceLabel =
    workspace.service?.labelI18n.es ??
    workspace.service?.labelI18n.en ??
    "";

  const tpl = template.template as {
    title_i18n?: { es?: string; en?: string };
    style?: "ulp-classic" | "ulp-divider";
  };

  // Per-party cover: when a partyId is supplied, the subtitle defaults to that
  // party's name ("Documentos del menor: {nombre}"), unless an explicit subtitle
  // was typed. The title falls back to the template's title or "EXPEDIENTE".
  const selectedParty = parsed.data.partyId
    ? workspace.parties.find((p) => p.id === parsed.data.partyId)
    : undefined;
  const subtitle =
    parsed.data.subtitle ?? (selectedParty?.name ? selectedParty.name : undefined);

  const coverData = {
    title: parsed.data.title ?? tpl.title_i18n?.en ?? tpl.title_i18n?.es ?? "Case File",
    subtitle,
    caseNumber: workspace.caseNumber,
    clientLabel,
    serviceLabel,
    style: tpl.style,
  };

  const bytes = await renderCoverPdf(coverData);

  const pdfPath = `case/${parsed.caseId}/covers/${crypto.randomUUID()}.pdf`;
  await uploadBytesToStorage("generated", pdfPath, bytes, "application/pdf");

  const row = await insertCoverRender({
    case_id: parsed.caseId,
    template_id: parsed.templateId,
    data: parsed.data as import("@/shared/database.types").Json,
    pdf_path: pdfPath,
    created_by: actor.userId,
  });

  await writeAudit(actor, "expediente.cover_generated", "cover_renders", row.id, {
    after: { caseId: parsed.caseId, templateId: parsed.templateId },
  });

  return row;
}

// ---------------------------------------------------------------------------
// Cover edit / delete (correct AI mistakes manually) — API-EXP-15/16
// ---------------------------------------------------------------------------

type Json = import("@/shared/database.types").Json;

interface CaseCoverContext {
  caseNumber: string;
  serviceLabel: string;
  serviceId: string | null;
  serviceSlug: string | null;
  clientLabel: string;
  parties: Array<{ id: string; role: string; name: string | null }>;
}

/** Loads the case data needed to render covers (caseNumber, service, parties, masked client label). */
async function loadCaseCoverContext(actor: Actor, caseId: string): Promise<CaseCoverContext> {
  const { getCaseWorkspace } = (await import("@/backend/modules/cases")) as {
    getCaseWorkspace: (a: Actor, c: string) => Promise<{
      caseNumber: string;
      service: { id: string; slug: string; labelI18n: { es: string; en: string } } | null;
      parties: Array<{ id: string; role: string; name: string | null }>;
    }>;
  };
  const ws = await getCaseWorkspace(actor, caseId);
  const primary = ws.parties.find((p) => p.role === PRINCIPAL_ROLE_KEY);
  let clientLabel = "—";
  if (primary?.name) {
    const parts = primary.name.trim().split(/\s+/);
    clientLabel =
      parts.length >= 2 ? canonicalClientLabel(parts[0], parts.slice(1).join(" ")) : (parts[0] ?? "—");
  }
  const serviceLabel = ws.service?.labelI18n.es ?? ws.service?.labelI18n.en ?? "";
  return {
    caseNumber: ws.caseNumber,
    serviceLabel,
    serviceId: ws.service?.id ?? null,
    serviceSlug: ws.service?.slug ?? null,
    clientLabel,
    parties: ws.parties,
  };
}

/** Renders a cover PDF + inserts a cover_render row. Returns the new row. */
async function renderInsertCover(
  caseId: string,
  ctx: CaseCoverContext,
  template: CoverTemplateRow,
  data: { title: string; subtitle?: string | null; partyId?: string | null; sectionKind?: string; aiGenerated?: boolean },
  createdBy: string,
): Promise<CoverRenderRow> {
  const tpl = template.template as { title_i18n?: { es?: string; en?: string }; style?: "ulp-classic" | "ulp-divider" };
  const bytes = await renderCoverPdf({
    title: data.title || tpl.title_i18n?.en || tpl.title_i18n?.es || "Case File",
    subtitle: data.subtitle ?? undefined,
    caseNumber: ctx.caseNumber,
    clientLabel: ctx.clientLabel,
    serviceLabel: ctx.serviceLabel,
    style: tpl.style,
  });
  const pdfPath = `case/${caseId}/covers/${crypto.randomUUID()}.pdf`;
  await uploadBytesToStorage("generated", pdfPath, bytes, "application/pdf");
  return insertCoverRender({
    case_id: caseId,
    template_id: template.id,
    data: {
      title: data.title,
      subtitle: data.subtitle ?? null,
      partyId: data.partyId ?? null,
      sectionKind: data.sectionKind ?? null,
      aiGenerated: data.aiGenerated ?? false,
    } as Json,
    pdf_path: pdfPath,
    created_by: createdBy,
  });
}

/**
 * Removes a cover item from the expediente AND deletes its cover_render when no
 * other item references it (correct an AI mistake). For non-cover items, use
 * removeItem. Renumbers remaining items.
 *
 * @api-id API-EXP-15
 */
export async function deleteCoverItem(actor: Actor, itemId: string): Promise<void> {
  can(actor, "expedientes", "edit");
  const item = await findItemById(itemId);
  if (!item) throw new ExpedienteError("EXPEDIENTE_ITEM_NOT_FOUND");
  const expediente = await findExpedienteById(item.expediente_id);
  if (!expediente) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, expediente.case_id);
  if (!isEditableStatus(expediente.status as import("./domain").ExpedienteStatus)) {
    throw new ExpedienteError("EXPEDIENTE_NOT_EDITABLE", { status: expediente.status });
  }

  await removeItem(actor, itemId); // renumbers
  if (item.item_type === "cover" && item.ref_id) {
    const refs = await countCoverItemRefs(item.ref_id);
    if (refs === 0) await deleteCoverRender(item.ref_id).catch(() => {});
  }
}

const RegenerateCoverSchema = z.object({
  itemId: zUuid,
  title: z.string().trim().min(1).optional(),
  subtitle: z.string().trim().optional(),
  partyId: zUuid.nullable().optional(),
});

/**
 * Re-renders a cover item with corrected data (title/subtitle/party). Creates a
 * NEW cover_render (covers are immutable), repoints the item's ref_id, deletes
 * the old render if now unreferenced, and updates the item title (TOC entry).
 *
 * @api-id API-EXP-16
 */
export async function regenerateCover(
  actor: Actor,
  input: z.infer<typeof RegenerateCoverSchema>,
): Promise<CoverRenderRow> {
  can(actor, "expedientes", "edit");
  const parsed = RegenerateCoverSchema.parse(input);
  const item = await findItemById(parsed.itemId);
  if (!item) throw new ExpedienteError("EXPEDIENTE_ITEM_NOT_FOUND");
  if (item.item_type !== "cover") throw new ExpedienteError("EXPEDIENTE_ITEM_REF_INVALID", { reason: "not a cover item" });
  const expediente = await findExpedienteById(item.expediente_id);
  if (!expediente) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, expediente.case_id);
  if (!isEditableStatus(expediente.status as import("./domain").ExpedienteStatus)) {
    throw new ExpedienteError("EXPEDIENTE_NOT_EDITABLE", { status: expediente.status });
  }

  const ctx = await loadCaseCoverContext(actor, expediente.case_id);
  const templates = await listActiveCoverTemplates(actor.orgId);
  if (templates.length === 0) throw new ExpedienteError("COVER_TEMPLATE_NOT_FOUND");

  // Carry over the previous title/subtitle/template when not overridden.
  const prev = item.ref_id ? await findCoverRenderById(item.ref_id) : null;
  const prevData = (prev?.data ?? {}) as { title?: string; subtitle?: string; partyId?: string; sectionKind?: string };
  const template =
    templates.find((t) => t.id === prev?.template_id) ??
    templates.find((t) => (t.template as { style?: string }).style === "ulp-divider") ??
    templates[0];

  const selectedPartyId = parsed.partyId !== undefined ? parsed.partyId : (prevData.partyId ?? null);
  const partyName = selectedPartyId ? ctx.parties.find((p) => p.id === selectedPartyId)?.name ?? null : null;
  const title = parsed.title ?? prevData.title ?? "Cover";
  const subtitle = parsed.subtitle ?? (selectedPartyId ? (partyName ?? undefined) : prevData.subtitle);

  const newCover = await renderInsertCover(
    expediente.case_id,
    ctx,
    template,
    { title, subtitle, partyId: selectedPartyId, sectionKind: prevData.sectionKind, aiGenerated: false },
    actor.userId,
  );

  await updateItemMeta(parsed.itemId, { ref_id: newCover.id, title });

  // Drop the old render if nothing else points to it.
  if (item.ref_id && item.ref_id !== newCover.id) {
    const refs = await countCoverItemRefs(item.ref_id);
    if (refs === 0) await deleteCoverRender(item.ref_id).catch(() => {});
  }

  await writeAudit(actor, "expediente.cover_regenerated", "expediente_items", parsed.itemId, {
    after: { coverRenderId: newCover.id, title },
  });
  return newCover;
}

// ---------------------------------------------------------------------------
// autoAssembleWithAi — AI planner builds the full ordered draft (API-EXP-17)
// ---------------------------------------------------------------------------

export interface AutoAssembleResult {
  expedienteId: string;
  coversCreated: number;
  itemsCreated: number;
  /** Human-readable notes about artifacts the planner referenced but couldn't be placed. */
  unresolved: string[];
}

/**
 * Keeps only the CURRENT run per (form, party) — highest version. A case can hold
 * several completed versions of the same letter (regenerations); only the latest
 * may be filed — older briefs (and their exhibits) must never reach the case file.
 * Same "current" criterion as ai-engine's getRunsForCase.
 */
function pickCurrentRuns<T extends { formDefinitionId: string; partyId: string | null; version: number }>(
  runs: T[],
): T[] {
  const best = new Map<string, T>();
  for (const r of runs) {
    const key = `${r.formDefinitionId}:${r.partyId ?? "null"}`;
    const cur = best.get(key);
    if (!cur || r.version > cur.version) best.set(key, r);
  }
  return [...best.values()];
}

/**
 * One-click AI assembly: gathers the case context (parties, strong artifacts,
 * approved documents + translations), asks the AI planner for an ordered set of
 * sections, then renders the covers and builds the expediente_items in order
 * (per-party covers group the client docs; each doc's certified translation is
 * inserted BEFORE the original, per USCIS practice). Diana refines afterwards.
 *
 * @api-id API-EXP-17
 */
export async function autoAssembleWithAi(
  actor: Actor,
  caseId: string,
  opts?: { replace?: boolean },
): Promise<AutoAssembleResult> {
  can(actor, "expedientes", "edit");
  await requireCaseAccess(actor, caseId);

  // 1. Ensure an editable draft (reuse the existing one; replace its items only
  //    when the caller confirmed).
  let draft = await findDraftExpedienteForCase(caseId);
  if (draft) {
    const existing = await listItemsForExpediente(draft.id);
    if (existing.length > 0) {
      if (!opts?.replace) throw new ExpedienteError("EXPEDIENTE_NOT_EMPTY");
      for (const it of existing) {
        await deleteItem(it.id);
        if (it.item_type === "cover" && it.ref_id && (await countCoverItemRefs(it.ref_id)) === 0) {
          await deleteCoverRender(it.ref_id).catch(() => {});
        }
      }
    }
  } else {
    const attemptNo = (await maxAttemptNoForCase(caseId)) + 1;
    draft = await insertExpediente({ case_id: caseId, attempt_no: attemptNo, status: "draft", built_by: actor.userId });
  }

  // 2. Gather context.
  const ctx = await loadCaseCoverContext(actor, caseId);
  const [templates, docs, translations, forms, gens] = await Promise.all([
    listActiveCoverTemplates(actor.orgId),
    listApprovedDocumentsForMaterial(caseId),
    listCompletedTranslationsForCase(caseId),
    listFormResponsesForMaterial(caseId),
    listGenerationRunsForMaterial(caseId),
  ]);
  if (templates.length === 0) throw new ExpedienteError("COVER_TEMPLATE_NOT_FOUND");
  const dividerTpl =
    templates.find((t) => (t.template as { style?: string }).style === "ulp-divider") ?? templates[0];

  // Ready exhibits (auto-downloaded annexes) grouped by their memo run — inserted
  // right after each ai_generation item so the cited sources are filed behind the memo.
  const { listReadyByCase: listReadyExhibits } = await import("@/backend/modules/exhibits");
  const readyExhibits = await listReadyExhibits(caseId); // already ordered by cite_order
  const exhibitsByRun = new Map<string, typeof readyExhibits>();
  for (const ex of readyExhibits) {
    const arr = exhibitsByRun.get(ex.run_id) ?? [];
    arr.push(ex);
    exhibitsByRun.set(ex.run_id, arr);
  }

  // Only the CURRENT run per (form, party) may be filed — a case can hold several
  // completed versions of the same brief and only the latest belongs in the packet.
  const currentGens = pickCurrentRuns(gens);

  const partyName = new Map(ctx.parties.map((p) => [p.id, p.name ?? "—"]));
  const validPartyIds = new Set(ctx.parties.map((p) => p.id));
  const translationByDoc = new Map(translations.map((t) => [t.caseDocumentId, t.translationId]));
  const docById = new Map(docs.map((d) => [d.refId, d]));
  const validForm = new Set(forms.map((f) => f.refId));
  const validGen = new Set(currentGens.map((g) => g.refId));

  // 3. Ask the AI planner (via ai-engine module-pub; R3). The planner is a non-deterministic
  //    LLM call that occasionally returns output failing schema validation (observed in prod
  //    for services with no strong form — only a generated letter + documents — e.g. Reforzar
  //    Asilo). A planner failure must NEVER abort the assembly and leave an empty draft: fall
  //    back to an empty plan so the safety nets (step 5) still build a complete, canonically
  //    ordered draft from the known material. The paralegal can reorder — a deterministic
  //    draft always beats an empty draft plus an error toast.
  // Per-service canonical order (config-as-data, migration 0087). Best-effort:
  // a guidance read failure must never abort the assembly — the planner simply
  // falls back to its generic legal-order rules.
  const { getServiceAssemblyGuidance } = await import("@/backend/modules/catalog");
  const assemblyGuidance = ctx.serviceId
    ? await getServiceAssemblyGuidance(actor.orgId, ctx.serviceId).catch(() => null)
    : null;

  const { proposeExpedienteAssembly } = await import("@/backend/modules/ai-engine");
  let plan: Awaited<ReturnType<typeof proposeExpedienteAssembly>>;
  try {
    plan = await proposeExpedienteAssembly({
      caseLabel: ctx.caseNumber,
      serviceCategory: ctx.serviceLabel,
      serviceSlug: ctx.serviceSlug,
      assemblyGuidance,
      parties: ctx.parties.map((p) => ({ id: p.id, role: p.role, name: p.name ?? "—" })),
      strongDocs: [
        ...forms.map((f) => ({ kind: "automated_form" as const, id: f.refId, label: f.title, partyId: f.partyId })),
        ...currentGens.map((g) => ({ kind: "ai_generation" as const, id: g.refId, label: g.title, partyId: g.partyId })),
      ],
      documents: docs.map((d) => ({
        caseDocumentId: d.refId,
        fileName: d.displayName ?? d.originalFilename,
        partyId: d.partyId,
        requirementLabel: d.requirementLabel?.es ?? d.requirementLabel?.en ?? null,
      })),
    });
  } catch (err) {
    logger.warn(
      { err, caseId },
      "expediente.autoAssemble: AI planner failed — falling back to deterministic assembly via safety nets",
    );
    plan = { sections: [] };
  }

  // 4. Build, re-validating every id against the gathered context.
  let position = await maxItemPositionForExpediente(draft.id);
  let coversCreated = 0;
  let itemsCreated = 0;
  const unresolved: string[] = [];
  const usedDocs = new Set<string>();
  const usedStrong = new Set<string>();

  const addItemDirect = async (
    itemType: ExpedienteItemType,
    refId: string,
    title: string,
  ): Promise<void> => {
    position += 1;
    await insertItem({
      expediente_id: draft!.id,
      item_type: itemType,
      ref_id: refId,
      external_file_path: null,
      title,
      position,
      include_in_toc: true,
    });
    itemsCreated += 1;
  };

  // Inserts the ready exhibits of an AI memo run immediately after it (cite order).
  const addExhibitsForRun = async (runId: string): Promise<void> => {
    for (const ex of exhibitsByRun.get(runId) ?? []) {
      position += 1;
      await insertItem({
        expediente_id: draft!.id,
        item_type: "exhibit",
        ref_id: ex.id,
        external_file_path: null,
        title: exhibitItemTitle({ exhibitLabel: ex.exhibit_label, publisher: ex.publisher, title: ex.title }),
        position,
        include_in_toc: false, // exhibits are listed on the Index of Exhibits page, not the master TOC
      });
      itemsCreated += 1;
    }
  };

  const addDocWithTranslation = async (docId: string): Promise<void> => {
    const doc = docById.get(docId);
    if (!doc || usedDocs.has(docId)) {
      if (!doc) unresolved.push(`documento ${docId}`);
      return;
    }
    usedDocs.add(docId);
    const trId = translationByDoc.get(docId);
    if (trId) await addItemDirect("translation", trId, `Translation — ${doc.title}`); // translation BEFORE original
    await addItemDirect("client_document", docId, doc.title);
  };

  for (const section of plan.sections) {
    if (section.kind === "document") {
      const okRef =
        section.refType === "automated_form" ? validForm.has(section.refId) : validGen.has(section.refId);
      if (!okRef) {
        unresolved.push(`artefacto ${section.refType} ${section.refId}`);
        continue;
      }
      usedStrong.add(section.refId);
      const cover = await renderInsertCover(caseId, ctx, dividerTpl, { title: section.title, sectionKind: "document", aiGenerated: true }, actor.userId);
      await addItemDirect("cover", cover.id, section.title);
      coversCreated += 1;
      await addItemDirect(section.refType, section.refId, section.title);
      if (section.refType === "ai_generation") await addExhibitsForRun(section.refId);
    } else {
      // Only trust a partyId the AI returned if it belongs to this case; otherwise
      // treat the section as a generic group (null party, no subtitle) so we never
      // persist a hallucinated party reference in the cover render metadata.
      const validParty = section.kind === "party" && validPartyIds.has(section.partyId);
      const subtitle = validParty ? partyName.get(section.partyId) : undefined;
      const cover = await renderInsertCover(
        caseId,
        ctx,
        dividerTpl,
        {
          title: section.title,
          subtitle,
          partyId: validParty ? section.partyId : null,
          sectionKind: section.kind,
          aiGenerated: true,
        },
        actor.userId,
      );
      await addItemDirect("cover", cover.id, section.title);
      coversCreated += 1;
      for (const docId of section.documentIds) await addDocWithTranslation(docId);
    }
  }

  // 5. Safety net: place any strong doc / approved doc the planner didn't cover.
  const leftoverStrong = [
    ...forms.filter((f) => !usedStrong.has(f.refId)).map((f) => ({ kind: "automated_form" as const, ref: f.refId, title: f.title })),
    ...currentGens.filter((g) => !usedStrong.has(g.refId)).map((g) => ({ kind: "ai_generation" as const, ref: g.refId, title: g.title })),
  ];
  for (const s of leftoverStrong) {
    const cover = await renderInsertCover(caseId, ctx, dividerTpl, { title: s.title, sectionKind: "document", aiGenerated: true }, actor.userId);
    await addItemDirect("cover", cover.id, s.title);
    coversCreated += 1;
    await addItemDirect(s.kind, s.ref, s.title);
    if (s.kind === "ai_generation") await addExhibitsForRun(s.ref);
  }

  const leftoverDocs = docs.filter((d) => !usedDocs.has(d.refId));
  if (leftoverDocs.length > 0) {
    const cover = await renderInsertCover(caseId, ctx, dividerTpl, { title: "Additional Documents", sectionKind: "other", aiGenerated: true }, actor.userId);
    await addItemDirect("cover", cover.id, "Additional Documents");
    coversCreated += 1;
    for (const d of leftoverDocs) await addDocWithTranslation(d.refId);
  }

  await writeAudit(actor, "expediente.auto_assembled", "expedientes", draft.id, {
    after: { coversCreated, itemsCreated, unresolved },
  });

  return { expedienteId: draft.id, coversCreated, itemsCreated, unresolved };
}

/**
 * Syncs a memo run's ready exhibits into an EXISTING draft expediente, placing them
 * right after the memo's ai_generation item (cite order). Runs as system (consumed
 * from the `exhibits.run_settled` event) — handles the case where Diana already
 * assembled the draft before the exhibits finished downloading. Idempotent: skips
 * exhibits already present. No-op if there is no draft or the memo isn't in it yet
 * (then autoAssembleWithAi includes them at assembly time).
 */
export async function attachReadyExhibits(input: {
  caseId: string;
  runId: string;
}): Promise<{ inserted: number }> {
  const draft = await findDraftExpedienteForCase(input.caseId);
  if (!draft) return { inserted: 0 };

  const items = await listItemsForExpediente(draft.id); // ordered by position
  const memo = items.find((i) => i.item_type === "ai_generation" && i.ref_id === input.runId);
  if (!memo) return { inserted: 0 };

  const { listReadyByCase } = await import("@/backend/modules/exhibits");
  const ready = (await listReadyByCase(input.caseId)).filter((e) => e.run_id === input.runId);
  const existingRefs = new Set(
    items.filter((i) => i.item_type === "exhibit").map((i) => i.ref_id),
  );
  const toAdd = ready.filter((e) => !existingRefs.has(e.id)); // already cite-order sorted
  if (toAdd.length === 0) return { inserted: 0 };

  // 1. Append the new exhibit items (positions fixed in step 2).
  let pos = await maxItemPositionForExpediente(draft.id);
  const newIds: string[] = [];
  for (const ex of toAdd) {
    pos += 1;
    const row = await insertItem({
      expediente_id: draft.id,
      item_type: "exhibit",
      ref_id: ex.id,
      external_file_path: null,
      title: exhibitItemTitle({ exhibitLabel: ex.exhibit_label, publisher: ex.publisher, title: ex.title }),
      position: pos,
      include_in_toc: false, // exhibits are listed on the Index of Exhibits page, not the master TOC
    });
    newIds.push(row.id);
  }

  // 2. Reorder so the new exhibits sit right after the memo (negative-position trick,
  //    mirrors reorderItems — the deferrable unique(position) isn't batched by the client).
  const orderedIds = placeExhibitsAfterMemo(
    items.map((i) => ({ id: i.id, itemType: i.item_type })),
    memo.id,
    newIds,
  );
  for (let i = 0; i < orderedIds.length; i++) await updateItemPosition(orderedIds[i], -(i + 1) * 1000);
  for (let i = 0; i < orderedIds.length; i++) await updateItemPosition(orderedIds[i], i + 1);

  return { inserted: newIds.length };
}

// ---------------------------------------------------------------------------
// ENSAMBLADOR — expediente reads
// ---------------------------------------------------------------------------

/**
 * Lists all expediente attempts for a case (DESC attempt_no).
 *
 * @api-id API-EXP-03
 */
export async function getCaseExpedientes(
  actor: Actor,
  caseId: string,
): Promise<ExpedienteRow[]> {
  can(actor, "expedientes", "view");
  await requireCaseAccess(actor, caseId);
  return listExpedientesForCase(caseId);
}

export interface ExpedienteWithItems {
  expediente: ExpedienteRow;
  items: ExpedienteItemRow[];
}

/**
 * Returns an expediente with its ordered items.
 *
 * @api-id API-EXP-04
 */
export async function getExpediente(
  actor: Actor,
  expedienteId: string,
): Promise<ExpedienteWithItems> {
  can(actor, "expedientes", "view");
  const expediente = await findExpedienteById(expedienteId);
  if (!expediente) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, expediente.case_id);
  const items = await listItemsForExpediente(expedienteId);
  return { expediente, items };
}

const CreateExpedienteSchema = z.object({
  caseId: zUuid,
});

export type CreateExpedienteInput = z.infer<typeof CreateExpedienteSchema>;

/**
 * Creates a new draft expediente for a case.
 *
 * - attempt_no = max(existing) + 1 (or 1 if none)
 * - Throws EXPEDIENTE_DRAFT_EXISTS if a draft already exists (one draft per case)
 *
 * @api-id API-EXP-05
 */
export async function createExpediente(
  actor: Actor,
  input: CreateExpedienteInput,
): Promise<ExpedienteRow> {
  can(actor, "expedientes", "edit");
  const parsed = CreateExpedienteSchema.parse(input);
  await requireCaseAccess(actor, parsed.caseId);

  // One draft per case guard (enforced by DB partial unique index too)
  const existingDraft = await findDraftExpedienteForCase(parsed.caseId);
  if (existingDraft) {
    throw new ExpedienteError("EXPEDIENTE_DRAFT_EXISTS", {
      existingId: existingDraft.id,
    });
  }

  const maxAttempt = await maxAttemptNoForCase(parsed.caseId);
  const attemptNo = maxAttempt + 1;

  const row = await insertExpediente({
    case_id: parsed.caseId,
    attempt_no: attemptNo,
    status: "draft",
    built_by: actor.userId,
  });

  await writeAudit(actor, "expediente.created", "expedientes", row.id, {
    after: { caseId: parsed.caseId, attemptNo },
  });

  // No event on creation — `expediente.compiled` is emitted ONLY by compileExpediente.

  return row;
}

export interface ExpedienteMaterial {
  covers: Array<{ refId: string; title: string; createdAt: string }>;
  generations: Array<{ refId: string; title: string; createdAt: string }>;
  forms: Array<{ refId: string; title: string; createdAt: string }>;
  documents: Array<{ refId: string; title: string; createdAt: string }>;
}

/**
 * Returns the library of addable items for a case, grouped by type.
 *
 * @api-id API-EXP-06
 */
export async function getExpedienteMaterial(
  actor: Actor,
  caseId: string,
): Promise<ExpedienteMaterial> {
  can(actor, "expedientes", "view");
  await requireCaseAccess(actor, caseId);

  const [covers, generations, forms, documents] = await Promise.all([
    listCoverRendersForMaterial(caseId),
    listGenerationRunsForMaterial(caseId),
    listFormResponsesForMaterial(caseId),
    listApprovedDocumentsForMaterial(caseId),
  ]);

  // Same rule as autoAssembleWithAi: only the CURRENT run per (form, party) is
  // addable material — superseded letter versions must not be filed by hand either.
  const currentGenerations = pickCurrentRuns(generations);

  return {
    covers: covers.map((c) => ({ refId: c.refId, title: c.title, createdAt: c.createdAt })),
    generations: currentGenerations.map((g) => ({ refId: g.refId, title: g.title, createdAt: g.createdAt })),
    forms: forms.map((f) => ({ refId: f.refId, title: f.title, createdAt: f.createdAt })),
    documents: documents.map((d) => ({ refId: d.refId, title: d.title, createdAt: d.createdAt })),
  };
}

// ---------------------------------------------------------------------------
// ENSAMBLADOR — item mutations
// ---------------------------------------------------------------------------

const AddItemSchema = z.object({
  expedienteId: zUuid,
  itemType: z.enum(["cover", "ai_generation", "automated_form", "client_document", "translation", "external_file", "exhibit"]),
  refId: zUuid.nullable().optional(),
  externalFilePath: z.string().min(1).nullable().optional(),
  title: z.string().min(1),
  includeInToc: z.boolean().optional(),
});

export type AddItemInput = z.infer<typeof AddItemSchema>;

/**
 * Adds an item to an expediente.
 *
 * Validates the logical FK (ref_id → source table) per itemType.
 * Rejects if expediente is not in an editable status (draft or corrections_needed).
 *
 * @api-id API-EXP-07
 */
export async function addItem(
  actor: Actor,
  input: AddItemInput,
): Promise<ExpedienteItemRow> {
  can(actor, "expedientes", "edit");
  const parsed = AddItemSchema.parse(input);

  const expediente = await findExpedienteById(parsed.expedienteId);
  if (!expediente) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, expediente.case_id);

  if (!isEditableStatus(expediente.status as import("./domain").ExpedienteStatus)) {
    throw new ExpedienteError("EXPEDIENTE_NOT_EDITABLE", { status: expediente.status });
  }

  // Pure shape validation
  const shapeCheck = validateItemRef(
    parsed.itemType as ExpedienteItemType,
    parsed.refId ?? null,
    parsed.externalFilePath ?? null,
  );
  if (!shapeCheck.ok) {
    throw new ExpedienteError("EXPEDIENTE_ITEM_REF_INVALID", { reason: shapeCheck.reason });
  }

  // Logical FK validation (verify the referenced row exists)
  await validateLogicalFk(parsed.itemType as ExpedienteItemType, parsed.refId ?? null);

  const maxPos = await maxItemPositionForExpediente(parsed.expedienteId);
  const position = maxPos + 1;

  const row = await insertItem({
    expediente_id: parsed.expedienteId,
    item_type: parsed.itemType,
    ref_id: parsed.refId ?? null,
    external_file_path: parsed.externalFilePath ?? null,
    title: parsed.title,
    position,
    include_in_toc: parsed.includeInToc ?? true,
  });

  await writeAudit(actor, "expediente.item_added", "expediente_items", row.id, {
    after: { expedienteId: parsed.expedienteId, itemType: parsed.itemType, title: parsed.title },
  });

  return row;
}

/**
 * Validates the logical FK by checking the referenced source row exists.
 * Throws ExpedienteError("EXPEDIENTE_ITEM_REF_INVALID") if not found.
 */
async function validateLogicalFk(
  itemType: ExpedienteItemType,
  refId: string | null,
): Promise<void> {
  if (itemType === "external_file") return; // no refId for external files

  if (!refId) {
    throw new ExpedienteError("EXPEDIENTE_ITEM_REF_INVALID", {
      reason: `${itemType} requires a refId`,
    });
  }

  switch (itemType) {
    case "cover": {
      const exists = await verifyCoverRenderExists(refId);
      if (!exists) throw new ExpedienteError("EXPEDIENTE_ITEM_REF_INVALID", { itemType, refId });
      break;
    }
    case "ai_generation": {
      const run = await findGenerationRunById(refId);
      if (!run) throw new ExpedienteError("EXPEDIENTE_ITEM_REF_INVALID", { itemType, refId });
      // A mailing cover ("Carátula de Envío") is prepended before the index at compile
      // time and excluded from the body — it must NEVER be a reorderable body item, or
      // it would double-file (once unstamped in front, once inside the Bates/TOC body).
      if (await isMailingCoverForm(run.form_definition_id)) {
        throw new ExpedienteError("EXPEDIENTE_ITEM_REF_INVALID", { itemType, refId, reason: "mailing_cover" });
      }
      break;
    }
    case "automated_form": {
      const form = await findFormResponseById(refId);
      if (!form) throw new ExpedienteError("EXPEDIENTE_ITEM_REF_INVALID", { itemType, refId });
      break;
    }
    case "client_document": {
      const doc = await findCaseDocumentById(refId);
      if (!doc) throw new ExpedienteError("EXPEDIENTE_ITEM_REF_INVALID", { itemType, refId });
      break;
    }
    case "translation": {
      const tr = await findTranslationById(refId);
      if (!tr) throw new ExpedienteError("EXPEDIENTE_ITEM_REF_INVALID", { itemType, refId });
      break;
    }
    case "exhibit": {
      const ex = await findExhibitById(refId);
      // Only a downloaded ('ready') or hand-uploaded ('manual') exhibit can be filed.
      if (!ex || (ex.status !== "ready" && ex.status !== "manual")) {
        throw new ExpedienteError("EXPEDIENTE_ITEM_REF_INVALID", { itemType, refId });
      }
      break;
    }
  }
}

/**
 * Removes an item from an expediente.
 * Renumbers remaining items to keep positions contiguous.
 *
 * @api-id API-EXP-08
 */
export async function removeItem(
  actor: Actor,
  itemId: string,
): Promise<void> {
  can(actor, "expedientes", "edit");
  const parsed = z.object({ itemId: zUuid }).parse({ itemId });

  const item = await findItemById(parsed.itemId);
  if (!item) throw new ExpedienteError("EXPEDIENTE_ITEM_NOT_FOUND");

  const expediente = await findExpedienteById(item.expediente_id);
  if (!expediente) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, expediente.case_id);

  if (!isEditableStatus(expediente.status as import("./domain").ExpedienteStatus)) {
    throw new ExpedienteError("EXPEDIENTE_NOT_EDITABLE", { status: expediente.status });
  }

  await deleteItem(parsed.itemId);

  // Renumber remaining items to keep positions contiguous
  const remaining = await listItemsForExpediente(item.expediente_id);
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].position !== i + 1) {
      await updateItemPosition(remaining[i].id, i + 1);
    }
  }

  await writeAudit(actor, "expediente.item_removed", "expediente_items", parsed.itemId, {
    before: { expedienteId: item.expediente_id, title: item.title },
  });
}

const ReorderItemsSchema = z.object({
  expedienteId: zUuid,
  orderedItemIds: z.array(zUuid).min(1),
});

export type ReorderItemsInput = z.infer<typeof ReorderItemsSchema>;

/**
 * Reorders items by setting positions from the provided ordered array.
 *
 * Uses the deferrable unique constraint (expediente_id, position) to allow
 * position swaps within the same transaction-ish sequence.
 *
 * @api-id API-EXP-09
 */
export async function reorderItems(
  actor: Actor,
  input: ReorderItemsInput,
): Promise<void> {
  can(actor, "expedientes", "edit");
  const parsed = ReorderItemsSchema.parse(input);

  const expediente = await findExpedienteById(parsed.expedienteId);
  if (!expediente) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, expediente.case_id);

  if (!isEditableStatus(expediente.status as import("./domain").ExpedienteStatus)) {
    throw new ExpedienteError("EXPEDIENTE_NOT_EDITABLE", { status: expediente.status });
  }

  // Update each item's position sequentially (the deferrable unique constraint
  // is DEFERRED INITIALLY DEFERRED so intermediate violations are OK within a TX,
  // but the JS client doesn't batch these into a true single TX; we use an
  // intermediate negative position trick to avoid conflicts).
  //
  // Step 1: Set all positions to large negatives (no constraint violations because
  //         they're all unique negative values)
  for (let i = 0; i < parsed.orderedItemIds.length; i++) {
    await updateItemPosition(parsed.orderedItemIds[i], -(i + 1) * 1000);
  }
  // Step 2: Set final positions
  for (let i = 0; i < parsed.orderedItemIds.length; i++) {
    await updateItemPosition(parsed.orderedItemIds[i], i + 1);
  }

  await writeAudit(actor, "expediente.items_reordered", "expedientes", parsed.expedienteId, {
    after: { orderedItemIds: parsed.orderedItemIds },
  });
}

const UpdateItemSchema = z.object({
  itemId: zUuid,
  title: z.string().min(1).optional(),
  includeInToc: z.boolean().optional(),
});

export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;

/**
 * Updates an item's title or includeInToc flag.
 *
 * @api-id API-EXP-10
 */
export async function updateItem(
  actor: Actor,
  input: UpdateItemInput,
): Promise<void> {
  can(actor, "expedientes", "edit");
  const parsed = UpdateItemSchema.parse(input);

  const item = await findItemById(parsed.itemId);
  if (!item) throw new ExpedienteError("EXPEDIENTE_ITEM_NOT_FOUND");

  const expediente = await findExpedienteById(item.expediente_id);
  if (!expediente) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, expediente.case_id);

  if (!isEditableStatus(expediente.status as import("./domain").ExpedienteStatus)) {
    throw new ExpedienteError("EXPEDIENTE_NOT_EDITABLE", { status: expediente.status });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.title !== undefined) patch.title = parsed.title;
  if (parsed.includeInToc !== undefined) patch.include_in_toc = parsed.includeInToc;

  if (Object.keys(patch).length > 0) {
    await updateItemMeta(parsed.itemId, patch);
  }

  await writeAudit(actor, "expediente.item_updated", "expediente_items", parsed.itemId, {
    after: patch,
  });
}

// ---------------------------------------------------------------------------
// External file upload (2-step: URL → confirm)
// ---------------------------------------------------------------------------

const CreateExternalFileUploadUrlSchema = z.object({
  expedienteId: zUuid,
  filename: z.string().min(1),
});

export type CreateExternalFileUploadUrlInput = z.infer<
  typeof CreateExternalFileUploadUrlSchema
>;

/**
 * Step 1: creates a signed upload URL for an external file attached to an expediente.
 *
 * @api-id API-EXP-11a
 */
export async function createExternalFileUploadUrl(
  actor: Actor,
  input: CreateExternalFileUploadUrlInput,
): Promise<{ signedUrl: string; path: string }> {
  can(actor, "expedientes", "edit");
  const parsed = CreateExternalFileUploadUrlSchema.parse(input);

  const expediente = await findExpedienteById(parsed.expedienteId);
  if (!expediente) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, expediente.case_id);

  if (!isEditableStatus(expediente.status as import("./domain").ExpedienteStatus)) {
    throw new ExpedienteError("EXPEDIENTE_NOT_EDITABLE", { status: expediente.status });
  }

  const safeFilename = parsed.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `external/${expediente.case_id}/${crypto.randomUUID()}-${safeFilename}`;
  return createSignedUploadUrl("expedientes", path);
}

const ConfirmExternalFileSchema = z.object({
  expedienteId: zUuid,
  path: z.string().min(1),
  title: z.string().min(1),
});

export type ConfirmExternalFileInput = z.infer<typeof ConfirmExternalFileSchema>;

/**
 * Step 2: validates the uploaded external file and adds it as an expediente item.
 *
 * @api-id API-EXP-11b
 */
export async function confirmExternalFile(
  actor: Actor,
  input: ConfirmExternalFileInput,
): Promise<ExpedienteItemRow> {
  can(actor, "expedientes", "edit");
  const parsed = ConfirmExternalFileSchema.parse(input);

  const expediente = await findExpedienteById(parsed.expedienteId);
  if (!expediente) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, expediente.case_id);

  if (!isEditableStatus(expediente.status as import("./domain").ExpedienteStatus)) {
    throw new ExpedienteError("EXPEDIENTE_NOT_EDITABLE", { status: expediente.status });
  }

  // Path-prefix guard (CRITICAL): the path must live under this case's external/
  // prefix — otherwise a caller could attach another case's object (e.g. a compiled
  // expediente at `case/{otherCaseId}/…`) from the same bucket and leak it on compile.
  const expectedPrefix = `external/${expediente.case_id}/`;
  if (!parsed.path.startsWith(expectedPrefix)) {
    throw new ExpedienteError("EXTERNAL_FILE_UPLOAD_INVALID", { reason: "path_prefix" });
  }

  // Validate the uploaded object exists and is a valid PDF
  const validated = await validateUploadedObject("expedientes", parsed.path, "expedientes");
  if (!validated.ok) {
    throw new ExpedienteError("EXTERNAL_FILE_UPLOAD_INVALID", {
      reason: validated.reason,
    });
  }

  return addItem(actor, {
    expedienteId: parsed.expedienteId,
    itemType: "external_file",
    externalFilePath: parsed.path,
    title: parsed.title,
    includeInToc: true,
  });
}

// ---------------------------------------------------------------------------
// COMPILATION
// ---------------------------------------------------------------------------

/**
 * Compiles all items of an expediente into a single PDF.
 *
 * Steps:
 * 1. Load expediente (must be draft or corrections_needed)
 * 2. Set status = 'compiling'
 * 3. Load ordered items, resolve each item's bytes from storage
 * 4. Call compileExpedientePdf(items)
 * 5. Upload compiled PDF to 'expedientes' bucket
 * 6. Update expediente (status='compiled', compiled_pdf_path, page_count)
 * 7. Update each item's page_count from the TOC
 * 8. Emit expediente.compiled event
 * 9. On ANY error: set status='compile_failed', rethrow as EXPEDIENTE_COMPILE_FAILED
 *
 * Runs SYNCHRONOUSLY (no QStash in dev) — a job wrapper can call this later.
 *
 * @api-id API-EXP-12
 */
export async function compileExpediente(
  actor: Actor,
  expedienteId: string,
): Promise<{ compiledPdfPath: string; pageCount: number }> {
  can(actor, "expedientes", "edit");

  const expediente = await findExpedienteById(expedienteId);
  if (!expediente) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, expediente.case_id);

  const editableForCompile =
    expediente.status === "draft" || expediente.status === "corrections_needed";
  if (!editableForCompile) {
    throw new ExpedienteError("EXPEDIENTE_NOT_COMPILABLE", { status: expediente.status });
  }

  // Set status = compiling immediately so concurrent attempts are visible
  await updateExpediente(expedienteId, { status: "compiling" });

  try {
    const items = await listItemsForExpediente(expedienteId);

    // Resolve each item's bytes from storage
    const resolvedItems: Array<ExpedienteItemInput & { itemId: string }> = [];
    for (const item of items) {
      const { bytes, mimeType } = await resolveItemBytes(item);
      resolvedItems.push({
        itemId: item.id,
        bytes,
        mimeType,
        title: item.title,
        includeInToc: item.include_in_toc,
      });
    }

    // Formal court structure: a single "Index of Exhibits" divider page is inserted
    // right before the first exhibit (rendered fresh from the exhibits actually filed,
    // so it never goes stale); the exhibits themselves are kept OUT of the master TOC
    // (they are listed on that page, not duplicated as top-level entries).
    const exhibitRefIds = items
      .filter((it) => it.item_type === "exhibit" && it.ref_id)
      .map((it) => it.ref_id as string);
    const compileInput: ExpedienteItemInput[] = [];
    let exhibitIndexInserted = false;
    for (let k = 0; k < items.length; k++) {
      const isExhibit = items[k].item_type === "exhibit";
      if (isExhibit && !exhibitIndexInserted && exhibitRefIds.length > 0) {
        const { renderExhibitIndexForExhibits } = await import("@/backend/modules/exhibits");
        const indexBytes = await renderExhibitIndexForExhibits(exhibitRefIds);
        compileInput.push({
          bytes: indexBytes,
          mimeType: "application/pdf",
          title: "Index of Exhibits",
          includeInToc: true,
        });
        exhibitIndexInserted = true;
      }
      compileInput.push({
        bytes: resolvedItems[k].bytes,
        mimeType: resolvedItems[k].mimeType,
        title: resolvedItems[k].title,
        includeInToc: isExhibit ? false : resolvedItems[k].includeInToc,
      });
    }

    let result = await compileExpedientePdf(compileInput);

    // Prepend the mailing cover ("Carátula de Envío") as the UNNUMBERED first sheet,
    // BEFORE the index — a mailing front sheet, not a filed page: the compiled
    // package (index + Bates USALP-000x) is already stamped, so grafting the cover
    // in front leaves the legal foliation untouched. Best-effort: a fetch/render
    // failure logs and compiles without it rather than failing the whole package.
    const coverBytes = await loadLatestMailingCoverPdf(expediente.case_id);
    if (coverBytes) {
      try {
        const { prependPdfPages, countPdfPages } = await import("@/backend/platform/pdf");
        const coverPages = await countPdfPages(coverBytes);
        const mergedPdf = await prependPdfPages(coverBytes, result.pdf);
        result = { ...result, pdf: mergedPdf, pageCount: result.pageCount + coverPages };
      } catch (coverErr) {
        logger.warn(
          { err: coverErr, caseId: expediente.case_id },
          "expediente.compile: mailing cover prepend failed — compiling without it",
        );
      }
    }

    const compiledPdfPath = `case/${expediente.case_id}/${expedienteId}-a${expediente.attempt_no}.pdf`;
    await uploadBytesToStorage(
      "expedientes",
      compiledPdfPath,
      result.pdf,
      "application/pdf",
    );

    await updateExpediente(expedienteId, {
      status: "compiled",
      compiled_pdf_path: compiledPdfPath,
      page_count: result.pageCount,
    });

    // Persist per-item page counts from TOC
    for (const tocEntry of result.toc) {
      const matched = resolvedItems.find((ri) => ri.title === tocEntry.title);
      if (matched) {
        await updateItemPageCount(matched.itemId, tocEntry.pageCount).catch((err) => {
          logger.warn(
            { err, itemId: matched.itemId },
            "expediente.compile: failed to update item page_count — non-fatal",
          );
        });
      }
    }

    await writeAudit(actor, "expediente.compiled", "expedientes", expedienteId, {
      after: { compiledPdfPath, pageCount: result.pageCount },
    });

    emitExpedienteCompiled({
      caseId: expediente.case_id,
      expedienteId,
      attemptNo: expediente.attempt_no,
    });

    return { compiledPdfPath, pageCount: result.pageCount };
  } catch (err) {
    // On any error: mark as compile_failed, then rethrow
    await updateExpediente(expedienteId, { status: "compile_failed" }).catch((updateErr) => {
      logger.error(
        { updateErr, expedienteId },
        "expediente.compile: also failed to set compile_failed status",
      );
    });

    const isAlreadyDomainError = err instanceof ExpedienteError;
    if (!isAlreadyDomainError) {
      logger.error({ err, expedienteId }, "expediente.compile: compilation failed");
    }

    throw new ExpedienteError("EXPEDIENTE_COMPILE_FAILED", {
      originalError: (err as Error).message,
    });
  }
}

/**
 * Internal helper: downloads item bytes from the appropriate storage bucket.
 */
async function resolveItemBytes(
  item: ExpedienteItemRow,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  // Dynamic import to avoid pulling Supabase storage client at module load time
  const { createServiceClient } = await import("@/backend/platform/supabase");
  const storage = createServiceClient().storage;

  let bucket: string;
  let path: string;
  const mimeType = "application/pdf"; // all source items produce PDF

  switch (item.item_type) {
    case "cover": {
      // cover_renders → 'generated' bucket, pdf_path stored in cover_renders
      const render = await import("./repository").then((r) =>
        r.findCoverRenderById(item.ref_id!),
      );
      if (!render) throw new Error(`cover render not found: ${item.ref_id}`);
      bucket = "generated";
      path = render.pdf_path;
      break;
    }
    case "ai_generation": {
      // ai_generation_runs → 'generated' bucket, output_path
      const run = await findGenerationRunById(item.ref_id!);
      if (!run || !run.output_path)
        throw new Error(`generation run not found or has no output: ${item.ref_id}`);
      bucket = "generated";
      path = run.output_path;
      break;
    }
    case "automated_form": {
      // case_form_responses → 'generated' bucket, filled_pdf_path
      const form = await findFormResponseById(item.ref_id!);
      if (!form || !form.filled_pdf_path)
        throw new Error(`form response not found or has no PDF: ${item.ref_id}`);
      bucket = "generated";
      path = form.filled_pdf_path;
      break;
    }
    case "client_document": {
      // case_documents → 'case-documents' bucket, storage_path
      const doc = await findCaseDocumentById(item.ref_id!);
      if (!doc) throw new Error(`case document not found: ${item.ref_id}`);
      bucket = "case-documents";
      path = doc.storage_path;
      break;
    }
    case "external_file": {
      // External files → 'expedientes' bucket, external_file_path column
      if (!item.external_file_path)
        throw new Error(`external_file item has no external_file_path: ${item.id}`);
      bucket = "expedientes";
      path = item.external_file_path;
      break;
    }
    case "translation": {
      // document_translations → 'generated' bucket, translated_pdf_path
      const tr = await findTranslationById(item.ref_id!);
      if (!tr || !tr.translated_pdf_path)
        throw new Error(`translation not found or has no PDF: ${item.ref_id}`);
      bucket = "generated";
      path = tr.translated_pdf_path;
      break;
    }
    case "exhibit": {
      // case_exhibits → 'expedientes' bucket, pdf_path (downloaded/rendered source)
      const ex = await findExhibitById(item.ref_id!);
      if (!ex || !ex.pdf_path)
        throw new Error(`exhibit not found or not fetched: ${item.ref_id}`);
      bucket = "expedientes";
      path = ex.pdf_path;
      break;
    }
    default:
      throw new Error(`unknown item_type: ${item.item_type}`);
  }

  const { data, error } = await storage.from(bucket).download(path);
  if (error || !data) {
    throw new Error(`failed to download ${bucket}/${path}: ${error?.message}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  let bytes: Uint8Array = new Uint8Array(arrayBuffer);

  // Person-uploaded PDFs (client documents, external files) may be Acrobat-filled forms
  // that lost their appearance streams in a merge tool (e.g. iLovePDF): the field VALUES
  // survive but NeedAppearances is unset, so pdfium/printers/mupdf render them BLANK
  // (only Acrobat regenerates them, which is why the client sees them filled). Normalize
  // appearances so the values print. No-op for scans and our own generated PDFs. The
  // items WE generate (ai_generation, automated_form, translation, cover) are already
  // rendered/baked correctly, so they skip this pass. See docs/_evidence/asilo-blanco-xfa/.
  if (item.item_type === "client_document" || item.item_type === "external_file") {
    bytes = await flattenAcroAppearances(bytes);
  }

  return { bytes, mimeType };
}

// ---------------------------------------------------------------------------
// listPrintQueue — Andrium's print queue (API-EXP-18, RF-AND-023)
// ---------------------------------------------------------------------------

export interface PrintQueueItemDto {
  expedienteId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  serviceLabel: { es: string; en: string } | null;
  attemptNo: number;
  pageCount: number | null;
  status: string;
  sentToFinanceAt: string | null;
  sentByName: string | null;
  withLawyer: boolean;
  shippedAt: string | null;
  filedAt: string | null;
  trackingRef: string | null;
  hasPdf: boolean;
}

/**
 * Returns the print queue for Andrium — expedientes with status in
 * {sent_to_finance, printed} ordered by sent_to_finance_at ASC.
 *
 * RF-AND-023/024 / DOC-45 §3.9 / API-EXP-18.
 */
export async function listPrintQueue(
  actor: Actor,
  input?: { status?: string },
): Promise<PrintQueueItemDto[]> {
  can(actor, "printing", "view");
  return repoPrintQueue(actor.orgId, input?.status);
}

/**
 * Per-case expediente attempt history for the Andrium print panel — staff names
 * resolved + lawyer verdict (API-EXP-20, RF-AND-027). Org-scoped (printing:view).
 */
export async function getPrintHistory(
  actor: Actor,
  caseId: string,
): Promise<PrintHistoryAttemptRepo[]> {
  can(actor, "printing", "view");
  return repoPrintHistory(actor.orgId, caseId);
}

/**
 * Returns a signed download URL for the compiled expediente PDF.
 *
 * @api-id API-EXP-13
 */
export async function getCompiledPdfUrl(
  actor: Actor,
  expedienteId: string,
): Promise<string> {
  can(actor, "expedientes", "view");
  const expediente = await findExpedienteById(expedienteId);
  if (!expediente) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, expediente.case_id);

  if (!expediente.compiled_pdf_path) {
    throw new ExpedienteError("EXPEDIENTE_NOT_COMPILED", { status: expediente.status });
  }

  return createSignedDownloadUrl("expedientes", expediente.compiled_pdf_path);
}

// ---------------------------------------------------------------------------
// CORRECTIONS
// ---------------------------------------------------------------------------

/**
 * Creates a new expediente attempt as a correction cycle.
 *
 * - Source must be status='corrections_needed'
 * - New attempt: attempt_no+1, status='draft', built_by=actor.userId
 * - Clones all items from the source (immutable — prior attempt stays)
 *
 * @api-id API-EXP-14
 */
export async function createCorrectionAttempt(
  actor: Actor,
  expedienteId: string,
): Promise<ExpedienteRow> {
  can(actor, "expedientes", "edit");

  const source = await findExpedienteById(expedienteId);
  if (!source) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, source.case_id);

  if (source.status !== "corrections_needed") {
    throw new ExpedienteError("EXPEDIENTE_NOT_EDITABLE", {
      status: source.status,
      reason: "Source must be corrections_needed to create a correction attempt",
    });
  }

  const newAttemptNo = source.attempt_no + 1;

  const newExpediente = await insertExpediente({
    case_id: source.case_id,
    attempt_no: newAttemptNo,
    status: "draft",
    built_by: actor.userId,
  });

  // Clone all items from the source attempt (deep copy — same ref_id/path)
  const sourceItems = await listItemsForExpediente(expedienteId);
  for (const item of sourceItems) {
    await insertItem({
      expediente_id: newExpediente.id,
      item_type: item.item_type,
      ref_id: item.ref_id,
      external_file_path: item.external_file_path,
      title: item.title,
      position: item.position,
      include_in_toc: item.include_in_toc,
    });
  }

  await writeAudit(actor, "expediente.correction_attempt_created", "expedientes", newExpediente.id, {
    after: {
      sourceExpedienteId: expedienteId,
      newAttemptNo,
      clonedItemCount: sourceItems.length,
    },
  });

  // A correction attempt is a fresh DRAFT — not compiled. No `expediente.compiled` event.

  return newExpediente;
}

/**
 * Marks a compiled expediente as "Listo" (ready) — Diana finalized it and it is
 * ready to be handed off. Plan-INdependent: where it goes next (Andrium for `self`,
 * or the lawyer for `with_lawyer`) is decided at the case handoff
 * (handoffCaseFromLegal), not here. Does NOT send to Andrium / emit any event.
 *
 * Gate: can(actor,'expedientes','edit'); status must be 'compiled'.
 *
 * @api-id API-EXP-15b
 */
export async function markExpedienteReady(
  actor: Actor,
  expedienteId: string,
): Promise<void> {
  can(actor, "expedientes", "edit");

  const expediente = await findExpedienteById(expedienteId);
  if (!expediente) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, expediente.case_id);

  if (expediente.status !== "compiled") {
    throw new ExpedienteError("EXPEDIENTE_NOT_COMPILED", { status: expediente.status });
  }

  await updateExpediente(expedienteId, { status: "ready" });

  await writeAudit(actor, "expediente.marked_ready", "expedientes", expedienteId, {
    after: { status: "ready", caseId: expediente.case_id },
  });
}

// ---------------------------------------------------------------------------
// HANDOFF TO ANDRIUM (printing queue)
// ---------------------------------------------------------------------------

/**
 * Sends the current expediente to Andrium's print queue.
 *
 * RF-DIA-044 / §3.8 — "sendToFinance" (finance = Andrium's queue).
 *
 * Gates:
 *  - can(actor, 'expedientes', 'edit')
 *  - Plan with_lawyer: expediente.status must be 'approved' (lawyer verdict)
 *  - Plan self:        expediente.status must be 'ready' (Diana marked "Listo")
 *  - Already 'sent_to_finance' or later: blocked (EXPEDIENTE_ALREADY_SENT_TO_FINANCE)
 *
 * NOTE: no longer a Diana-facing button — called by handoffCaseFromLegal (self, at
 * the Traspaso) and by the lawyer-verdict handler (with_lawyer, auto on approval).
 *
 * @api-id API-EXP-15
 */
export async function sendToFinance(
  actor: Actor,
  input: { caseId: string; expedienteId: string },
): Promise<void> {
  can(actor, "expedientes", "edit");

  const expediente = await findExpedienteById(input.expedienteId);
  if (!expediente) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, expediente.case_id);

  // Block if already in print flow
  if (expediente.status === "sent_to_finance" || expediente.status === "printed") {
    throw new ExpedienteError("EXPEDIENTE_ALREADY_SENT_TO_FINANCE", {
      status: expediente.status,
    });
  }

  // Determine required status based on plan: self hands off from 'ready' (Diana
  // marked "Listo"); with_lawyer from 'approved' (lawyer verdict).
  const requiresLawyerValidation = await findCasePlanRequiresLawyerValidation(input.caseId);
  const requiredStatus = requiresLawyerValidation ? "approved" : "ready";

  if (expediente.status !== requiredStatus) {
    throw new ExpedienteError(
      requiresLawyerValidation ? "EXPEDIENTE_NOT_APPROVED" : "EXPEDIENTE_NOT_READY",
      { status: expediente.status, required: requiredStatus },
    );
  }

  await updateExpediente(input.expedienteId, {
    status: "sent_to_finance",
    sent_to_finance_at: new Date().toISOString(),
    sent_to_finance_by: actor.userId,
  });

  emitExpedienteSentToFinance({
    caseId: input.caseId,
    expedienteId: input.expedienteId,
    attemptNo: expediente.attempt_no,
    orgId: actor.orgId,
  });

  await writeAudit(actor, "expediente.sent_to_finance", "expedientes", input.expedienteId, {
    after: { status: "sent_to_finance", caseId: input.caseId },
  });
}

/**
 * System (no-actor) auto-handoff of an APPROVED expediente to Andrium — called by
 * the lawyer-verdict webhook (with_lawyer plan): when the lawyer validates, the
 * approved expediente flows straight to Andrium without a Diana action (Henry's
 * flow). Mirrors sendToFinance's effects (status → sent_to_finance + the
 * `expediente.sent_to_finance` event that advances legal→operations) minus the
 * actor gate. Idempotent: no-op unless status is exactly 'approved'.
 */
export async function sendToFinanceSystem(input: {
  caseId: string;
  expedienteId: string;
  orgId: string;
}): Promise<void> {
  const expediente = await findExpedienteById(input.expedienteId);
  if (!expediente) return;
  if (expediente.status !== "approved") return; // only the lawyer-approved path; idempotent

  await updateExpediente(input.expedienteId, {
    status: "sent_to_finance",
    sent_to_finance_at: new Date().toISOString(),
    sent_to_finance_by: null,
  });

  emitExpedienteSentToFinance({
    caseId: input.caseId,
    expedienteId: input.expedienteId,
    attemptNo: expediente.attempt_no,
    orgId: input.orgId,
  });
}

/**
 * Marks an expediente as physically printed by Andrium.
 *
 * RF-AND-025 / §3.9
 *
 * Gates:
 *  - can(actor, 'printing', 'edit')
 *  - status must be 'sent_to_finance' (EXPEDIENTE_NOT_IN_PRINT_QUEUE)
 *  - compiled_pdf_path must exist (COMPILE_SOURCE_MISSING)
 *
 * @api-id API-EXP-16
 */
export async function markPrinted(
  actor: Actor,
  expedienteId: string,
): Promise<void> {
  can(actor, "printing", "edit");

  const expediente = await findExpedienteById(expedienteId);
  if (!expediente) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, expediente.case_id);

  if (expediente.status !== "sent_to_finance") {
    throw new ExpedienteError("EXPEDIENTE_NOT_IN_PRINT_QUEUE", { status: expediente.status });
  }
  if (!expediente.compiled_pdf_path) {
    throw new ExpedienteError("COMPILE_SOURCE_MISSING", { expedienteId });
  }

  const now = new Date().toISOString();
  await updateExpediente(expedienteId, {
    status: "printed",
    printed_at: now,
    printed_by: actor.userId,
  });

  emitExpedientePrinted({
    expedienteId,
    caseId: expediente.case_id,
    attemptNo: expediente.attempt_no,
    orgId: actor.orgId,
  });

  await writeAudit(actor, "expediente.printed", "expedientes", expedienteId, {
    after: { status: "printed", printedBy: actor.userId },
  });
}

/**
 * Records physical shipping with optional tracking reference (no status change).
 *
 * RF-AND-026 / §3.9
 *
 * @api-id API-EXP-17
 */
export async function markShipped(
  actor: Actor,
  expedienteId: string,
  trackingRef?: string,
): Promise<void> {
  can(actor, "printing", "edit");

  const expediente = await findExpedienteById(expedienteId);
  if (!expediente) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, expediente.case_id);

  if (expediente.status !== "printed") {
    throw new ExpedienteError("EXPEDIENTE_NOT_PRINTED", { status: expediente.status });
  }

  const shippedAt = new Date().toISOString();
  await updateExpediente(expedienteId, {
    shipped_at: shippedAt,
    tracking_ref: trackingRef ?? null,
  });

  await writeAudit(actor, "expediente.shipped", "expedientes", expedienteId, {
    after: { shippedAt, trackingRef: trackingRef ?? null },
  });
}

/**
 * Records filing in court / USCIS (no status change).
 *
 * RF-AND-026 / §3.9
 *
 * @api-id API-EXP-18
 */
export async function markFiled(
  actor: Actor,
  expedienteId: string,
): Promise<void> {
  can(actor, "printing", "edit");

  const expediente = await findExpedienteById(expedienteId);
  if (!expediente) throw new ExpedienteError("EXPEDIENTE_NOT_FOUND");
  await requireCaseAccess(actor, expediente.case_id);

  if (expediente.status !== "printed") {
    throw new ExpedienteError("EXPEDIENTE_NOT_PRINTED", { status: expediente.status });
  }

  const filedAt = new Date().toISOString();
  await updateExpediente(expedienteId, {
    filed_at: filedAt,
  });

  await writeAudit(actor, "expediente.filed", "expedientes", expedienteId, {
    after: { filedAt },
  });
}

// ---------------------------------------------------------------------------
// Re-export repository types needed by index.ts
// ---------------------------------------------------------------------------
export type {
  ExpedienteRow,
  ExpedienteItemRow,
  CoverTemplateRow,
  CoverRenderRow,
} from "./repository";
