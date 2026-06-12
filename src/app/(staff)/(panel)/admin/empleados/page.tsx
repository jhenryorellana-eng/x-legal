/**
 * Employees & permissions — /admin/empleados (DOC-53 §7).
 *
 * Server Component: guards the actor, reads the employee list via the identity
 * module-pub action (RSC read), resolves the title i18n + invite-pending flag,
 * and passes the data + i18n strings + server actions as props to the client
 * view (DOC-21 R1/R2 — app reads via module-pub, mutations via "use server").
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { listEmployeesAction } from "@/backend/modules/identity/actions";
import { resolveI18n, type Locale } from "@/shared/i18n";
import { MODULE_KEYS } from "@/shared/constants/modules";
import { ROLE_PRESETS } from "@/shared/constants/role-presets";
import {
  EmployeesView,
  type EmployeeVM,
} from "@/frontend/features/admin/employees/employees-view";
import {
  inviteEmployeeUi,
  updatePermissionsUi,
  setEmployeeActiveUi,
} from "./actions";

export default async function EmployeesPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.admin");
  const tt = t as unknown as (key: string) => string;

  const result = await listEmployeesAction();
  const employees: EmployeeVM[] = result.ok
    ? result.data.employees.map((e) => ({
        userId: e.userId,
        email: e.email,
        isActive: e.isActive,
        displayName: e.displayName,
        role: e.role,
        title: resolveI18n(e.titleI18n, locale) || "",
        avatarUrl: e.avatarUrl,
        permissions: e.permissions,
        // Invitation pending heuristic: an active staff with zero last-sign-in
        // signal is not available here; surfaced when the list later includes it.
        invitePending: false,
      }))
    : [];

  const messages = {
    t: buildStrings(tt),
    moduleLabels: Object.fromEntries(
      MODULE_KEYS.map((k) => [k, tt(`employees.moduleLabels.${k}`)]),
    ),
  };

  return (
    <EmployeesView
      employees={employees}
      moduleKeys={MODULE_KEYS}
      rolePresets={ROLE_PRESETS}
      messages={messages}
      actions={{
        invite: inviteEmployeeUi,
        updatePermissions: updatePermissionsUi,
        setActive: setEmployeeActiveUi,
      }}
    />
  );
}

/** Flattens the employees + common i18n keys into the flat map the view uses. */
function buildStrings(tt: (k: string) => string): Record<string, string> {
  const keys = [
    "title", "sub", "newEmployee", "permissionMatrix", "filterRole", "filterStatus",
    "filterSearch", "colEmployee", "colEmail", "colRole", "colStatus", "colLastSeen",
    "colPermissions", "roleAdmin", "roleSales", "roleParalegal", "roleFinance",
    "statusActive", "statusInactive", "invitePending", "permSummary", "menuEdit",
    "menuPermissions", "menuResend", "menuDeactivate", "menuReactivate", "emptyTitle",
    "emptySub", "createTitle", "stepProfile", "stepPermissions", "fieldEmail", "fieldName",
    "fieldTitle", "fieldRole", "emailTaken", "presetSales", "presetParalegal",
    "presetFinance", "createCta", "inviteSent", "tabProfile", "tabPermissions",
    "tabSecurity", "matrixHeader", "colModule", "colView", "colEdit", "applyPreset",
    "copyFrom", "removeAll", "adminRowNote", "savedToast", "revokeCasesWarn",
    "deactivateTitle", "deactivateBody", "deactivateConfirm", "reactivateTitle",
    "reactivateBody", "securityCloseSessions", "securityRemoveTotp",
  ];
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = tt(`employees.${k}`);
  out.cancel = tt("common.cancel");
  out.save = tt("common.save");
  out.next = tt("common.next");
  out.back = tt("common.back");
  return out;
}
