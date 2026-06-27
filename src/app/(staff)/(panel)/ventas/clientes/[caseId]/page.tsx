/**
 * Cliente workspace — shared-case modo asesora · /ventas/clientes/[caseId]
 * (DOC-52 §5.2). Reuses features/shared-case (the same case workspace used by
 * Admin/Diana, RF-VAN-040). Server Component: guards the actor, assembles the
 * CaseWorkspaceVM from the cases / billing / contracts module-pub reads, injects
 * the shared-case actions and renders SharedCaseView with backHref to the list.
 *
 * Tabs Cartas/Traspaso land in F4 — the shared-case registry shows "Pronto" for
 * the unimplemented ones (DOC-52 §5.11).
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
  CaseError,
} from "@/backend/modules/cases";
import { getPaymentPlanForCase } from "@/backend/modules/billing";
import { getContractForCase } from "@/backend/modules/contracts";
import { getRunsForCase } from "@/backend/modules/ai-engine";
import { getCaseRuta } from "@/backend/modules/scheduling";
import { resolveI18n, type Locale } from "@/shared/i18n";
import { SharedCaseView, buildCasosStrings } from "@/frontend/features/shared-case";
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
import { mapStatusToPill, buildRutaVM } from "../../../admin/casos/view-helpers";
import {
  reviewDocumentAction,
  setRequirementVisibilityAction,
  registerPaymentAction,
  resendSigningLinkAction,
  sendContractAction,
  getDocumentUrlAction,
  downloadSignedContractAction,
  getTermsAcceptanceAction,
  startDocumentUploadAction,
  confirmDocumentUploadAction,
  addCaseAppointmentAction,
  transferCaseAction,
  setDocumentTranslationNotRequiredAction,
  translateDocumentAction,
  getDocumentTranslationAction,
} from "../../../admin/casos/actions";

export const dynamic = "force-dynamic";

export default async function VentasCasoDetailPage({
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

  const [documents, plan, contract, timeline, forms, runs, matrix, rutaRaw] = await Promise.all([
    getCaseDocuments(actor, caseId).catch(() => []),
    getPaymentPlanForCase(actor, caseId).catch(() => null),
    getContractForCase(actor, caseId).catch(() => null),
    getTimeline(actor, caseId, { limit: 8 }).catch(() => ({ items: [], nextCursor: null })),
    getClientFormsForCase(actor, caseId).catch(() => []),
    getRunsForCase(actor, caseId).catch(() => []),
    getDocumentsMatrix(actor, caseId, { includeHidden: true }).catch(() => null),
    getCaseRuta(actor, caseId).catch(() => null),
  ]);

  // Responsable / etapa (eje propio) — staff-only; degrade to null on failure.
  const stageInfo = await getCaseStageInfo(actor, caseId).catch(() => null);

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
  }));

  // Visibility toggle is an admin + sales affordance (DOC-41 §3.5 decision).
  const canManageDocs = actor.role === "admin" || actor.role === "sales";
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

  const ruta = buildRutaVM(rutaRaw, locale);

  const vm: CaseWorkspaceVM = {
    header: {
      caseId,
      caseNumber: workspace.caseNumber,
      clientName: parties[0]?.name ?? "—",
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
    role: (actor.role as "sales" | "paralegal" | "finance" | "admin") ?? "sales",
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
    validations: [],
    expedientes: [],
  };

  return (
    <SharedCaseView
      vm={vm}
      actions={{
        reviewDocument: reviewDocumentAction,
        setRequirementVisibility: canManageDocs ? setRequirementVisibilityAction : undefined,
        registerPayment: registerPaymentAction,
        resendSigningLink: resendSigningLinkAction,
        sendContract: sendContractAction,
        getDocumentUrl: getDocumentUrlAction,
        downloadSignedContract: downloadSignedContractAction,
        getTermsAcceptance: getTermsAcceptanceAction,
        startUpload: startDocumentUploadAction,
        confirmUpload: confirmDocumentUploadAction,
        addCaseAppointment: canManageCalendar ? addCaseAppointmentAction : undefined,
        transferCase: transferCaseAction,
        setDocumentTranslationNotRequired: canManageDocs ? setDocumentTranslationNotRequiredAction : undefined,
        translateDocument: canManageDocs ? translateDocumentAction : undefined,
        getTranslation: canManageDocs ? getDocumentTranslationAction : undefined,
      }}
      strings={strings}
      locale={lc}
      backHref="/ventas/clientes"
      isAdmin={false}
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
