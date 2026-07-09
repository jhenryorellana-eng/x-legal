/**
 * Admin caso detalle — shared-case modo admin · /admin/casos/[caseId] (DOC-53 §3).
 *
 * First real consumer of features/shared-case. Server Component: guards the
 * actor, assembles the CaseWorkspaceVM from the cases / billing / contracts
 * module-pub reads, injects the server actions and renders SharedCaseView with
 * isAdmin. Tabs Resumen · Documentos · Partes (rest of the canonical order
 * arrives in future phases).
 */

import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
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
import { getAccountStatement } from "@/backend/modules/billing";
import { getCaseTabAccess } from "@/backend/modules/case-tabs";
import { getContractForCase } from "@/backend/modules/contracts";
import { getRunsForCase, getPreMortemAssessmentsForCase, isPreMortemEnabledForCase } from "@/backend/modules/ai-engine";
import { getValidationsForCase } from "@/backend/modules/integrations";
import { getCaseExpedientes } from "@/backend/modules/expediente";
import { getCaseRuta } from "@/backend/modules/scheduling";
import { resolveI18n, type Locale } from "@/shared/i18n";
import { SharedCaseView } from "@/frontend/features/shared-case";
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
import type { CaseWorkspaceVM, CaseTabId } from "@/frontend/features/shared-case";
import { buildCasosStrings } from "@/frontend/features/shared-case";
import { mapStatusToPill, buildRutaVM, buildPreMortemVM, mapStatementInstallments } from "../view-helpers";
import {
  reviewDocumentAction,
  setRequirementVisibilityAction,
  advanceCasePhaseAction,
  advanceCaseMilestoneAction,
  registerPaymentAction,
  getZelleProofUploadUrlCaseAction,
  getZelleProofViewUrlCaseAction,
  confirmZellePaymentCaseAction,
  rejectZelleProofCaseAction,
  resendSigningLinkAction,
  downloadSignedContractAction,
  getTermsAcceptanceAction,
  sendContractAction,
  getDocumentUrlAction,
  translateDocumentAction,
  getDocumentTranslationAction,
  startDocumentUploadAction,
  confirmDocumentUploadAction,
  renameDocumentAction,
  updateCasePartyAction,
  addCaseAppointmentAction,
  transferCaseAction,
  handoffCaseFromLegalAction,
  assignCaseOwnerAction,
  setDocumentTranslationNotRequiredAction,
  runPreMortemAction,
} from "../actions";
import { getFormResponsePdfUrlAction, generateFilledPdfAction } from "../form-actions";
import { getGenerationOutputUrlAction, startLetterGenerationAction, getRunStatusAction } from "../generation-actions";

export const dynamic = "force-dynamic";

export default async function AdminCasoDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const { caseId } = await params;
  const { tab } = await searchParams;
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

  // Parallel reads: documents, payment plan, contract, recent timeline.
  const [documents, statement, contract, timeline, forms, runs, validationRows, expedienteRows, matrix, rutaRaw, priorPhasesRaw, preMortemEnabled, preMortemRows] = await Promise.all([
    getCaseDocuments(actor, caseId).catch(() => []),
    getAccountStatement(actor, caseId).catch(() => null),
    getContractForCase(actor, caseId).catch(() => null),
    getTimeline(actor, caseId, { limit: 8 }).catch(() => ({ items: [], nextCursor: null })),
    getClientFormsForCase(actor, caseId).catch(() => []),
    getRunsForCase(actor, caseId).catch(() => []),
    actor.role === "admin"
      ? getValidationsForCase(actor, caseId).catch(() => [])
      : Promise.resolve([] as never[]),
    actor.role === "admin"
      ? getCaseExpedientes(actor, caseId).catch(() => [])
      : Promise.resolve([] as never[]),
    getDocumentsMatrix(actor, caseId, { includeHidden: true }).catch(() => null),
    getCaseRuta(actor, caseId).catch(() => null),
    getPriorPhaseMaterials(actor, caseId).catch(() => ({ phases: [] })),
    isPreMortemEnabledForCase(actor, caseId).catch(() => false),
    getPreMortemAssessmentsForCase(actor, caseId).catch(() => []),
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

  // Visibility toggle is an admin + sales affordance (DOC-41 §3.5 decision).
  const canManageDocs = actor.role === "admin" || actor.role === "sales";
  // Phase advance / milestone progression from the admin case detail (admin only;
  // Andrium drives the day-to-day phase boundary from the print queue).
  const canAdvancePhase = actor.role === "admin";
  // Adding a cita to the route needs calendar:edit (the service enforces it too).
  const canManageCalendar = actor.role === "admin" || actor.role === "sales";

  const pill = mapStatusToPill(workspace.status);
  const installments = mapStatementInstallments(statement);
  const downpayment = installments.find(
    (i) => i.isDownpayment && (i.status === "pending" || i.status === "overdue"),
  );

  // Resolve party names from the workspace (person record / client profile).
  const parties = workspace.parties.map((p) => ({
    id: p.id,
    name: p.name ?? "—",
    role: p.role,
    firstName: p.firstName,
    lastName: p.lastName,
  }));

  // Plan kind drives the plan chip — read from the contract's plan_snapshot
  // (written by the "Nuevo caso" modal). Defaults to "self" when absent.
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

  const preMortem = { enabled: preMortemEnabled, assessments: buildPreMortemVM(preMortemRows, locale) };

  const vm: CaseWorkspaceVM = {
    header: {
      caseId,
      caseNumber: workspace.caseNumber,
      clientName: parties[0]?.name ?? "—",
      clientPhone: workspace.clientPhone,
      serviceLabel: workspace.service
        ? resolveI18n(workspace.service.labelI18n, locale)
        : "—",
      planKind: contractPlanKind,
      status: workspace.status,
      statusPill: pill.kind,
      statusLabel:
        strings.status[workspace.status as keyof typeof strings.status] ?? workspace.status,
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
    role: (actor.role as "sales" | "paralegal" | "finance" | "admin") ?? "sales",
    isAdmin: actor.role === "admin",
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
  };

  return (
    <SharedCaseView
      vm={vm}
      actions={{
        reviewDocument: reviewDocumentAction,
        getFilledPdfUrl: getFormResponsePdfUrlAction,
        generateFilledPdf: generateFilledPdfAction,
        getGenerationOutputUrl: getGenerationOutputUrlAction,
        startLetterGeneration: startLetterGenerationAction,
        getRunStatus: getRunStatusAction,
        runPreMortem: runPreMortemAction,
        setRequirementVisibility: canManageDocs ? setRequirementVisibilityAction : undefined,
        advanceCasePhase: canAdvancePhase ? advanceCasePhaseAction : undefined,
        advanceCaseMilestone: canAdvancePhase ? advanceCaseMilestoneAction : undefined,
        registerPayment: registerPaymentAction,
        getZelleProofUploadUrl: getZelleProofUploadUrlCaseAction,
        getZelleProofViewUrl: getZelleProofViewUrlCaseAction,
        confirmZellePayment: confirmZellePaymentCaseAction,
        rejectZelleProof: rejectZelleProofCaseAction,
        resendSigningLink: resendSigningLinkAction,
        sendContract: sendContractAction,
        getDocumentUrl: getDocumentUrlAction,
        translateDocument: canManageDocs ? translateDocumentAction : undefined,
        getTranslation: canManageDocs ? getDocumentTranslationAction : undefined,
        downloadSignedContract: downloadSignedContractAction,
        getTermsAcceptance: getTermsAcceptanceAction,
        startUpload: startDocumentUploadAction,
        confirmUpload: confirmDocumentUploadAction,
        renameDocument: renameDocumentAction,
        updateCaseParty: actor.role === "admin" ? updateCasePartyAction : undefined,
        addCaseAppointment: canManageCalendar ? addCaseAppointmentAction : undefined,
        transferCase: transferCaseAction,
        handoffCaseFromLegal: handoffCaseFromLegalAction,
        assignCaseOwner: actor.role === "admin" ? assignCaseOwnerAction : undefined,
        setDocumentTranslationNotRequired: canManageDocs ? setDocumentTranslationNotRequiredAction : undefined,
      }}
      strings={strings}
      locale={lc}
      backHref="/admin/casos"
      isAdmin={actor.role === "admin"}
      tabAccessByRole={tabAccess.allowedByRole}
      initialTab={tab as CaseTabId | undefined}
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
