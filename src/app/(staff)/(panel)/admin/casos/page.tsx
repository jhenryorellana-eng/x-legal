/**
 * Admin casos — listado global · /admin/casos (DOC-53 §2).
 *
 * Server Component: guards the actor, reads the enriched admin case list
 * (filters in URL → searchParams), resolves the contractable catalog for the
 * "Nuevo caso" modal, and passes rows + actions to the client list view.
 */

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { listCasesAdmin } from "@/backend/modules/cases";
import {
  listContractableServices,
  listContractableServicePlans,
  listServicePartyRoles,
} from "@/backend/modules/catalog";
import { resolveI18n, type Locale } from "@/shared/i18n";
import {
  CasosListView,
  type CaseRowVM,
} from "@/frontend/features/admin/casos/casos-list-view";
import type { NewCaseService } from "@/frontend/features/admin/casos/new-case-modal";
import { buildCasosStrings } from "@/frontend/features/shared-case";
import { mapStatusToPill, relTime } from "./view-helpers";
import {
  createCaseAction,
  searchClientsForCaseAction,
  getClientCasesForNewCaseAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminCasosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const sp = await searchParams;
  const locale = (await getLocale()) as Locale;
  const strings = buildCasosStrings(locale === "en" ? "en" : "es");

  const page = await listCasesAdmin(actor, {
    status: sp.status || undefined,
    cursor: sp.cursor || undefined,
    limit: 20,
  });

  // Client-side filters (service + free search) applied over resolved labels.
  const search = (sp.q ?? "").toLowerCase();
  const serviceFilter = sp.service ?? "";

  let rows: CaseRowVM[] = page.items.map((c) => {
    const pill = mapStatusToPill(c.status);
    return {
      id: c.id,
      caseNumber: c.caseNumber,
      clientName: c.clientName ?? "—",
      serviceLabel: c.serviceLabelI18n ? resolveI18n(c.serviceLabelI18n, locale) : "—",
      planKind: c.planKind === "with_lawyer" ? "with_lawyer" : "self",
      phaseLabel: c.phaseLabelI18n ? resolveI18n(c.phaseLabelI18n, locale) : "—",
      phasePos: c.phaseIndex,
      phaseTotal: c.phaseCount,
      status: c.status,
      statusPill: pill.kind,
      statusLabel: strings.status[c.status as keyof typeof strings.status] ?? c.status,
      openedRel: relTime(c.openedAt ?? c.createdAt, locale),
    };
  });

  if (search) {
    rows = rows.filter(
      (r) =>
        r.caseNumber.toLowerCase().includes(search) ||
        r.clientName.toLowerCase().includes(search),
    );
  }

  // Contractable services + their plans for the "Nuevo caso" modal.
  const services = await listContractableServices(actor.orgId);
  // Plans + party roles for the modal. Use the sales-accessible reads
  // (listContractableServicePlans / listServicePartyRoles — no `catalog.view`
  // gate) instead of getServiceEditorTree, so an asesora (sales) building a case
  // sees the plans too — not just admins. Both are non-sensitive contract config.
  const newCaseServices: NewCaseService[] = await Promise.all(
    services.map(async (s): Promise<NewCaseService> => {
      const [plans, partyRoles] = await Promise.all([
        listContractableServicePlans(s.id).catch(() => []),
        listServicePartyRoles(s.id).catch(() => []),
      ]);
      const encodedByKind: Record<string, string> = {};
      for (const p of plans) {
        const down = p.default_downpayment_cents ?? Math.round(p.price_cents * 0.2);
        const inst = p.default_installments ?? 1;
        const freq = p.default_frequency === "weekly" ? "weekly" : "monthly";
        // serviceId|planId|priceCents|downCents|installments|frequency (decoded by createCaseAction)
        encodedByKind[p.kind] = `${s.id}|${p.id}|${p.price_cents}|${down}|${inst}|${freq}`;
      }
      return {
        id: s.id,
        label: resolveI18n(s.label_i18n, locale),
        plans: plans.map((p) => ({
          kind: (p.kind === "with_lawyer" ? "with_lawyer" : "self") as "self" | "with_lawyer",
          label: p.kind === "with_lawyer" ? strings.planWith : strings.planSelf,
          priceCents: p.price_cents,
          downpaymentCents: p.default_downpayment_cents ?? null,
          installments: p.default_installments ?? 1,
          frequency: (p.default_frequency === "weekly" ? "weekly" : "monthly") as "weekly" | "monthly",
        })),
        encodedByKind,
        partyRoles: partyRoles.map((r) => ({
          roleKey: r.role_key,
          label: resolveI18n(r.label_i18n, locale),
          cardinality: r.cardinality,
          required: r.is_required,
        })),
      };
    }),
  );

  // Service filter over the resolved service label (best-effort; the row VM does
  // not carry service_id).
  if (serviceFilter) {
    const chosen = services.find((s) => s.id === serviceFilter);
    const label = chosen ? resolveI18n(chosen.label_i18n, locale) : "";
    if (label) rows = rows.filter((r) => r.serviceLabel === label);
  }

  return (
    <CasosListView
      rows={rows}
      total={rows.length}
      hasMore={page.nextCursor !== null}
      nextCursor={page.nextCursor}
      services={newCaseServices}
      strings={strings}
      detailBasePath="/admin/casos"
      newCaseActions={{
        createCase: createCaseAction,
        searchClients: searchClientsForCaseAction,
        getClientCases: getClientCasesForNewCaseAction,
      }}
    />
  );
}
