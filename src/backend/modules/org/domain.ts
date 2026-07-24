/**
 * Org module domain — pure types + Zod schemas for organization configuration.
 *
 * Covers the "company data" consumed by the client app and emails (DOC-53 §9):
 * - orgs.name + orgs.settings (typed, never raw JSON)
 * - cover_templates (legal cover sheets)
 * - terms_versions (T&C versions)
 *
 * No IO, no platform imports. Only Zod + shared/.
 * Source of truth: DOC-53 §9 + DOC-30 (orgs/cover_templates/terms_versions).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// i18n primitive
// ---------------------------------------------------------------------------

export const I18nTextDraftSchema = z.object({ es: z.string(), en: z.string() }).partial();
export type I18nTextDraft = z.infer<typeof I18nTextDraftSchema>;

// ---------------------------------------------------------------------------
// Org settings (typed shape over orgs.settings jsonb) — RF-ADM-049
// ---------------------------------------------------------------------------

/**
 * Zelle auto-reconciliation knobs (migration 0111). Owned/edited by the
 * zelle-recon module (finance role, can('billing','edit')) — the admin
 * settings form does not touch them, but this schema MUST declare the key or
 * an admin settings save would silently strip it from the jsonb.
 *
 * Defaults = dark-launch: the pipeline parses/matches and fills the review
 * inbox, but nothing auto-applies until `enabled` is flipped.
 */
export const ZelleReconciliationSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  tier_a_max_amount_cents: z.number().int().positive().default(50_000),
  daily_auto_max_cents: z.number().int().positive().default(250_000),
  daily_auto_max_count: z.number().int().positive().default(5),
  per_payer_daily_max: z.number().int().positive().default(2),
  tier_b_mode: z.enum(["review_only", "auto"]).default("review_only"),
});
export type ZelleReconciliationSettings = z.infer<typeof ZelleReconciliationSettingsSchema>;

/**
 * The typed org settings. Stored in orgs.settings (jsonb) but never edited as
 * raw JSON — the admin form maps each field (DOC-53 §9.1). Phones are validated
 * server-side with normalize_phone() (E1).
 */
export const OrgSettingsSchema = z.object({
  /** Contact phone numbers, E.164, with an optional label (office). */
  contact_phones: z
    .array(z.object({ label: z.string().max(60), phone: z.string() }))
    .default([]),
  /** Default org IANA timezone for new staff/cases. */
  default_timezone: z.string().min(1).default("America/New_York"),
  /** Logo URL shown in app footer + emails. */
  logo_url: z.string().nullable().default(null),
  /** "EL CONSULTOR" signatory shown on the contract (DOC-51). */
  representative_name: z.string().max(160).nullable().default(null),
  /** Zelle payment email shown in the contract's fees/payment section. */
  payment_zelle_email: z.string().max(160).nullable().default(null),
  /** Free-form goals/notes used by the dashboard targets (meta).
   *  Keys capped at 60 chars, values capped at 1 000 chars (M-3: bounded, no unlimited input). */
  goals: z.record(z.string().max(60), z.string().max(1000)).default({}),
  /**
   * Lex case-chat model override (staff "Lex" tab). null = platform default
   * (env AI_LEX_MODEL, then claude-sonnet-4-6). Whitelisted to the models the
   * ai-engine prices and the web_search tool supports.
   */
  ai_lex_model: z
    .enum(["claude-sonnet-4-6", "claude-haiku-4-5", "claude-fable-5"])
    .nullable()
    .default(null),
  /** Zelle auto-reconciliation circuit breakers (see schema above). */
  zelle_reconciliation: ZelleReconciliationSettingsSchema.default({
    enabled: false,
    tier_a_max_amount_cents: 50_000,
    daily_auto_max_cents: 250_000,
    daily_auto_max_count: 5,
    per_payer_daily_max: 2,
    tier_b_mode: "review_only",
  }),
});
export type OrgSettings = z.infer<typeof OrgSettingsSchema>;

export const UpdateOrgSettingsDtoSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  contact_phones: z
    .array(z.object({ label: z.string().max(60), phone: z.string().min(1) }))
    .optional(),
  default_timezone: z.string().min(1).optional(),
  logo_url: z.string().nullable().optional(),
  representative_name: z.string().max(160).nullable().optional(),
  payment_zelle_email: z.string().max(160).nullable().optional(),
  /** Keys capped at 60 chars, values capped at 1 000 chars (M-3). */
  goals: z.record(z.string().max(60), z.string().max(1000)).optional(),
  /** Lex case-chat model override; null restores the platform default. */
  ai_lex_model: z
    .enum(["claude-sonnet-4-6", "claude-haiku-4-5", "claude-fable-5"])
    .nullable()
    .optional(),
});
export type UpdateOrgSettingsDto = z.infer<typeof UpdateOrgSettingsDtoSchema>;

// ---------------------------------------------------------------------------
// Cover templates — RF-ADM-050
// ---------------------------------------------------------------------------

export interface CoverTemplate {
  id: string;
  name: string;
  template: Record<string, unknown>;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Terms versions — RF-ADM-051
// ---------------------------------------------------------------------------

export interface TermsVersion {
  id: string;
  version: string;
  title_i18n: I18nTextDraft;
  body_md_i18n: I18nTextDraft;
  is_active: boolean;
  published_at: string | null;
}

export const CreateTermsVersionDtoSchema = z.object({
  version: z.string().min(1).max(40),
  title_i18n: z.object({ es: z.string().min(1), en: z.string().min(1) }),
  body_md_i18n: z.object({ es: z.string().min(1), en: z.string().min(1) }),
});
export type CreateTermsVersionDto = z.infer<typeof CreateTermsVersionDtoSchema>;

// ---------------------------------------------------------------------------
// Error factory
// ---------------------------------------------------------------------------

export class OrgError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "OrgError";
  }
}

export function orgError(code: string, detail?: string): OrgError {
  return new OrgError(code, detail ?? code);
}

/**
 * Validates a contact phone is a plausible US/E.164 number. The canonical
 * normalize_phone() lives in identity; org config only needs a light check
 * (the deep normalization runs in the DB constraint). Returns the trimmed value
 * or throws ORG_INVALID_PHONE (E1, RF-ADM-049).
 */
export function assertContactPhone(raw: string): string {
  const trimmed = raw.trim();
  // Accept +<digits> (E.164) or US formats with separators.
  const digits = trimmed.replace(/[^\d+]/g, "");
  const e164 = /^\+\d{10,15}$/.test(digits);
  const usLocal = /^\+?1?\d{10}$/.test(digits.replace(/^\+/, ""));
  if (!e164 && !usLocal) {
    throw orgError("ORG_INVALID_PHONE", `El número "${raw}" no es válido.`);
  }
  return trimmed;
}
