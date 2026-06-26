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
  CaseError,
} from "@/backend/modules/cases";
import { getPaymentPlanForCase } from "@/backend/modules/billing";
import { getContractForCase } from "@/backend/modules/contracts";
import { getRunsForCase } from "@/backend/modules/ai-engine";
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
import type { CaseWorkspaceVM } from "@/frontend/features/shared-case";
import { buildCasosStrings } from "@/frontend/features/shared-case";
import { mapStatusToPill, buildRutaVM } from "../view-helpers";
import {
  reviewDocumentAction,
  setRequirementVisibilityAction,
  advanceCasePhaseAction,
  advanceCaseMilestoneAction,
  registerPaymentAction,
  resendSigningLinkAction,
  downloadSignedContractAction,
  getTermsAcceptanceAction,
  sendContractAction,
  getDocumentUrlAction,
  translateDocumentAction,
  getDocumentTranslationAction,
  startDocumentUploadAction,
  confirmDocumentUploadAction,
  updateCasePartyAction,
  addCaseAppointmentAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function AdminCasoDetailPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const { caseId } = await params;
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
  const [documents, plan, contract, timeline, forms, runs, validationRows, expedienteRows, matrix, rutaRaw] = await Promise.all([
    getCaseDocuments(actor, caseId).catch(() => []),
    getPaymentPlanForCase(actor, caseId).catch(() => null),
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
  ]);

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
  }));

  // Visibility toggle is an admin + sales affordance (DOC-41 §3.5 decision).
  const canManageDocs = actor.role === "admin" || actor.role === "sales";
  // Manual phase advance is an admin + paralegal affordance (hybrid progress model).
  const canAdvancePhase = actor.role === "admin" || actor.role === "paralegal";
  // Adding a cita to the route needs calendar:edit (the service enforces it too).
  const canManageCalendar = actor.role === "admin" || actor.role === "sales";

  const pill = mapStatusToPill(workspace.status);
  const installments = (plan?.installments ?? []).map((i) => ({
    id: i.id,
    number: i.number,
    amountCents: i.amount_cents,
    status: i.status,
    isDownpayment: i.is_downpayment,
    dueDate: i.due_date,
  }));
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
    label: resolveI18n(f.labelI18n, locale),
    status: f.status,
    partyId: f.partyId,
    partyName: f.partyName,
  }));
  const formsDone = formsVm.filter((f) => f.status === "submitted" || f.status === "approved").length;

  const formLabelById = new Map(formsVm.map((f) => [f.id, f.label]));
  const generations = runs
    .filter((r) => !r.is_test)
    .map((r) => ({
      id: r.id,
      formLabel: formLabelById.get(r.form_definition_id) ?? "—",
      status: r.status,
      version: r.version,
      costUsd: r.cost_usd,
      isCurrent: r.isCurrent,
      partyName: null,
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

  const vm: CaseWorkspaceVM = {
    header: {
      caseId,
      caseNumber: workspace.caseNumber,
      clientName: parties[0]?.name ?? "—",
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
  };

  return (
    <SharedCaseView
      vm={vm}
      actions={{
        reviewDocument: reviewDocumentAction,
        setRequirementVisibility: canManageDocs ? setRequirementVisibilityAction : undefined,
        advanceCasePhase: canAdvancePhase ? advanceCasePhaseAction : undefined,
        advanceCaseMilestone: canAdvancePhase ? advanceCaseMilestoneAction : undefined,
        registerPayment: registerPaymentAction,
        resendSigningLink: resendSigningLinkAction,
        sendContract: sendContractAction,
        getDocumentUrl: getDocumentUrlAction,
        translateDocument: canManageDocs ? translateDocumentAction : undefined,
        getTranslation: canManageDocs ? getDocumentTranslationAction : undefined,
        downloadSignedContract: downloadSignedContractAction,
        getTermsAcceptance: getTermsAcceptanceAction,
        startUpload: startDocumentUploadAction,
        confirmUpload: confirmDocumentUploadAction,
        updateCaseParty: actor.role === "admin" ? updateCasePartyAction : undefined,
        addCaseAppointment: canManageCalendar ? addCaseAppointmentAction : undefined,
      }}
      strings={strings}
      locale={lc}
      backHref="/admin/casos"
      isAdmin={actor.role === "admin"}
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
