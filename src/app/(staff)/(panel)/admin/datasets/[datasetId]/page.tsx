/**
 * Dataset detail — /admin/datasets/[datasetId] (DOC-53 §6.2).
 *
 * Server Component: reads the dataset with its items + usage via the catalog
 * module-pub read, renders the detail view with item actions injected.
 */

import { notFound, redirect } from "next/navigation";
import { getActor } from "@/backend/modules/identity";
import { getDatasetDetail } from "@/backend/modules/catalog";
import {
  DatasetDetailView,
  type DatasetItemVM,
  type DatasetUsageVM,
} from "@/frontend/features/admin/datasets";
import {
  createDatasetItemUi,
  deleteDatasetItemUi,
  createDatasetFileUploadUrlUi,
} from "../actions";

export default async function DatasetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ datasetId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const { datasetId } = await params;
  const { tab } = await searchParams;

  const detail = await getDatasetDetail(actor, datasetId);
  if (!detail) notFound();

  const items: DatasetItemVM[] = detail.items.map((i) => ({
    id: i.id,
    title: i.title,
    jurisdiction: i.jurisdiction,
    outcome: i.outcome,
    tags: i.tags,
    token_count: i.token_count,
  }));

  const usage: DatasetUsageVM[] = detail.usage.map((u) => ({
    formId: u.formId,
    formSlug: u.formSlug,
    serviceId: u.serviceId,
    phaseId: u.phaseId,
  }));

  return (
    <DatasetDetailView
      header={{
        id: detail.dataset.id,
        name: detail.dataset.name,
        source_kind: detail.dataset.source_kind,
        is_active: detail.dataset.is_active,
        item_count: detail.dataset.item_count,
        total_tokens: detail.dataset.total_tokens,
      }}
      items={items}
      usage={usage}
      initialTab={tab === "usos" ? "usos" : "items"}
      catalogBasePath="/admin/catalogo"
      actions={{
        createItem: createDatasetItemUi,
        deleteItem: deleteDatasetItemUi,
        createUploadUrl: createDatasetFileUploadUrlUi,
      }}
    />
  );
}
