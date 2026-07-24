/**
 * Org service — organization configuration use cases (DOC-53 §9).
 *
 * Pattern: can() → parse Zod → domain rules → repo → audit.
 * Every mutation gates on can(actor, 'dashboard', 'edit') — config is admin-only
 * (RF-ADM-049/050/051; admin passes every can() by role, DOC-22 §5.2). The audit
 * row carries the before/after diff so the change is reconstructable (RF-ADM-047).
 *
 * Proposed API surface (P-53-2): API-ORG-01…05 (DOC-48 §3 propuesta).
 */

import { can } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { writeAudit } from "@/backend/modules/audit";
import type { Json } from "@/shared/database.types";

import {
  OrgSettingsSchema,
  UpdateOrgSettingsDtoSchema,
  CreateTermsVersionDtoSchema,
  assertContactPhone,
  orgError,
  type OrgSettings,
  type UpdateOrgSettingsDto,
  type CreateTermsVersionDto,
  type CoverTemplate,
  type TermsVersion,
  type I18nTextDraft,
} from "./domain";

import * as repo from "./repository";

// ---------------------------------------------------------------------------
// General settings — RF-ADM-049
// ---------------------------------------------------------------------------

export interface OrgConfig {
  id: string;
  name: string;
  settings: OrgSettings;
}

/** Coerces a raw orgs.settings jsonb into the typed shape (lenient defaults). */
function parseSettings(raw: unknown): OrgSettings {
  const result = OrgSettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : OrgSettingsSchema.parse({});
}

/**
 * Reads the org name + typed settings for the General tab (page-initial RSC).
 *
 * @api-id API-ORG-01 (read — DOC-53 §9.1)
 */
export async function getOrgConfig(actor: Actor): Promise<OrgConfig> {
  can(actor, "dashboard", "view");
  const org = await repo.findOrgById(actor.orgId);
  if (!org) throw orgError("ORG_NOT_FOUND");
  return {
    id: org.id,
    name: org.name,
    settings: parseSettings(org.settings),
  };
}

/** EL CONSULTOR data for the contract (DOC-51). */
export interface OrgContractInfo {
  companyName: string;
  representativeName: string | null;
  phone: string | null;
  zelleEmail: string | null;
}

/**
 * Reads the org's "EL CONSULTOR" data for assembling a contract document. No
 * actor gate: this is non-sensitive org config consumed internally by the cases
 * module during contract creation (the caller is already authorized). Returns
 * safe defaults if the org is missing.
 *
 * @api-id (internal) contract assembly
 */
export async function getOrgContractInfo(orgId: string): Promise<OrgContractInfo> {
  const org = await repo.findOrgById(orgId);
  if (!org) return { companyName: "", representativeName: null, phone: null, zelleEmail: null };
  const settings = parseSettings(org.settings);
  return {
    companyName: org.name,
    representativeName: settings.representative_name,
    phone: settings.contact_phones[0]?.phone ?? null,
    zelleEmail: settings.payment_zelle_email,
  };
}

/**
 * Updates the org name + typed settings. Validates contact phones server-side.
 *
 * @api-id API-ORG-02 (P-53-2a — updateOrgSettingsAction)
 */
export async function updateOrgSettings(
  actor: Actor,
  patch: UpdateOrgSettingsDto,
): Promise<OrgConfig> {
  can(actor, "dashboard", "edit");
  const dto = UpdateOrgSettingsDtoSchema.parse(patch);

  const org = await repo.findOrgById(actor.orgId);
  if (!org) throw orgError("ORG_NOT_FOUND");

  const before: OrgConfig = {
    id: org.id,
    name: org.name,
    settings: parseSettings(org.settings),
  };

  // Validate + normalize phones (E1, RF-ADM-049).
  const contactPhones =
    dto.contact_phones?.map((p) => ({ label: p.label, phone: assertContactPhone(p.phone) })) ??
    before.settings.contact_phones;

  const nextSettings: OrgSettings = {
    contact_phones: contactPhones,
    default_timezone: dto.default_timezone ?? before.settings.default_timezone,
    logo_url: dto.logo_url !== undefined ? dto.logo_url : before.settings.logo_url,
    representative_name:
      dto.representative_name !== undefined
        ? dto.representative_name
        : before.settings.representative_name,
    payment_zelle_email:
      dto.payment_zelle_email !== undefined
        ? dto.payment_zelle_email
        : before.settings.payment_zelle_email,
    goals: dto.goals ?? before.settings.goals,
    ai_lex_model:
      dto.ai_lex_model !== undefined ? dto.ai_lex_model : before.settings.ai_lex_model,
    // Owned by zelle-recon (finance) — the admin form never edits it, but it
    // must be carried through or this whole-object write would wipe it.
    zelle_reconciliation: before.settings.zelle_reconciliation,
  };

  const updated = await repo.updateOrg(actor.orgId, {
    ...(dto.name ? { name: dto.name } : {}),
    settings: nextSettings as unknown as Json,
  });

  const after: OrgConfig = {
    id: updated.id,
    name: updated.name,
    settings: parseSettings(updated.settings),
  };

  await writeAudit(actor, "org.settings.updated", "orgs", updated.id, { before, after });
  return after;
}

// ---------------------------------------------------------------------------
// Cover templates — RF-ADM-050
// ---------------------------------------------------------------------------

/**
 * Lists the org's cover templates (page-initial RSC read, DOC-53 §9.2).
 *
 * @api-id API-ORG-03 (read; mutation editor is F-later — only activate here)
 */
export async function listCoverTemplates(actor: Actor): Promise<CoverTemplate[]> {
  can(actor, "expedientes", "view");
  const rows = await repo.listCoverTemplates(actor.orgId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    template: (r.template ?? {}) as Record<string, unknown>,
    is_active: r.is_active,
  }));
}

/**
 * Toggles a cover template active/inactive ("inactive ones aren't offered in
 * the assembler", DOC-53 §9.2).
 *
 * @api-id API-ORG-04 (P-53-2b — setCoverTemplateActiveAction)
 */
export async function setCoverTemplateActive(
  actor: Actor,
  templateId: string,
  active: boolean,
): Promise<CoverTemplate> {
  can(actor, "expedientes", "edit");
  const row = await repo.setCoverTemplateActive(templateId, active);
  await writeAudit(actor, "org.cover_template.updated", "cover_templates", row.id, {
    after: { is_active: active },
  });
  return {
    id: row.id,
    name: row.name,
    template: (row.template ?? {}) as Record<string, unknown>,
    is_active: row.is_active,
  };
}

// ---------------------------------------------------------------------------
// Terms versions — RF-ADM-051
// ---------------------------------------------------------------------------

function toTermsVersion(row: repo.TermsVersionRow): TermsVersion {
  return {
    id: row.id,
    version: row.version,
    title_i18n: (row.title_i18n ?? {}) as I18nTextDraft,
    body_md_i18n: (row.body_md_i18n ?? {}) as I18nTextDraft,
    is_active: row.is_active,
    published_at: row.published_at,
  };
}

export interface TermsOverview {
  versions: TermsVersion[];
  /** Acceptance counts keyed by version string (compliance, RF-ADM-051). */
  acceptances: Record<string, number>;
}

/**
 * Lists the org's terms versions + acceptance counts (page-initial RSC read).
 *
 * @api-id API-ORG-05 (read — DOC-53 §9.3)
 */
export async function getTermsOverview(actor: Actor): Promise<TermsOverview> {
  can(actor, "dashboard", "view");
  const [rows, acceptances] = await Promise.all([
    repo.listTermsVersions(actor.orgId),
    repo.countTermsAcceptances(actor.orgId),
  ]);
  return { versions: rows.map(toTermsVersion), acceptances };
}

/**
 * Creates a new T&C version (always inactive until published). Bilingual title
 * + body are required (RF-ADM-051). Duplicate identifiers are rejected.
 *
 * @api-id API-ORG-06 (P-53-2c — createTermsVersionAction)
 */
export async function createTermsVersion(
  actor: Actor,
  input: CreateTermsVersionDto,
): Promise<TermsVersion> {
  can(actor, "dashboard", "edit");
  const dto = CreateTermsVersionDtoSchema.parse(input);

  if (await repo.termsVersionExists(actor.orgId, dto.version)) {
    throw orgError("ORG_TERMS_VERSION_TAKEN", `La versión "${dto.version}" ya existe.`);
  }

  const row = await repo.insertTermsVersion({
    org_id: actor.orgId,
    version: dto.version,
    title_i18n: dto.title_i18n as unknown as Json,
    body_md_i18n: dto.body_md_i18n as unknown as Json,
    is_active: false,
  });

  await writeAudit(actor, "org.terms_version.created", "terms_versions", row.id, {
    after: { version: row.version },
  });
  return toTermsVersion(row);
}

/**
 * Publishes a T&C version and marks it current (deactivates the previous one).
 * New contracts reference this version; existing acceptances are untouched
 * (invariant A1, RF-ADM-051).
 *
 * @api-id API-ORG-07 (P-53-2c — publishTermsVersionAction)
 */
export async function publishTermsVersion(actor: Actor, versionId: string): Promise<TermsVersion> {
  can(actor, "dashboard", "edit");
  const row = await repo.activateTermsVersion(actor.orgId, versionId);
  await writeAudit(actor, "org.terms_version.published", "terms_versions", row.id, {
    after: { version: row.version, is_active: true },
  });
  return toTermsVersion(row);
}
