/**
 * Diana — "Mi día" (legal) · /legal/mi-dia.
 *
 * Server Component: composes Diana's actionable work across her owned cases
 * (documents to review, forms in progress, expedientes to assemble, lawyer
 * corrections) into a "pendientes" list with deep links that resume the work,
 * plus her personal task checklist (staff_tasks). Every signal is real — the
 * page degrades gracefully (best-effort reads) rather than showing false zeros.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { formatInTimeZone } from "date-fns-tz";
import {
  getActor,
  getCurrentUserLocation,
  getCurrentStaffProfile,
} from "@/backend/modules/identity";
import {
  listCasesByOwner,
  getCaseBoardAlerts,
  getCaseFormResponsesForStaff,
} from "@/backend/modules/cases";
import type { AdminCaseListItem, CaseBoardAlert } from "@/backend/modules/cases";
import { getCaseExpedientes } from "@/backend/modules/expediente";
import { listMyTasks } from "@/backend/modules/kanban";
import { fmtHeaderDate, tzLabel, type Locale } from "@/frontend/lib/datetime";
import { LegalMiDiaView } from "@/frontend/features/legal/mi-dia/legal-mi-dia-view";
import type {
  LegalKpi,
  PendienteVM,
  PersonalTaskVM,
  LegalMiDiaStrings,
} from "@/frontend/features/legal/mi-dia/legal-mi-dia-view";
import {
  createTaskAction,
  toggleTaskDoneAction,
  updateTaskAction,
  deleteTaskAction,
} from "./actions";

export const dynamic = "force-dynamic";

/** Expediente statuses that still need Diana's hands (assembler open). */
const EXPEDIENTE_OPEN = new Set(["draft", "compile_failed"]);

export default async function LegalMiDiaPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.legal.miDia");
  // Fall back to ET (the org's home zone) if the staff member has no location
  // set yet — date-fns-tz throws on a null/invalid IANA zone, which would 500
  // the page outside the data try/catch below.
  const staffTz = (await getCurrentUserLocation(actor)).timezone ?? "America/New_York";
  const profile = await getCurrentStaffProfile();
  const name = profile?.displayName ?? "Diana";

  // ── Data ───────────────────────────────────────────────────────────────
  let cases: AdminCaseListItem[] = [];
  let alertsMap: Record<string, CaseBoardAlert> = {};
  let tasks: PersonalTaskVM[] = [];
  // Per-case expediente "open" flag and forms-pending flag.
  const expedienteOpen = new Set<string>();
  const formsPending = new Map<string, "draft" | "approve">();

  try {
    cases = await listCasesByOwner(actor);
    const caseIds = cases.map((c) => c.id);

    const [alerts, taskRows] = await Promise.all([
      getCaseBoardAlerts(actor, caseIds).catch(() => ({})),
      listMyTasks(actor, { includeDone: true }).catch(() => []),
    ]);
    alertsMap = alerts;
    tasks = taskRows.map((task) => ({
      id: task.id,
      text: task.text,
      tag: task.tag ?? "",
      done: task.done_at !== null,
    }));

    // Cross-module signals (bounded by the small number of owned cases).
    await Promise.all(
      cases.map(async (c) => {
        const [exps, forms] = await Promise.all([
          getCaseExpedientes(actor, c.id).catch(() => []),
          getCaseFormResponsesForStaff(actor, c.id).catch(() => []),
        ]);
        const latest = [...exps].sort((a, b) => b.attempt_no - a.attempt_no)[0];
        if (latest && EXPEDIENTE_OPEN.has(latest.status)) expedienteOpen.add(c.id);
        // A staff/both form still in draft → "continuar"; a submitted client form → "aprobar".
        if (forms.some((f) => f.status === "draft" && f.filledBy !== "client")) {
          formsPending.set(c.id, "draft");
        } else if (forms.some((f) => f.status === "submitted")) {
          formsPending.set(c.id, "approve");
        }
      }),
    );
  } catch (err) {
    // Log message only (the app layer can't import the platform logger per
    // eslint-boundaries; avoid dumping the full error to keep PII out of stdout).
    console.error("[/legal/mi-dia] load failed:", err instanceof Error ? err.message : String(err));
  }

  // ── Pendientes (derived work) ──────────────────────────────────────────
  const pendientes: PendienteVM[] = [];
  for (const c of cases) {
    const a = alertsMap[c.id];
    const base = { caseId: c.id, caseNumber: c.caseNumber, clientName: c.clientName ?? "—" };

    if (a && a.needsReview > 0) {
      pendientes.push({
        ...base,
        id: `${c.id}-docs`,
        icon: "fact_check",
        title: t("pendDocs"),
        detail: t("pendDocsDetail", { n: a.needsReview }),
        href: `/legal/caso/${c.id}`,
        tone: "info",
      });
    }
    if (a?.rfeOverdue) {
      pendientes.push({
        ...base, id: `${c.id}-rfe`, icon: "schedule", title: t("pendRfe"),
        href: `/legal/caso/${c.id}`, tone: "danger",
      });
    }
    if (a?.generationFailed) {
      pendientes.push({
        ...base, id: `${c.id}-gen`, icon: "error", title: t("pendGen"),
        href: `/legal/caso/${c.id}`, tone: "danger",
      });
    }
    const form = formsPending.get(c.id);
    if (form) {
      pendientes.push({
        ...base,
        id: `${c.id}-form`,
        icon: "edit_document",
        title: form === "draft" ? t("pendForm") : t("pendFormApprove"),
        href: `/legal/caso/${c.id}?tab=formularios`,
        tone: "warn",
      });
    }
    if (expedienteOpen.has(c.id)) {
      pendientes.push({
        ...base, id: `${c.id}-exp`, icon: "library_books", title: t("pendExpediente"),
        href: `/legal/expediente/${c.id}`, tone: "warn",
      });
    }
    if (a?.lawyerCorrections) {
      pendientes.push({
        ...base, id: `${c.id}-corr`, icon: "balance", title: t("pendCorrections"),
        href: `/legal/validaciones/${c.id}`, tone: "danger",
      });
    }
  }
  // Danger first, then warn, then info.
  const toneRank: Record<PendienteVM["tone"], number> = { danger: 0, warn: 1, info: 2, ok: 3 };
  pendientes.sort((x, y) => toneRank[x.tone] - toneRank[y.tone]);

  // ── KPIs ────────────────────────────────────────────────────────────────
  const totalReview = Object.values(alertsMap).reduce((s, a) => s + a.needsReview, 0);
  const correctionsCount = Object.values(alertsMap).filter((a) => a.lawyerCorrections).length;
  const activeCases = cases.filter((c) => c.status === "active" || c.status === "in_validation").length;
  const kpis: LegalKpi[] = [
    { icon: "fact_check", value: totalReview, label: t("kpiReview"), tone: "#2F6BFF", hot: totalReview > 0 },
    { icon: "library_books", value: expedienteOpen.size, label: t("kpiExpedientes"), tone: "#8B5CF6" },
    { icon: "balance", value: correctionsCount, label: t("kpiCorrections"), tone: "#E5484D" },
    { icon: "work", value: activeCases, label: t("kpiCases"), tone: "#1BB673" },
  ];

  // ── Greeting / strings ───────────────────────────────────────────────────
  const now = new Date();
  const localHour = Number(formatInTimeZone(now, staffTz, "H"));
  const greetKey = localHour < 12 ? "greetingMorning" : localHour < 19 ? "greetingAfternoon" : "greetingEvening";

  const strings: LegalMiDiaStrings = {
    greeting: t(greetKey, { name }),
    dateLine: t("dateLine", { date: fmtHeaderDate(now, staffTz, locale) }),
    tzChip: t("tzChip", { region: tzLabel(staffTz, locale) }),
    kpiReview: t("kpiReview"),
    kpiExpedientes: t("kpiExpedientes"),
    kpiCorrections: t("kpiCorrections"),
    kpiCases: t("kpiCases"),
    pendientesTitle: t("pendientesTitle"),
    pendientesChip: t("pendientesChip"),
    emptyPendientes: t("emptyPendientes"),
    continueCta: t("continueCta"),
    tasksTitle: t("tasksTitle"),
    addTaskPh: t("addTaskPh"),
    addTask: t("addTask"),
    emptyTasks: t("emptyTasks"),
    editTask: t("editTask"),
    deleteTask: t("deleteTask"),
    confirmDelete: t("confirmDelete"),
    taskError: t("taskError"),
  };

  return (
    <LegalMiDiaView
      kpis={kpis}
      pendientes={pendientes}
      tasks={tasks}
      strings={strings}
      actions={{
        createTask: createTaskAction,
        toggleTask: toggleTaskDoneAction,
        updateTask: updateTaskAction,
        deleteTask: deleteTaskAction,
      }}
    />
  );
}
