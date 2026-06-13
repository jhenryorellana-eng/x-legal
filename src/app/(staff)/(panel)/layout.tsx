/**
 * Staff panel shell (DOC-50 §1.3, DOC-53 §0).
 *
 * Server Component: builds the Actor, filters the navigation by the actor's
 * module permissions (admin sees all — DOC-22 §5.4), resolves the staff profile
 * for the user-chip, and mounts the StaffShell (Sidebar + Topbar + content).
 *
 * Boundary rule R1/R2 (DOC-21): this app-layer file reads via the identity
 * module-pub index and passes data + the logout action as props to the client
 * shell. It never imports backend internals or platform directly.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import {
  getActor,
  getCurrentStaffProfile,
} from "@/backend/modules/identity";
import { signOutAction } from "@/backend/modules/identity/actions";
import { resolveI18n, type Locale } from "@/shared/i18n";
import { STAFF_NAV, filterNav } from "@/frontend/lib/nav";
import {
  StaffShell,
  type StaffShellMessages,
} from "@/frontend/features/staff-shell/staff-shell";
import type { SidebarGroup } from "@/frontend/components/desktop/sidebar";
import { MaterialSymbolsFont } from "@/frontend/features/vanessa";

/** Fallback role labels (used when no title_i18n is set). */
const ROLE_LABEL_KEY: Record<string, string> = {
  admin: "admin",
  sales: "sales",
  paralegal: "paralegal",
  finance: "finance",
};

export default async function StaffPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await getActor();
  // Defense-in-depth: the middleware already guards the surface (DOC-22 §5.4),
  // but a missing/cross-kind actor here means no panel.
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff");
  const tNavRaw = await getTranslations("staff.nav");
  const tRolesRaw = await getTranslations("staff.roles");

  // The nav + role keys are data-driven (STAFF_NAV / actor.role) → dynamic;
  // next-intl types each call against the literal key set, so we wrap with a
  // string-keyed view.
  const tNav = tNavRaw as unknown as (key: string) => string;
  const tRoles = tRolesRaw as unknown as (key: string) => string;

  // Filter the nav by permission (admin bypass via the Actor's role).
  const filtered = filterNav(STAFF_NAV, (module) => {
    if (actor.role === "admin") return true;
    const p = actor.permissions.get(module);
    return Boolean(p && (p.view || p.edit));
  });

  const groups: SidebarGroup[] = filtered.map((group) => ({
    label: tNav(`groups.${group.labelKey}`),
    items: group.items.map((item) => ({
      label: tNav(`items.${item.labelKey}`),
      href: item.href,
      icon: item.icon,
      // Badge counts arrive in F1-W2 (Realtime EV-33/EV-35); structure is here.
      badge: undefined,
    })),
  }));

  // Resolve the user-chip from the staff profile (name, title, avatar).
  const profile = await getCurrentStaffProfile();
  const roleKey = actor.role ? ROLE_LABEL_KEY[actor.role] : undefined;
  const fallbackRole = roleKey ? tRoles(roleKey) : tRoles("staff");
  const title =
    (profile?.titleI18n && resolveI18n(profile.titleI18n, locale)) ||
    fallbackRole;

  const messages: StaffShellMessages = {
    panelLabel: t("shell.panelLabel"),
    searchPlaceholder: t("shell.searchPlaceholder"),
    notificationsLabel: t("shell.notifications"),
    logout: t("shell.logout"),
  };

  return (
    <>
      {/* Material Symbols Rounded — icon vocabulary of the sales panel (DOC-52 §0.1). */}
      <MaterialSymbolsFont />
      <StaffShell
        groups={groups}
        user={{
          name: profile?.displayName ?? fallbackRole,
          title,
          avatarUrl: profile?.avatarUrl ?? undefined,
        }}
        messages={messages}
        logoutAction={signOutAction}
      >
        {children}
      </StaffShell>
    </>
  );
}
