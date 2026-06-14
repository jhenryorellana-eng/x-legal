/**
 * Role-aware staff landing routes (DOC-22 §5.4).
 *
 * Each staff role lands on its own panel after login. The admin dashboard
 * (/admin) reads catalog + employee KPIs that require admin/catalog permissions,
 * so a non-admin (e.g. sales) must be routed to their own home instead of
 * crashing on a permission check.
 */

export type StaffRole = "admin" | "sales" | "paralegal" | "finance" | null;

/** The home route for a staff role. Sales→ventas, paralegal→legal, finance→finanzas, admin→admin. */
export function staffHomePath(role: StaffRole): string {
  switch (role) {
    case "sales":
      return "/ventas/mi-dia";
    case "paralegal":
      return "/legal";
    case "finance":
      return "/finanzas";
    case "admin":
      return "/admin";
    default:
      // Unknown/null role: send to the sales panel (the broadest read-light home)
      // rather than the admin dashboard, which would 403 on catalog reads.
      return "/ventas/mi-dia";
  }
}
