/**
 * Service ficha / edit wizard — /admin/catalogo/[serviceId] (DOC-53 §4.2).
 *
 * Server Component: guards the actor, reads the full editor tree (service +
 * plans + phases with milestones/policy/docs/forms) via the catalog module-pub
 * read, maps it into the wizard view-model, and renders the wizard in edit mode.
 * The slug is locked when cases already exist (the read tree doesn't expose the
 * case count in F1, so the lock flag stays false until the cases module lands).
 */

import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getServiceEditorTree } from "@/backend/modules/catalog";
import {
  CatalogWizard,
  type WizardPlan,
  type WizardPartyRole,
  type WizardPhase,
  type WizardService,
} from "@/frontend/features/admin/catalog/catalog-wizard";
import { buildCatalogStrings } from "@/frontend/features/admin/catalog/strings";
import { catalogWizardActions } from "../wizard-actions";
import type { I18nValue } from "@/frontend/features/admin/shared/i18n-field";

function i18n(v: unknown): I18nValue {
  const o = (v ?? {}) as { es?: string; en?: string };
  return { es: o.es ?? "", en: o.en ?? "" };
}

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const { serviceId } = await params;
  const tree = await getServiceEditorTree(actor, serviceId);
  if (!tree) notFound();

  const t = await getTranslations("staff.admin");
  const tt = t as unknown as ((key: string) => string) & { raw: (k: string) => string };

  const service: WizardService = {
    id: tree.service.id,
    slug: tree.service.slug,
    category: tree.service.category as WizardService["category"],
    label: i18n(tree.service.label_i18n),
    description: i18n(tree.service.description_i18n),
    icon: tree.service.icon ?? "scale",
    color: tree.service.color ?? "accent",
    is_public: tree.service.is_public,
    is_active: tree.service.is_active,
  };

  const plans: WizardPlan[] = (["self", "with_lawyer"] as const).map((kind) => {
    const p = tree.plans.find((x) => x.kind === kind);
    return {
      kind,
      offered: !!p,
      price_cents: p?.price_cents ?? 0,
      currency: p?.currency ?? "USD",
      default_installments: p?.default_installments ?? 1,
      default_downpayment_cents: p?.default_downpayment_cents ?? null,
      is_active: p?.is_active ?? false,
    };
  });

  const partyRoles: WizardPartyRole[] = tree.partyRoles.map((r) => ({
    id: r.id,
    role_key: r.role_key,
    label: i18n(r.label_i18n),
    cardinality: r.cardinality,
    is_required: r.is_required,
    position: r.position,
  }));

  const phases: WizardPhase[] = tree.phases.map((ph) => ({
    id: ph.id,
    slug: ph.slug,
    label: i18n(ph.label_i18n),
    description: i18n(ph.description_i18n),
    client_explainer: i18n(ph.client_explainer_i18n),
    appointment_count: ph.appointment_policy?.appointment_count ?? 1,
    duration_minutes: ph.appointment_policy?.duration_minutes ?? 30,
    kind: (ph.appointment_policy?.kind ?? "video") as WizardPhase["kind"],
    schedule: ph.appointment_schedule.map((s) => ({
      sequence_number: s.sequence_number,
      duration_minutes: s.duration_minutes,
      kind: s.kind as WizardPhase["kind"],
      week_offset: s.week_offset,
    })),
    processing_weeks: ph.processing_weeks,
    milestoneCount: ph.milestones.length,
    docs: ph.documents.map((d) => ({
      id: d.id,
      slug: d.slug,
      label: i18n(d.label_i18n),
      help: i18n(d.help_i18n),
      category: i18n(d.category_i18n),
      is_required: d.is_required,
      is_per_party: d.is_per_party,
      party_roles: (d.party_roles ?? []) as string[],
      ai_extract: d.ai_extract,
      is_active: d.is_active,
    })),
    forms: ph.forms.map((f) => ({
      id: f.id,
      slug: f.slug,
      label: i18n(f.label_i18n),
      kind: f.kind as "ai_letter" | "pdf_automation",
      filled_by: f.filled_by as "client" | "staff" | "both",
      is_active: f.is_active,
      position: f.position,
      published_version: f.published_version,
    })),
  }));

  return (
    <CatalogWizard
      service={service}
      plans={plans}
      partyRoles={partyRoles}
      phases={phases}
      slugLocked={false}
      messages={buildCatalogStrings(tt)}
      listHref="/admin/catalogo"
      actions={catalogWizardActions}
    />
  );
}
