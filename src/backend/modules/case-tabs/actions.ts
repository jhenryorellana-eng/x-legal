"use server";

/**
 * case-tabs — server actions (module-pub border).
 *
 * Injected into the admin matrix UI. Read is staff-scoped (RLS); write is
 * admin-only (service-enforced). @module case-tabs/actions
 */

import { requireActor, AuthzError } from "@/backend/platform/authz";
import { logger } from "@/backend/platform/logger";
import type { CaseTabId, StaffRole } from "@/shared/constants/case-tabs";
import { getCaseTabAccess, setCaseTabAccess, type CaseTabAccessDto } from "./service";

export async function getCaseTabAccessAction(): Promise<
  { ok: true; data: CaseTabAccessDto } | { ok: false; error: { code: string } }
> {
  try {
    const actor = await requireActor();
    const data = await getCaseTabAccess(actor);
    return { ok: true, data };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "getCaseTabAccessAction failed");
    return { ok: false, error: { code: "error" } };
  }
}

export async function setCaseTabAccessAction(input: {
  access: Array<{ role: StaffRole; tabIds: CaseTabId[] }>;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await setCaseTabAccess(actor, input);
    return { ok: true };
  } catch (err) {
    const code = err instanceof AuthzError ? err.reason : "error";
    logger.warn({ err: (err as Error).message }, "setCaseTabAccessAction failed");
    return { ok: false, error: { code } };
  }
}
