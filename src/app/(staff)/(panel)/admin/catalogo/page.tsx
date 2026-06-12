/**
 * Service catalog list — /admin/catalogo (DOC-53 §4.1).
 *
 * Server Component: guards the actor, reads the full admin service list (incl.
 * drafts + archived) via the catalog module-pub read, resolves the label i18n +
 * entry-parent labels, and passes the cards + server actions to the client list.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { listServicesAdmin } from "@/backend/modules/catalog";
import { resolveI18n, type Locale } from "@/shared/i18n";
import { CatalogListView, type ServiceCardVM } from "@/frontend/features/admin/catalog/catalog-list-view";
import { buildCatalogStrings } from "@/frontend/features/admin/catalog/strings";
import {
  archiveServiceUi,
  restoreServiceUi,
  setServiceActiveUi,
  setServicePublicUi,
} from "./actions";

export default async function CatalogPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.admin");
  const tt = t as unknown as (key: string) => string;

  const services = await listServicesAdmin(actor, { include_archived: true });
  const labelById = new Map(services.map((s) => [s.id, resolveI18n(s.label_i18n, locale)]));

  const cards: ServiceCardVM[] = services.map((s) => ({
    id: s.id,
    slug: s.slug,
    category: s.category,
    label: resolveI18n(s.label_i18n, locale),
    icon: s.icon,
    color: s.color,
    isActive: s.is_active,
    isPublic: s.is_public,
    archived: s.archived_at !== null,
    isEntry: s.entry_parent_service_id !== null,
    entryParentLabel: s.entry_parent_service_id ? labelById.get(s.entry_parent_service_id) : undefined,
    planKinds: s.plan_kinds,
    phaseCount: s.phase_count,
  }));

  return (
    <CatalogListView
      services={cards}
      messages={buildCatalogStrings(tt)}
      newServiceHref="/admin/catalogo/nuevo"
      serviceHref={(id) => `/admin/catalogo/${id}`}
      actions={{
        archive: archiveServiceUi,
        restore: restoreServiceUi,
        setActive: setServiceActiveUi,
        setPublic: setServicePublicUi,
      }}
    />
  );
}
