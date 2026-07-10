/**
 * Home — `/home` · nivel CUENTA (pestaña "Mis casos") — DOC-51 §5.
 *
 * Server component. Reads the client's cases (cases module), enriches each with
 * its service/phase/progress (getCaseWorkspace), the unread notification count
 * (notifications module) and the client display name. Renders the multi-case
 * dashboard (réplica del prototipo `screens6.jsx → DashboardScreen`).
 *
 * Auth: middleware gates /home to authenticated clients; we re-check kind here.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import {
  getCasesForClient,
  getCaseWorkspace,
  getClientDisplayName,
  type CaseWorkspaceDto,
  type CaseStatus,
} from "@/backend/modules/cases";
import {
  getCaseOnboardingContract,
  getTermsStatusForCase,
  type TermsStatusView,
} from "@/backend/modules/contracts";
import { getNotifications } from "@/backend/modules/notifications";
import { getUnreadCountAction } from "@/backend/modules/notifications/actions";
import { pickLocale, coerceIcon, type Locale } from "@/frontend/features/cliente/shared/i18n";
import {
  DashboardScreen,
  type DashboardCase,
  type OnboardingCase,
} from "@/frontend/features/cliente/home/dashboard-screen";

export default async function HomePage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("cliente.home");
  const tNav = await getTranslations("cliente.nav");

  const displayName = (await getClientDisplayName(actor)) ?? "";
  const avatarInitial = displayName.charAt(0).toUpperCase() || "U";

  // List the client's cases, then enrich each with its workspace (service/phase
  // /progress) AND its terms status (drives the card href). RLS scopes the list
  // to cases the client is a member of. Parallelized per case — and the two reads
  // per case run together — so the dashboard isn't an N+1 waterfall. If a case the
  // client owns can't be fully read, we KEEP the row (workspace: null) so it still
  // shows as a minimal card — a case must never silently disappear from the
  // client's home. A terms read error fails open (the card then points at /camino).
  const casesPage = await getCasesForClient(actor, { limit: 20 });
  type CaseListRow = (typeof casesPage.items)[number];
  type EnrichedCase = {
    row: CaseListRow;
    workspace: CaseWorkspaceDto | null;
    terms: TermsStatusView | null;
  };
  const enriched: EnrichedCase[] = await Promise.all(
    casesPage.items.map(async (c): Promise<EnrichedCase> => {
      try {
        const [workspace, terms] = await Promise.all([
          getCaseWorkspace(actor, c.id),
          getTermsStatusForCase(actor, c.id).catch(() => null),
        ]);
        return { row: c, workspace, terms };
      } catch {
        return { row: c, workspace: null, terms: null };
      }
    }),
  );

  // Unread notifications: count from the first page (read_at is null).
  let unreadCount = 0;
  try {
    const notifs = await getNotifications(actor, { limit: 50 });
    unreadCount = notifs.items.filter((n) => n.read_at == null).length;
  } catch {
    unreadCount = 0;
  }

  // Raw ICU templates: these carry placeholders ({x}/{y}/{phase}, {name}, {n})
  // that are substituted downstream (here for phase, in DashboardScreen for the
  // others). t() would try to format them and throw FORMATTING_ERROR because the
  // values aren't passed at call time — t.raw() returns the literal template.
  const phaseTpl = t.raw("phaseShort") as string; // "Fase {x} de {y} · {phase}"
  const tStatus = await getTranslations("cliente.home.statusByState");

  // Split the client's cases into onboarding (payment_pending — the client must
  // sign the contract AND pay the initial fee before the workspace unlocks) and
  // active cases. Onboarding cases get a dedicated step card (sign → pay); active
  // cases all render with the same consistent CaseCard. A case whose workspace
  // couldn't be read falls back to its row data (case number as title) so it
  // still appears — never dropped.
  const onboardingCases: OnboardingCase[] = [];
  const cases: DashboardCase[] = [];
  for (const e of enriched) {
    const ws = e.workspace;
    const status = (ws?.status ?? e.row.status) as CaseStatus;
    const serviceName = ws ? pickLocale(ws.service?.labelI18n, locale) : null;
    const party = ws?.parties[0]?.name;
    const title = serviceName
      ? party
        ? `${serviceName} — ${party}`
        : serviceName
      : e.row.case_number;
    const serviceIcon = coerceIcon(ws?.service?.icon, "shield");
    const serviceColor = ws?.service?.color || "var(--accent)";

    if (status === "payment_pending") {
      // Read the contract (membership-gated via requireCaseAccess) to know which
      // onboarding step the client is on. `sent` → still to sign; `signed` →
      // signed, waiting on the down payment; else (draft/cancelled/null) → preparing.
      let step: OnboardingCase["step"] = "preparing";
      let signHref: string | null = null;
      try {
        const contract = await getCaseOnboardingContract(actor, e.row.id);
        if (contract?.status === "signed") {
          step = "pay";
        } else if (contract?.status === "sent" && contract.signingToken) {
          step = "sign";
          signHref = `/firma/${contract.signingToken}`;
        }
      } catch {
        // Contract unreadable (rare) — leave as "preparing" (no actionable CTA).
      }
      onboardingCases.push({ caseId: e.row.id, title, serviceIcon, serviceColor, step, signHref });
      continue;
    }

    const phaseName = ws?.phase ? pickLocale(ws.phase.labelI18n, locale) : "";
    // Single-phase services (e.g. Asilo) drop the "Fase X de Y ·" prefix — it's
    // noise when there's only one phase; just the phase name reads cleanly.
    const phaseLabel = ws?.phase
      ? ws.phaseCount > 1
        ? phaseTpl
            .replace("{x}", String(ws.phaseIndex))
            .replace("{y}", String(ws.phaseCount))
            .replace("{phase}", phaseName)
        : phaseName
      : null;
    // First entry to a case (an active terms version exists and isn't yet
    // accepted) must land on the disclaimer; afterwards — or when no terms are
    // published — go straight to the case path. Resolving the destination here
    // keeps the redirect off the hot path (caso/[caseId]/page.tsx is the
    // deep-link safety net), which is what avoids the soft-nav blank screen.
    const termsAccepted = !e.terms?.terms || e.terms.alreadyAccepted;
    cases.push({
      caseId: e.row.id,
      href: termsAccepted ? `/caso/${e.row.id}/camino` : `/caso/${e.row.id}/disclaimer`,
      title,
      phaseLabel,
      serviceIcon,
      serviceColor,
      progress: ws?.phaseProgress ?? 0,
      pendingDocuments: ws?.pendingDocuments ?? 0,
      statusText: tStatus(status),
    });
  }

  return (
    <DashboardScreen
      displayName={displayName || t("fallbackName")}
      avatarInitial={avatarInitial}
      cases={cases}
      onboardingCases={onboardingCases}
      unreadCount={unreadCount}
      userId={actor.userId}
      locale={locale}
      refetchUnread={getUnreadCountAction}
      labels={{
        greetingEyebrow: t("greetingEyebrow"),
        greeting: t.raw("greeting") as string, // "Hola, {name}" — interpolated in DashboardScreen
        yourCases: t("yourCases"),
        documentsLeft: t.raw("documentsLeft") as string, // "Te faltan {n} documentos" — {n} per card
        openCase: t("openCase"),
        paymentPending: t("paymentPending"),
        payNow: t("payNow"),
        // Onboarding step card (sign → pay)
        activateTitle: t("activateTitle"),
        stepSign: t("stepSign"),
        stepPay: t("stepPay"),
        signCta: t("signCta"),
        stepDoneLabel: t("stepDoneLabel"),
        stepLaterLabel: t("stepLaterLabel"),
        preparingLabel: t("preparingLabel"),
        lockedLabel: t("lockedLabel"),
        quickAccess: t("quickAccess"),
        qServices: tNav("servicios"),
        qServicesSub: t("qServicesSub"),
        qPayments: tNav("pagos"),
        qPaymentsSub: t("qPaymentsSub"),
        qCommunity: tNav("comunidad"),
        qCommunitySub: t("qCommunitySub"),
        qSettings: t("qSettings"),
        qSettingsSub: t("qSettingsSub"),
        bellAria: t("bellAria"),
        avatarAria: t("avatarAria"),
      }}
    />
  );
}
