"use server";

/**
 * Org-config server actions for the admin panel (DOC-53 §9, P-53-2).
 *
 * Thin "use server" wrappers over the org module-pub actions, passed as props to
 * the client config view (DOC-21 R1/R2). The org actions already carry
 * requireActor + can(); these just expose them as Server Actions.
 */

import {
  updateOrgSettingsAction,
  setCoverTemplateActiveAction,
  createTermsVersionAction,
  publishTermsVersionAction,
} from "@/backend/modules/org/actions";

export async function saveOrgSettings(patch: {
  name?: string;
  contact_phones?: { label: string; phone: string }[];
  default_timezone?: string;
}) {
  const r = await updateOrgSettingsAction(patch);
  return r.success ? { success: true } : { success: false, error: r.error };
}

export async function setCoverActive(id: string, active: boolean) {
  const r = await setCoverTemplateActiveAction(id, active);
  return r.success ? { success: true } : { success: false, error: r.error };
}

export async function createTerms(input: {
  version: string;
  title_i18n: { es: string; en: string };
  body_md_i18n: { es: string; en: string };
}) {
  const r = await createTermsVersionAction(input);
  return r.success ? { success: true } : { success: false, error: r.error };
}

export async function publishTerms(id: string) {
  const r = await publishTermsVersionAction(id);
  return r.success ? { success: true } : { success: false, error: r.error };
}
