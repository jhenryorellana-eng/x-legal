/**
 * Case tab access — /admin/configuracion/tabs-caso.
 *
 * Admin matrix to configure which case-workspace tabs each staff role sees
 * (visibility only; order + state-gating stay in code). Server Component: guards
 * admin, reads the org overrides, resolves labels, and injects the bulk-save
 * action into the client matrix.
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getCaseTabAccess } from "@/backend/modules/case-tabs";
import { setCaseTabAccessAction } from "@/backend/modules/case-tabs/actions";
import {
  CANONICAL_TAB_ORDER,
  ROLE_DEFAULT_TAB_ORDER,
  STAFF_ROLES,
  TAB_LOCKED_UNTIL_ACTIVE,
  type CaseTabId,
  type StaffRole,
} from "@/shared/constants/case-tabs";
import { CaseTabAccessView } from "@/frontend/features/admin/case-tabs/case-tab-access-view";

/** CaseTabId → key under staff.casos.detail.tabs (admin-facing label). */
const TAB_LABEL_KEY: Record<CaseTabId, string> = {
  resumen: "resumen",
  contrato: "contrato",
  pagos: "pagos",
  documentos: "documentos",
  formularios: "formularios",
  generaciones: "generaciones",
  citas: "citasRoute",
  expediente: "expediente",
  validacion: "validacion",
  fasesAnteriores: "fasesAnteriores",
  preMortem: "preMortem",
  traspaso: "traspaso",
  notas: "notas",
  historial: "historial",
};

const LOCKED = new Set<CaseTabId>(TAB_LOCKED_UNTIL_ACTIVE);

export default async function CaseTabAccessPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");
  if (actor.role !== "admin") redirect("/admin");

  const tCaseRaw = await getTranslations("staff.casos");
  // Dynamic tab-label keys (detail.tabs.<id>) — next-intl types want literals.
  const tCase = tCaseRaw as unknown as (key: string) => string;
  const tTabs = await getTranslations("staff.caseTabs");

  const access = await getCaseTabAccess(actor).catch(() => ({ allowedByRole: {} as Record<StaffRole, CaseTabId[]> }));

  const tabs = CANONICAL_TAB_ORDER.map((id) => ({
    id,
    label: tCase(`detail.tabs.${TAB_LABEL_KEY[id]}`),
    locked: LOCKED.has(id),
  }));

  const roles = STAFF_ROLES.map((role) => ({
    role,
    label: tTabs(`role_${role}`),
  }));

  const initial = {} as Record<StaffRole, CaseTabId[]>;
  for (const role of STAFF_ROLES) {
    initial[role] = access.allowedByRole[role] ?? [...ROLE_DEFAULT_TAB_ORDER[role]];
  }

  const messages = {
    title: tTabs("title"),
    sub: tTabs("sub"),
    colTab: tTabs("colTab"),
    save: tTabs("save"),
    saved: tTabs("saved"),
    saveError: tTabs("saveError"),
    reset: tTabs("reset"),
    lockedNote: tTabs("lockedNote"),
    conditionalNote: tTabs("conditionalNote"),
    lockedBadge: tTabs("lockedBadge"),
  };

  return (
    <CaseTabAccessView
      tabs={tabs}
      roles={roles}
      initial={initial}
      defaults={ROLE_DEFAULT_TAB_ORDER}
      messages={messages}
      save={setCaseTabAccessAction}
    />
  );
}
