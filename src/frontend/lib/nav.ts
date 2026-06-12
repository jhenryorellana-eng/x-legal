/**
 * Staff navigation tree (DOC-53 §0.2, DOC-50 §1.3).
 *
 * The full navigation of the organization, grouped exactly as the admin sees
 * it. Each item declares the `module` (a MODULE_KEY) that gates its visibility:
 * the layout filters items by `canUi(actor, module, 'view')` (admin sees all,
 * DOC-22 §5.4) before passing the result to the presentational Sidebar.
 *
 * - `labelKey` / `groupKey` resolve against the `staff.nav` i18n namespace.
 * - `icon` is a brand Icon name (DOC-01 §6: brand icons where they match).
 * - `badge` names a counter key the layout may resolve (Realtime, DOC-53 §0.2);
 *   F1-W1 ships the structure, counts arrive in W2.
 *
 * Pure data + a pure filter — no React, importable by lib/components.
 */

import type { IconName } from "@/frontend/components/brand/icon";
import type { ModuleKey } from "@/shared/constants/modules";

export type NavBadgeKey = "cases" | "pagos";

export interface NavItem {
  /** i18n key under `staff.nav.items`. */
  labelKey: string;
  href: string;
  icon: IconName;
  /** Module that gates visibility (DOC-22 §5.4). */
  module: ModuleKey;
  /** Optional red badge counter (DOC-53 §0.2). */
  badge?: NavBadgeKey;
}

export interface NavGroup {
  /** i18n key under `staff.nav.groups`. */
  labelKey: string;
  items: NavItem[];
}

/**
 * The canonical staff navigation (DOC-53 §0.2 table). Routes point to the
 * existing segments of DOC-21; modules without permission are filtered out by
 * the layout. Admin sees everything.
 */
export const STAFF_NAV: NavGroup[] = [
  {
    labelKey: "general",
    items: [
      { labelKey: "dashboard", href: "/admin", icon: "grid", module: "dashboard" },
    ],
  },
  {
    labelKey: "operations",
    items: [
      { labelKey: "cases", href: "/admin/casos", icon: "briefcase", module: "cases", badge: "cases" },
      { labelKey: "calendar", href: "/ventas/citas", icon: "calendar", module: "calendar" },
      { labelKey: "expedientes", href: "/legal/expediente", icon: "doc", module: "expedientes" },
      { labelKey: "validations", href: "/legal/validaciones", icon: "shield", module: "validations" },
      { labelKey: "printing", href: "/finanzas/impresion", icon: "copy", module: "printing" },
    ],
  },
  {
    labelKey: "sales",
    items: [
      { labelKey: "leads", href: "/ventas/leads", icon: "route", module: "leads" },
      { labelKey: "clients", href: "/ventas/clientes", icon: "family", module: "clients" },
      { labelKey: "salesMetrics", href: "/ventas/metricas", icon: "bolt", module: "metrics" },
    ],
  },
  {
    labelKey: "finance",
    items: [
      { labelKey: "payments", href: "/finanzas/pagos", icon: "card", module: "billing", badge: "pagos" },
      { labelKey: "accounting", href: "/finanzas/contabilidad", icon: "wallet", module: "accounting" },
      { labelKey: "campaigns", href: "/finanzas/campanas", icon: "megaphone", module: "campaigns" },
    ],
  },
  {
    labelKey: "catalog",
    items: [
      { labelKey: "services", href: "/admin/catalogo", icon: "grid", module: "catalog" },
      { labelKey: "datasets", href: "/admin/datasets", icon: "sparkle", module: "datasets" },
    ],
  },
  {
    labelKey: "administration",
    items: [
      { labelKey: "employees", href: "/admin/empleados", icon: "user", module: "employees" },
      { labelKey: "audit", href: "/admin/auditoria", icon: "scale", module: "audit" },
      { labelKey: "settings", href: "/admin/configuracion", icon: "gear", module: "dashboard" },
    ],
  },
];

/**
 * Filters the nav tree by a permission predicate (canUi mirror, DOC-50 §3).
 * Groups left with zero visible items are dropped.
 */
export function filterNav(
  groups: NavGroup[],
  canView: (module: ModuleKey) => boolean,
): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canView(item.module)),
    }))
    .filter((group) => group.items.length > 0);
}
