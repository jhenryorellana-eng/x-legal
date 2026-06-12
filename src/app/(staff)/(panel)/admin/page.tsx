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
import {
  DashboardView,
  type DashboardMessages,
} from "@/frontend/features/admin-dashboard/dashboard-view";

export default async function AdminDashboardPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const t = await getTranslations("staff.dashboard");

  // Real KPI (identity read). Active cases + services are wired in W2.
  const activeEmployees = await countActiveEmployees();
  const profile = await getCurrentStaffProfile();
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
        // TODO(F1-W2): wire activeCases (cases/index.ts) + activeServices
        // (catalog/index.ts) once those modules land. Null renders an em-dash.
        activeCases: null,
        activeServices: null,
        activeEmployees,
      }}
      messages={messages}
    />
  );
}
