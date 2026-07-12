/**
 * New service wizard — /admin/catalogo/nuevo (DOC-53 §4.2).
 *
 * Server Component: guards the actor and renders the catalog wizard in create
 * mode (no existing service). The wizard persists each step via the catalog
 * server actions, creating the service on the first save.
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { CatalogWizard } from "@/frontend/features/admin/catalog/catalog-wizard";
import { buildCatalogStrings } from "@/frontend/features/admin/catalog/strings";
import { catalogWizardActions } from "../wizard-actions";

export default async function NewServicePage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const t = await getTranslations("staff.admin");
  const tt = t as unknown as ((key: string) => string) & { raw: (k: string) => string };

  return (
    <CatalogWizard
      service={null}
      plans={[]}
      partyRoles={[]}
      phases={[]}
      stageSlas={{ sales: null, legal: null, operations: null }}
      slugLocked={false}
      messages={buildCatalogStrings(tt)}
      listHref="/admin/catalogo"
      actions={catalogWizardActions}
    />
  );
}
