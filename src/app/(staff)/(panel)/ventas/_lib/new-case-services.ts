import "server-only";
import {
  listContractableServices,
  listContractableServicePlans,
  listServicePartyRoles,
} from "@/backend/modules/catalog";
import { resolveI18n } from "@/shared/i18n";
import { buildCasosStrings, type CasosStrings } from "@/frontend/features/shared-case";
import type { NewCaseService } from "@/frontend/features/admin/casos/new-case-modal";
import type { Locale } from "@/frontend/lib/datetime";

export interface NewCaseModalData {
  /** `{id,label}` services for the "Nuevo lead" picker (Leads page only). */
  services: { id: string; label: string }[];
  /** Fully-encoded services (plans + party roles) for the "Nuevo caso" modal. */
  newCaseServices: NewCaseService[];
  /** Localized strings shared by every "Nuevo caso" modal mount. */
  casosStrings: CasosStrings;
}

/**
 * Builds the data the "Nuevo caso" (`NewCaseModal`) needs: the contractable
 * services with their plans + party roles encoded for `createCaseAction`, plus
 * the localized `CasosStrings`. Shared by the Leads board and the "Mis clientes"
 * list so the two never drift (DOC-52 §2.7: both launch the same modal).
 *
 * Returns `services` too (a light `{id,label}` map) so the Leads page can feed
 * its "Nuevo lead" picker from the same single `listContractableServices` read.
 */
export async function buildNewCaseModalData(
  orgId: string,
  locale: Locale,
): Promise<NewCaseModalData> {
  const casosStrings = buildCasosStrings(locale === "en" ? "en" : "es");

  const catalogServices = await listContractableServices(orgId).catch(() => []);
  const services = catalogServices.map((s) => ({ id: s.id, label: resolveI18n(s.label_i18n, locale) }));

  const newCaseServices: NewCaseService[] = await Promise.all(
    catalogServices.map(async (s): Promise<NewCaseService> => {
      // listContractableServicePlans is sales-accessible (getServiceEditorTree
      // requires catalog.view, which the sales role lacks).
      const [plans, roles] = await Promise.all([
        listContractableServicePlans(s.id).catch(() => []),
        listServicePartyRoles(s.id).catch(() => []),
      ]);
      const encodedByKind: Record<string, string> = {};
      for (const p of plans) {
        const down = p.default_downpayment_cents ?? Math.round(p.price_cents * 0.2);
        const inst = p.default_installments ?? 1;
        // serviceId|planId|priceCents|downCents|installments (decoded by createCaseAction)
        encodedByKind[p.kind] = `${s.id}|${p.id}|${p.price_cents}|${down}|${inst}`;
      }
      return {
        id: s.id,
        label: resolveI18n(s.label_i18n, locale),
        plans: plans.map((p) => ({
          kind: (p.kind === "with_lawyer" ? "with_lawyer" : "self") as "self" | "with_lawyer",
          label: p.kind === "with_lawyer" ? casosStrings.planWith : casosStrings.planSelf,
          priceCents: p.price_cents,
          downpaymentCents: p.default_downpayment_cents ?? null,
          installments: p.default_installments ?? 1,
        })),
        encodedByKind,
        partyRoles: roles.map((r) => ({
          roleKey: r.role_key,
          label: resolveI18n(r.label_i18n, locale),
          cardinality: r.cardinality,
          required: r.is_required,
        })),
      };
    }),
  );

  return { services, newCaseServices, casosStrings };
}
