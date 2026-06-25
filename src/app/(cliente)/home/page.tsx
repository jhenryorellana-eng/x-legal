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
} from "@/backend/modules/cases";
import { getCaseOnboardingContract } from "@/backend/modules/contracts";
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
  // /progress). RLS scopes the list to cases the client is a member of.
  const casesPage = await getCasesForClient(actor, { limit: 20 });
  const workspaces: CaseWorkspaceDto[] = [];
  for (const c of casesPage.items) {
    try {
      workspaces.push(await getCaseWorkspace(actor, c.id));
    } catch {
      // A case the client can list but not (yet) fully read — skip defensively.
    }
  }

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
  const reviewLabel = t("inReview");

  // Split the client's cases into onboarding (payment_pending — the client must
  // sign the contract AND pay the initial fee before the workspace unlocks) and
  // active cases. Onboarding cases get a dedicated step card (sign → pay); active
  // cases render as the highlighted/secondary cards exactly as before.
  const onboardingCases: OnboardingCase[] = [];
  const activeWorkspaces: CaseWorkspaceDto[] = [];
  for (const ws of workspaces) {
    if (ws.status !== "payment_pending") {
      activeWorkspaces.push(ws);
      continue;
    }
    const serviceName = pickLocale(ws.service?.labelI18n, locale);
    const party = ws.parties[0]?.name;
    const title = party ? `${serviceName} — ${party}` : serviceName;

    // Read the contract (membership-gated via requireCaseAccess) to know which
    // onboarding step the client is on. `sent` → still to sign; `signed` → signed,
    // waiting on the down payment; anything else (draft/cancelled/null) → preparing.
    let step: OnboardingCase["step"] = "preparing";
    let signHref: string | null = null;
    try {
      const contract = await getCaseOnboardingContract(actor, ws.caseId);
      if (contract?.status === "signed") {
        step = "pay";
      } else if (contract?.status === "sent" && contract.signingToken) {
        step = "sign";
        signHref = `/firma/${contract.signingToken}`;
      }
    } catch {
      // Contract unreadable (rare) — leave as "preparing" (no actionable CTA).
    }

    onboardingCases.push({
      caseId: ws.caseId,
      title,
      serviceIcon: coerceIcon(ws.service?.icon, "shield"),
      serviceColor: ws.service?.color || "var(--accent)",
      step,
      signHref,
    });
  }

  const cases: DashboardCase[] = activeWorkspaces.map((ws, idx) => {
    const serviceName = pickLocale(ws.service?.labelI18n, locale);
    const party = ws.parties[0]?.name;
    const title = party ? `${serviceName} — ${party}` : serviceName;
    const phaseName = pickLocale(ws.phase?.labelI18n, locale);
    const phaseLabel = ws.phase
      ? phaseTpl
          .replace("{x}", String(ws.phaseIndex))
          .replace("{y}", String(ws.phaseCount))
          .replace("{phase}", phaseName)
      : null;
    const isInReview = ws.status === "in_validation";
    return {
      caseId: ws.caseId,
      href: `/caso/${ws.caseId}/camino`,
      title,
      phaseLabel,
      serviceIcon: coerceIcon(ws.service?.icon, "shield"),
      serviceColor: ws.service?.color || "var(--accent)",
      progress: ws.phaseProgress,
      pendingDocuments: ws.pendingDocuments,
      // The first/most-recent active case is the highlighted hero card.
      highlighted: idx === 0,
      statusText: isInReview ? reviewLabel : undefined,
      statusKind: isInReview ? ("revision" as const) : undefined,
    };
  });

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
