/**
 * Datasets IA — /admin/datasets (DOC-53 §6.1).
 *
 * Server Component: reads the enriched dataset list (item count, total tokens,
 * usage count) via the catalog module-pub read, renders the list view with the
 * app server actions injected.
 */

import { redirect } from "next/navigation";
import { getActor } from "@/backend/modules/identity";
import { listDatasetsAdmin } from "@/backend/modules/catalog";
import { DatasetsListView, type DatasetRowVM } from "@/frontend/features/admin/datasets";
import { createDatasetUi, setDatasetActiveUi, deleteDatasetUi } from "./actions";

export default async function DatasetsPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const rows = await listDatasetsAdmin(actor);

  const vmRows: DatasetRowVM[] = rows.map((d) => ({
    id: d.id,
    name: d.name,
    purpose: d.purpose,
    source_kind: d.source_kind,
    item_count: d.item_count,
    total_tokens: d.total_tokens,
    used_by: d.used_by,
    is_active: d.is_active,
  }));

  return (
    <DatasetsListView
      rows={vmRows}
      detailBasePath="/admin/datasets"
      actions={{
        create: createDatasetUi,
        setActive: setDatasetActiveUi,
        remove: deleteDatasetUi,
      }}
    />
  );
}
