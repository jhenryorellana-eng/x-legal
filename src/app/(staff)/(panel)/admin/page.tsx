/**
 * Admin dashboard — /admin (DOC-53 §1).
 *
 * Server Component: builds the Actor (guard), greets the admin by name, and
 * loads the KPIs available at this point (DOC-80): active employees via the
 * identity module (real read). Active cases + active services land in F1-W2
 * (the catalog/cases modules are being built in parallel — this page does NOT
 * read from them yet).
 *
 * Reads via module-pub index only (R1/R2); passes resolved data + i18n strings
 * as props to the client view.
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  getActor,
  countActiveEmployees,
  getCurrentStaffProfile,
} from "@/backend/modules/identity";
import { listServicesAdmin } from "@/backend/modules/catalog";
import { staffHomePath } from "@/shared/staff-routes";
import {
  DashboardView,
  type DashboardMessages,
} from "@/frontend/features/admin-dashboard/dashboard-view";

export default async function AdminDashboardPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  // Role-aware landing: only admins (or catalog-capable staff) belong on this
  // dashboard, which reads catalog/employee KPIs. A non-admin role (sales,
  // paralegal, finance) is routed to its own panel — otherwise listServicesAdmin
  // would throw forbidden_module and crash the page (DOC-22 §5.4).
  if (actor.role && actor.role !== "admin") {
    redirect(staffHomePath(actor.role));
  }

  const t = await getTranslations("staff.dashboard");

  // Real KPIs available at F1: active employees (identity) + active services
  // (catalog). Active cases land when the cases module ships (em-dash until then).
  const [activeEmployees, profile] = await Promise.all([
    countActiveEmployees(),
    getCurrentStaffProfile(),
  ]);
  // Catalog KPI degrades to em-dash (null) if the actor lacks catalog access —
  // never crash the dashboard on a permission check (defense in depth).
  let activeServices: number | null = null;
  try {
    const services = await listServicesAdmin(actor);
    activeServices = services.filter((s) => s.is_active && s.archived_at === null).length;
  } catch {
    activeServices = null;
  }
  const firstName = (profile?.displayName ?? "").split(" ")[0] || "";

  const messages: DashboardMessages = {
    greeting: firstName ? t("greetingName", { name: firstName }) : t("greeting"),
    sub: t("sub"),
    periodToday: t("period.today"),
    period7: t("period.d7"),
    period30: t("period.d30"),
    periodCustom: t("period.custom"),
    kpiCases: t("kpi.cases"),
    kpiServices: t("kpi.services"),
    kpiEmployees: t("kpi.employees"),
    kpiRevenue: t("kpi.revenue"),
    kpiConversion: t("kpi.conversion"),
    cardCasesByService: t("card.casesByService"),
    cardCasesByPhase: t("card.casesByPhase"),
    cardRevenue: t("card.revenue"),
    cardFunnel: t("card.funnel"),
    cardValidations: t("card.validations"),
    cardAiCost: t("card.aiCost"),
    cardActivity: t("card.activity"),
    comingSoon: t("comingSoon"),
    activityEmptyTitle: t("activityEmpty.title"),
    activityEmptySub: t("activityEmpty.sub"),
    pendingData: t("pendingData"),
  };

  return (
    <DashboardView
      kpis={{
        // Active cases land with the cases module (em-dash until then).
        activeCases: null,
        activeServices,
        activeEmployees,
      }}
      messages={messages}
    />
  );
}
