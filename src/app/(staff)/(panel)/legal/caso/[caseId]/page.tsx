/**
 * Workspace de Diana — shared-case modo paralegal · /legal/caso/[caseId]
 * (DOC-54 §2). Reusa features/shared-case (el mismo workspace que Admin/Vanessa).
 *
 * Server Component: guarda el actor, arma el CaseWorkspaceVM desde los reads
 * module-pub de cases / billing / contracts / ai-engine / expediente /
 * integrations, inyecta las server actions compartidas y monta SharedCaseView
 * con el set de tabs de paralegal y backHref al kanban de Diana.
 *
 * A diferencia del page admin, las lecturas de validaciones/expedientes NO se
 * gatean a "admin": el backend impone RLS por módulo (`expedientes`/`validations`),
 * que la paralegal posee (role-presets). Degradan a [] ante fallo.
 */

import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";

// The Pre-Mortem tab's runPreMortemAction posts through THIS route: validating a
// large ai_letter (appeal brief + rubric + sources + web_search) runs several
// minutes, so the segment needs headroom above Vercel's default.
export const maxDuration = 800;
import {
  getCaseWorkspace,
  getCaseDocuments,
  getDocumentsMatrix,
  getClientFormsForCase,
  getTimeline,
  getCaseStageInfo,
  getPriorPhaseMaterials,
  CaseError,
} from "@/backend/modules/cases";
import { getCaseNotes } from "@/backend/modules/notes";
import { getAccountStatement } from "@/backend/modules/billing";
import { getCaseTabAccess } from "@/backend/modules/case-tabs";
import { getContractForCase } from "@/backend/modules/contracts";
import { getRunsForCase, getPreMortemAssessmentsForCase, isPreMortemEnabledForCase, listValidableTargetsForCase } from "@/backend/modules/ai-engine";
import {
  getLexThreadAction,
  sendLexMessageAction,
  getLexMessageStatusAction,
} from "@/backend/modules/ai-engine/actions";
import { getValidationsForCase } from "@/backend/modules/integrations";
import { getCaseExpedientes } from "@/backend/modules/expediente";
import { getCaseRuta } from "@/backend/modules/scheduling";
import { resolveI18n, type Locale } from "@/shared/i18n";
import { SharedCaseView, buildCasosStrings } from "@/frontend/features/shared-case";
import type { CaseWorkspaceVM, CaseTabId } from "@/frontend/features/shared-case";
import {
  getCaseThreadAction,
  sendMessageAction,
  loadMoreMessagesAction,
  listSinceAction,
  markReadAction,
  translateMessageAction,
  getAttachmentUploadUrlAction,
  confirmAttachmentAction,
  getAttachmentDownloadUrlAction,
} from "@/backend/modules/messaging/actions";
import { mapStatusToPill, buildRutaVM, buildPreMortemTargets, mapPreMortemReports, mapPreMortemInFlight, mapStatementInstallments, mapClientContact } from "../../../admin/casos/view-helpers";
import {
  reviewDocumentAction,
  registerPaymentAction,
  resendSigningLinkAction,
  sendContractAction,
  getSigningLinkAction,
  getDocumentUrlAction,
  downloadSignedContractAction,
  getTermsAcceptanceAction,
  startDocumentUploadAction,
  confirmDocumentUploadAction,
  renameDocumentAction,
  transferCaseAction,
  handoffCaseFromLegalAction,
  advanceCaseMilestoneAction,
  translateDocumentAction,
  getDocumentTranslationAction,
  setDocumentTranslationNotRequiredAction,
  runPreMortemAction,
  getPreMortemStatusAction,
  cancelPreMortemAction,
  addCaseNoteAction,
  deleteNoteAction,
} from "../../../admin/casos/actions";
import { getFormResponsePdfUrlAction, generateFilledPdfAction, approveFormResponseAction } from "../../../admin/casos/form-actions";
import { getGenerationOutputUrlAction, startLetterGenerationAction, getRunStatusAction } from "../../../admin/casos/generation-actions";

export const dynamic = "force-dynamic";

export default async function LegalCasoDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ tab?: string; target?: string }>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const { caseId } = await params;
  const { tab, target } = await searchParams;
  const locale = (await getLocale()) as Locale;
  const lc = locale === "en" ? "en" : "es";
  const strings = buildCasosStrings(lc);

  let workspace;
  try {
    workspace = await getCaseWorkspace(actor, caseId);
  } catch (err) {
    if (err instanceof CaseError) notFound();
    throw err;
  }

  const [documents, statement, contract, timeline, forms, runs, validationRows, expedienteRows, matrix, rutaRaw, priorPhasesRaw, preMortemEnabled, preMortemRows, preMortemTargetsRaw, notes] =
    await Promise.all([
      getCaseDocuments(actor, caseId).catch(() => []),
      getAccountStatement(actor, caseId).catch(() => null),
      getContractForCase(actor, caseId).catch(() => null),
      getTimeline(actor, caseId, { limit: 8 }).catch(() => ({ items: [], nextCursor: null })),
      getClientFormsForCase(actor, caseId).catch(() => []),
      getRunsForCase(actor, caseId).catch(() => []),
      getValidationsForCase(actor, caseId).catch(() => []),
      getCaseExpedientes(actor, caseId).catch(() => []),
      getDocumentsMatrix(actor, caseId, { includeHidden: true }).catch(() => null),
      getCaseRuta(actor, caseId).catch(() => null),
      getPriorPhaseMaterials(actor, caseId).catch(() => ({ phases: [] })),
      isPreMortemEnabledForCase(actor, caseId).catch(() => false),
      getPreMortemAssessmentsForCase(actor, caseId).catch(() => []),
      listValidableTargetsForCase(actor, caseId).catch(() => []),
      getCaseNotes(actor, caseId).catch(() => []),
    ]);

  // Responsable / etapa (eje propio) — staff-only; degrade to null on failure.
  const stageInfo = await getCaseStageInfo(actor, caseId).catch(() => null);
  const tabAccess = await getCaseTabAccess(actor).catch(() => ({ allowedByRole: {} }));

  const requirements = (matrix?.items ?? []).map((d) => ({
    key: d.key,
    requirementId: d.requirementId,
    partyId: d.partyId,
    partyName: d.partyName,
    label: resolveI18n(d.labelI18n, locale),
    category: d.categoryI18n ? resolveI18n(d.categoryI18n, locale) : null,
    isRequired: d.isRequired,
    isHidden: d.isHidden,
    status: d.status,
    documentId: d.documentId,
    rejectionReason: d.rejectionReasonI18n ? resolveI18n(d.rejectionReasonI18n, locale) : null,
    translationNotRequired: d.translationNotRequired,
    allowMultiple: d.allowMultiple,
    uploads: d.uploads.map((u) => ({
      documentId: u.documentId,
      displayName: u.displayName,
      status: u.status,
      rejectionReason: u.rejectionReasonI18n ? resolveI18n(u.rejectionReasonI18n, locale) : null,
      mimeType: u.mimeType,
    })),
  }));

  // Diana revisa y traduce documentos (RF-DIA-013/049). Ocultar requisitos
  // opcionales es afordancia de admin/sales → no se inyecta aquí.
  const canTranslate = actor.role === "paralegal" || actor.role === "admin";

  const pill = mapStatusToPill(workspace.status);
  const installments = mapStatementInstallments(statement);
  const downpayment = installments.find(
    (i) => i.isDownpayment && (i.status === "pending" || i.status === "overdue"),
  );

  const parties = workspace.parties.map((p) => ({
    id: p.id,
    name: p.name ?? "—",
    role: p.role,
    firstName: p.firstName,
    lastName: p.lastName,
  }));
  const snapshotKind = (contract?.plan_snapshot as { planKind?: string } | null)?.planKind;
  const contractPlanKind: "self" | "with_lawyer" =
    snapshotKind === "with_lawyer" ? "with_lawyer" : "self";

  const formsVm = forms.map((f) => ({
    id: f.formDefinitionId,
    fillFormDefinitionId: f.fillFormDefinitionId,
    kind: f.kind,
    label: resolveI18n(f.labelI18n, locale),
    status: f.status,
    partyId: f.partyId,
    partyName: f.partyName,
    filledBy: f.filledBy,
    responseId: f.responseId,
    hasPdf: f.filledPdfPath !== null,
    isRequired: f.isRequired,
    isHidden: f.isHidden,
  }));
  const formsDone = formsVm.filter((f) => f.status === "submitted" || f.status === "approved").length;

  const formLabelById = new Map(formsVm.map((f) => [f.id, f.label]));
  const generations = runs
    .filter((r) => !r.is_test)
    .map((r) => ({
      id: r.id,
      formDefinitionId: r.form_definition_id,
      formLabel: formLabelById.get(r.form_definition_id) ?? "—",
      status: r.status,
      version: r.version,
      costUsd: r.cost_usd,
      isCurrent: r.isCurrent,
      partyId: r.party_id,
      partyName: null,
      outputAvailable: r.status === "completed" && r.output_path !== null,
      createdAt: r.created_at,
    }));

  const validations = validationRows.map((v) => ({
    id: v.id,
    attemptNo: v.attempt_no,
    status: v.status,
    semaforo: v.semaforo,
    aiScore: v.ai_score,
    verdict: v.verdict,
    createdAt: v.created_at,
  }));

  const expedientes = expedienteRows.map((e) => ({
    id: e.id,
    attemptNo: e.attempt_no,
    status: e.status,
    pageCount: e.page_count,
    createdAt: e.created_at,
  }));

  const ruta = buildRutaVM(rutaRaw, locale);

  const priorPhases = priorPhasesRaw.phases.map((g) => ({
    phaseId: g.phaseId,
    label: resolveI18n(g.label, locale),
    position: g.position,
    documents: g.documents,
    forms: g.forms.map((f) => ({ ...f, label: resolveI18n(f.label, locale) })),
  }));

  const preMortemTargets = buildPreMortemTargets(preMortemTargetsRaw, locale);
  const preMortem = {
    enabled: preMortemEnabled,
    targets: preMortemTargets,
    reports: mapPreMortemReports(preMortemRows, preMortemTargets, locale),
    inFlight: mapPreMortemInFlight(preMortemRows, preMortemTargets),
  };

  const vm: CaseWorkspaceVM = {
    header: {
      caseId,
      caseNumber: workspace.caseNumber,
      clientName: parties[0]?.name ?? "—",
      clientPhone: workspace.clientPhone,
      serviceLabel: workspace.service ? resolveI18n(workspace.service.labelI18n, locale) : "—",
      planKind: contractPlanKind,
      status: workspace.status,
      statusPill: pill.kind,
      statusLabel: strings.status[workspace.status as keyof typeof strings.status] ?? workspace.status,
      isPaymentPending: workspace.status === "payment_pending",
      hasPhase: workspace.phase !== null,
      phaseLabel: workspace.phase ? resolveI18n(workspace.phase.labelI18n, locale) : null,
      phaseIndex: workspace.phaseIndex,
      phaseCount: workspace.phaseCount,
      phaseProgress: workspace.phaseProgress,
      contractStatus: contract?.status ?? null,
      contractId: contract?.id ?? null,
    },
    ruta,
    stage: stageInfo,
    role: (actor.role as "sales" | "paralegal" | "finance" | "admin") ?? "paralegal",
    isAdmin: false,
    requiresLawyerValidation: contractPlanKind === "with_lawyer",
    documents: documents.map((d) => ({
      id: d.id,
      filename: d.original_filename,
      status: d.status as "uploaded" | "approved" | "rejected" | "replaced",
      partyName: null,
      createdAt: d.created_at,
    })),
    requirements,
    docsApproved: workspace.doneDocuments,
    docsTotal: workspace.totalDocuments,
    parties,
    client: mapClientContact(workspace),
    installments,
    planFrequency: statement?.plan?.frequency ?? null,
    planAutopayEnabled: statement?.plan?.autopayEnabled ?? false,
    planAutopayDisabledReason: statement?.plan?.autopayDisabledReason ?? null,
    downpaymentInstallmentId: downpayment?.id ?? null,
    downpaymentAmountCents: downpayment?.amountCents ?? null,
    timeline: timeline.items.map((ev) => ({
      id: ev.id,
      title:
        (ev.title_i18n as { es?: string; en?: string } | null)?.[lc] ??
        (ev.title_i18n as { es?: string; en?: string } | null)?.es ??
        ev.event_type,
      body:
        (ev.body_i18n as { es?: string; en?: string } | null)?.[lc] ??
        (ev.body_i18n as { es?: string; en?: string } | null)?.es ??
        null,
      occurredAt: ev.occurred_at,
      actorKind: ev.actor_kind,
      icon: ev.icon ?? "info",
    })),
    forms: formsVm,
    formsDone,
    formsTotal: formsVm.length,
    generations,
    validations,
    expedientes,
    priorPhases,
    preMortem,
    notes,
  };

  return (
    <SharedCaseView
      vm={vm}
      actions={{
        addNote: addCaseNoteAction,
        deleteNote: deleteNoteAction,
        reviewDocument: reviewDocumentAction,
        getFilledPdfUrl: getFormResponsePdfUrlAction,
        generateFilledPdf: generateFilledPdfAction,
        approveForm: approveFormResponseAction,
        getGenerationOutputUrl: getGenerationOutputUrlAction,
        startLetterGeneration: startLetterGenerationAction,
        getRunStatus: getRunStatusAction,
        runPreMortem: runPreMortemAction,
        getPreMortemStatus: getPreMortemStatusAction,
        cancelPreMortem: cancelPreMortemAction,
        registerPayment: registerPaymentAction,
        resendSigningLink: resendSigningLinkAction,
        sendContract: sendContractAction,
        getSigningLink: getSigningLinkAction,
        getDocumentUrl: getDocumentUrlAction,
        downloadSignedContract: downloadSignedContractAction,
        getTermsAcceptance: getTermsAcceptanceAction,
        startUpload: startDocumentUploadAction,
        confirmUpload: confirmDocumentUploadAction,
        renameDocument: renameDocumentAction,
        transferCase: transferCaseAction,
        handoffCaseFromLegal: handoffCaseFromLegalAction,
        // Phase advance is an operations action (Andrium/admin, gated on the
        // expediente being printed) — not surfaced on the legal workspace.
        advanceCaseMilestone: advanceCaseMilestoneAction,
        translateDocument: canTranslate ? translateDocumentAction : undefined,
        getTranslation: canTranslate ? getDocumentTranslationAction : undefined,
        setDocumentTranslationNotRequired: canTranslate ? setDocumentTranslationNotRequiredAction : undefined,
      }}
      strings={strings}
      locale={lc}
      backHref="/legal"
      isAdmin={false}
      tabAccessByRole={tabAccess.allowedByRole}
      initialTab={tab as CaseTabId | undefined}
      initialTarget={target}
      lexActions={{
        getLexThread: getLexThreadAction,
        sendLexMessage: sendLexMessageAction,
        getLexMessageStatus: getLexMessageStatusAction,
      }}
      chatRaw={{
        getCaseThread: getCaseThreadAction,
        send: sendMessageAction,
        loadMore: loadMoreMessagesAction,
        listSince: listSinceAction,
        markRead: markReadAction,
        translate: translateMessageAction,
        getUploadUrl: getAttachmentUploadUrlAction,
        confirmAttachment: confirmAttachmentAction,
        getDownloadUrl: getAttachmentDownloadUrlAction,
      }}
    />
  );
}
