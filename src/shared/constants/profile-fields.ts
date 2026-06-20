/**
 * Whitelist of client profile fields allowed as source='profile' in
 * form_questions. DOC-40 §2.7.
 *
 * PII fields (pii.*) are resolved locally via pdf-lib in the fill step —
 * they are NEVER sent to AI models (DOC-74 §7.1).
 */
export const PROFILE_SOURCE_FIELDS = [
  "first_name",
  "last_name",
  "preferred_name",
  "country_of_origin",
  "address.line1",
  "address.apartment",
  "address.city",
  "address.state",
  "address.zip",
  "phone_e164",
  "email",
  "pii.ssn",
  "pii.a_number",
  "pii.passport",
] as const;

export type ProfileSourceField = (typeof PROFILE_SOURCE_FIELDS)[number];
