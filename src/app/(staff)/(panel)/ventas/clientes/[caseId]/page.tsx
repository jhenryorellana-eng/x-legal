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
  getTimeline,
  CaseError,
} from "@/backend/modules/cases";
import { getPaymentPlanForCase } from "@/backend/modules/billing";
import { getContractForCase } from "@/backend/modules/contracts";
import { resolveI18n, type Locale } from "@/shared/i18n";
import { SharedCaseView, buildCasosStrings } from "@/frontend/features/shared-case";
import type { CaseWorkspaceVM } from "@/frontend/features/shared-case";
import { mapStatusToPill } from "../../../admin/casos/view-helpers";
import {
  reviewDocumentAction,
  registerPaymentAction,
  resendSigningLinkAction,
  getDocumentUrlAction,
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

  const [documents, plan, contract, timeline] = await Promise.all([
    getCaseDocuments(actor, caseId).catch(() => []),
    getPaymentPlanForCase(actor, caseId).catch(() => null),
    getContractForCase(actor, caseId).catch(() => null),
    getTimeline(actor, caseId, { limit: 8 }).catch(() => ({ items: [], nextCursor: null })),
  ]);

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

  const parties = workspace.parties.map((p) => ({ id: p.id, name: p.name ?? "—", role: p.role }));
  const snapshotKind = (contract?.plan_snapshot as { planKind?: string } | null)?.planKind;
  const contractPlanKind: "self" | "with_lawyer" =
    snapshotKind === "with_lawyer" ? "with_lawyer" : "self";

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
      contractStatus: contract?.status ?? null,
      contractId: contract?.id ?? null,
    },
    documents: documents.map((d) => ({
      id: d.id,
      filename: d.original_filename,
      status: d.status as "uploaded" | "approved" | "rejected" | "replaced",
      partyName: null,
      createdAt: d.created_at,
    })),
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
      occurredAt: ev.occurred_at,
      actorKind: ev.actor_kind,
      icon: ev.icon ?? "info",
    })),
  };

  return (
    <SharedCaseView
      vm={vm}
      actions={{
        reviewDocument: reviewDocumentAction,
        registerPayment: registerPaymentAction,
        resendSigningLink: resendSigningLinkAction,
        getDocumentUrl: getDocumentUrlAction,
      }}
      strings={strings}
      locale={lc}
      backHref="/ventas/clientes"
      isAdmin={false}
    />
  );
}
