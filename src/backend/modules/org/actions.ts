/**
 * Org module server actions — public surface (module-pub boundary).
 *
 * Each action: requireActor() → delegate to service.ts (which calls can()) →
 * typed result. These are the org-config mutations proposed in DOC-53 P-53-2
 * (org settings, cover-template activation, terms versions). No "use server"
 * directive here — Next.js wrappers in src/app/ add it and pass these as props
 * (DOC-21 R1/R2, same pattern as catalog/actions.ts).
 *
 * API-IDs (proposed): API-ORG-02/04/06/07.
 */

import { requireActor } from "@/backend/platform/authz";
import { AuthzError } from "@/backend/platform/authz";
import { OrgError } from "./domain";
import * as svc from "./service";

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}

function fail(err: unknown): ActionResult<never> {
  if (err instanceof OrgError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof AuthzError) {
    return { success: false, error: { code: err.reason, message: err.reason } };
  }
  const message = err instanceof Error ? err.message : "Unexpected error";
  return { success: false, error: { code: "INTERNAL_ERROR", message } };
}

/** @api-id API-ORG-02 (P-53-2a) */
export async function updateOrgSettingsAction(
  patch: Parameters<typeof svc.updateOrgSettings>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.updateOrgSettings>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.updateOrgSettings(actor, patch));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-ORG-04 (P-53-2b) */
export async function setCoverTemplateActiveAction(
  templateId: string,
  active: boolean,
): Promise<ActionResult<Awaited<ReturnType<typeof svc.setCoverTemplateActive>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.setCoverTemplateActive(actor, templateId, active));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-ORG-06 (P-53-2c) */
export async function createTermsVersionAction(
  input: Parameters<typeof svc.createTermsVersion>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.createTermsVersion>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.createTermsVersion(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-ORG-07 (P-53-2c) */
export async function publishTermsVersionAction(
  versionId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof svc.publishTermsVersion>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.publishTermsVersion(actor, versionId));
  } catch (e) {
    return fail(e);
  }
}
