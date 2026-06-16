/**
 * Campaña — /finanzas/campanas/[id] editor + detail (DOC-55 §4.2-4.4, RF-AND-034..039).
 *
 * Server Component: guards (staff + campaigns:view), loads the campaign + audience
 * sources (services, clients), renders the editor with bound actions.
 * Boundary: app → module-pub only.
 */

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getActor, can } from "@/backend/modules/identity";
import { getCampaign, listClients, CampaignError } from "@/backend/modules/campaigns";
import { listContractableServices } from "@/backend/modules/catalog";
import { resolveI18n } from "@/shared/i18n";
import type { Locale } from "@/shared/i18n";
import {
  CampanaEditorView,
  type CampanaEditorVM,
} from "@/frontend/features/andrium/campanas/campana-editor-view";
import {
  updateCampaignAction,
  previewAudienceAction,
  sendTestAction,
  scheduleCampaignAction,
  sendCampaignNowAction,
  cancelCampaignAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function CampanaEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");
  try {
    can(actor, "campaigns", "view");
  } catch {
    redirect("/admin");
  }

  const locale = (await getLocale()) as Locale;
  const loc: "es" | "en" = locale === "es" ? "es" : "en";

  let campaign: Awaited<ReturnType<typeof getCampaign>>;
  try {
    campaign = await getCampaign(actor, id);
  } catch (err) {
    if (err instanceof CampaignError) redirect("/finanzas/campanas");
    throw err;
  }

  const [servicesRaw, clients] = await Promise.all([
    listContractableServices(actor.orgId).catch(() => []),
    listClients(actor).catch(() => []),
  ]);
  const services = servicesRaw.map((s) => ({
    id: s.id,
    label: resolveI18n(s.label_i18n, loc) || s.slug,
  }));

  const vm: CampanaEditorVM = {
    id: campaign.id,
    name: campaign.name,
    subject: campaign.subject,
    bodyHtml: campaign.bodyHtml,
    status: campaign.status,
    audience: campaign.audience,
    scheduledAt: campaign.scheduledAt,
    metrics: campaign.metrics,
    services,
    clients,
    locale: loc,
  };

  return (
    <CampanaEditorView
      vm={vm}
      actions={{
        update: updateCampaignAction.bind(null, id),
        preview: previewAudienceAction,
        sendTest: sendTestAction.bind(null, id),
        schedule: scheduleCampaignAction.bind(null, id),
        send: sendCampaignNowAction.bind(null, id),
        cancel: cancelCampaignAction.bind(null, id),
      }}
    />
  );
}
