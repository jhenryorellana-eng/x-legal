import "server-only";
import {
  listContractableServices,
  listContractableServicePlans,
  listServicePartyRoles,
  getDeadlinePolicy,
} from "@/backend/modules/catalog";
import { getOfficeTimezone, listOrgNonWorkingDays } from "@/backend/modules/scheduling";
import { formatInTimeZone } from "date-fns-tz";
import { addCalendarDays } from "@/shared/business-days";
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
  /** Org non-working days (yyyy-MM-dd, office TZ) for the Calificación calculator. */
  holidays: string[];
  /** Office-TZ civil "today" (yyyy-MM-dd) for the Calificación calculator. */
  todayYmd: string;
}

/** Maps a service's deadline policy to the modal's per-service shape (or null). */
async function resolveDeadlinePolicy(serviceId: string, locale: Locale): Promise<NewCaseService["deadlinePolicy"]> {
  const policy = await getDeadlinePolicy(serviceId).catch(() => null);
  if (!policy?.isEnabled) return null;
  return {
    isEnabled: true,
    anchorLabel: resolveI18n(policy.anchorLabelI18n, locale),
    deadlineDays: policy.deadlineDays,
    minBusinessDays: policy.minBusinessDaysToAccept,
    mailBufferDays: policy.mailBufferBusinessDays,
  };
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

  // Office-TZ "today" for the Calificación calculator (Feature A). The org's
  // non-working days are fetched below, once the window is known.
  const officeTz = await getOfficeTimezone(orgId).catch(() => "America/New_York");
  const todayYmd = formatInTimeZone(new Date(), officeTz, "yyyy-MM-dd");

  const catalogServices = await listContractableServices(orgId).catch(() => []);
  const services = catalogServices.map((s) => ({ id: s.id, label: resolveI18n(s.label_i18n, locale) }));

  const newCaseServices: NewCaseService[] = await Promise.all(
    catalogServices.map(async (s): Promise<NewCaseService> => {
      // listContractableServicePlans is sales-accessible (getServiceEditorTree
      // requires catalog.view, which the sales role lacks).
      const [plans, roles, deadlinePolicy] = await Promise.all([
        listContractableServicePlans(s.id).catch(() => []),
        listServicePartyRoles(s.id).catch(() => []),
        resolveDeadlinePolicy(s.id, locale),
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
          label: p.kind === "with_lawyer" ? casosStrings.planWith : casosStrings.planSelf,
          priceCents: p.price_cents,
          downpaymentCents: p.default_downpayment_cents ?? null,
          installments: p.default_installments ?? 1,
          frequency: (p.default_frequency === "weekly" ? "weekly" : "monthly") as "weekly" | "monthly",
        })),
        encodedByKind,
        partyRoles: roles.map((r) => ({
          roleKey: r.role_key,
          label: resolveI18n(r.label_i18n, locale),
          cardinality: r.cardinality,
          required: r.is_required,
        })),
        deadlinePolicy,
      };
    }),
  );

  // Size the holiday window from the LARGEST configured deadline (deadline_days can
  // be up to 365 in admin), so the calculator never misses a closure near a distant
  // deadline. Anchor ≤ today (a past judge decision) → deadline ≤ today + deadlineDays.
  const maxDeadlineDays = Math.max(
    0,
    ...newCaseServices.map((s) => s.deadlinePolicy?.deadlineDays ?? 0),
  );
  const holidays = maxDeadlineDays === 0
    ? []
    : await listOrgNonWorkingDays(orgId, todayYmd, addCalendarDays(todayYmd, maxDeadlineDays + 7)).catch(() => []);

  return { services, newCaseServices, casosStrings, holidays, todayYmd };
}
