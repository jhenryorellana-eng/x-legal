/**
 * Case party roles — single source of truth (DOC-41).
 *
 * These 8 keys mirror the `case_parties.party_role` CHECK constraint
 * (supabase/migrations/0004_cases.sql). A service declares WHICH of these roles
 * its cases have (besides the applicant) via `service_party_roles`, each with a
 * friendly label + cardinality. The applicant/"solicitante" is implicit and
 * auto-added with PRINCIPAL_ROLE_KEY.
 *
 * Consumed by: catalog (service party-role config + per-party document roles),
 * cases (party validation), and the "Nuevo caso" modal (constrained picker).
 */

export const PARTY_ROLE_KEYS = [
  "petitioner",
  "beneficiary",
  "spouse",
  "minor",
  "guardian",
  "witness",
  "member",
  "other",
] as const;

export type PartyRoleKey = (typeof PARTY_ROLE_KEYS)[number];

/** The principal applicant (the primary client) is auto-added with this role. */
export const PRINCIPAL_ROLE_KEY: PartyRoleKey = "petitioner";

/** Default bilingual labels — the admin can override per service. */
export const DEFAULT_PARTY_ROLE_LABELS: Record<PartyRoleKey, { es: string; en: string }> = {
  petitioner: { es: "Solicitante", en: "Applicant" },
  beneficiary: { es: "Beneficiario", en: "Beneficiary" },
  spouse: { es: "Cónyuge", en: "Spouse" },
  minor: { es: "Hijo/a", en: "Child" },
  guardian: { es: "Tutor", en: "Guardian" },
  witness: { es: "Testigo", en: "Witness" },
  member: { es: "Miembro", en: "Member" },
  other: { es: "Otro", en: "Other" },
};

/** A role is either "single" (at most one party) or "multiple" (many parties). */
export const PARTY_ROLE_CARDINALITIES = ["single", "multiple"] as const;
export type PartyRoleCardinality = (typeof PARTY_ROLE_CARDINALITIES)[number];

/** Type guard: is the given string one of the 8 canonical role keys? */
export function isPartyRoleKey(value: string): value is PartyRoleKey {
  return (PARTY_ROLE_KEYS as readonly string[]).includes(value);
}
