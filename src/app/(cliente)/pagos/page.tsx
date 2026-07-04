/**
 * Pagos — `/pagos` · nivel CUENTA (pestaña "Pagos") — DOC-51 §8, PROMPT-CLI-08.
 *
 * Server component. Reads the account statement via the billing module
 * (getAccountStatement → AccountStatementDto), maps to PagosView VM, and passes
 * thin server actions (Stripe checkout + Zelle upload) as props.
 *
 * Auth: client only — any other kind → redirect to /welcome.
 *
 * Server actions live here (app layer) and call billing use-cases via the module
 * index + requireActor from @/backend/modules/identity (app → platform is barred
 * by eslint-boundaries; app → module is allowed). Same pattern as F5 validaciones.
 *
 * Remaining gap (Ola-1):
 *   - TODO BIL-RSC-2: the Zelle destination should come from
 *     orgs.settings.zelle_destination; OrgSettings doesn't carry it yet, so it
 *     reads from NEXT_PUBLIC_ZELLE_DESTINATION as a temporary bridge (null → UI
 *     shows the method without a destination line). Admin config lands later.
 *   - TODO BIL-RSC-4: multi-case clients use the FIRST active case (same as /home).
 */

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getLocale, getTranslations, getTimeZone } from "next-intl/server";
import { getActor, requireActor } from "@/backend/modules/identity";
import { getCasesForClient } from "@/backend/modules/cases";
import {
  getAccountStatement,
  createCheckoutSessionForInstallment,
  createSetupCheckoutSession,
  setAutopay,
  getSavedCard,
  getZelleProofUploadUrl,
  submitZelleProof,
  BillingError,
  type AccountStatementDto,
} from "@/backend/modules/billing";
import type { Locale } from "@/frontend/features/cliente/shared/i18n";
import {
  PagosView,
  type InstallmentVM,
  type PagosViewProps,
} from "@/frontend/features/cliente/pagos/pagos-view";

type DtoInstallment = AccountStatementDto["installments"][number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive the display date label for an installment's due_date in user TZ. */
function makeDateLabel(isoDate: string, locale: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      day: "numeric",
      month: "short",
    }).format(new Date(isoDate + "T12:00:00Z"));
  } catch {
    return isoDate;
  }
}

/** Produce a formatted long date "5 de junio" / "June 5" for the summary card. */
function makeLongDateLabel(isoDate: string, locale: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      day: "numeric",
      month: "long",
    }).format(new Date(isoDate + "T12:00:00Z"));
  } catch {
    return isoDate;
  }
}

function formatCentsDisplay(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Map DB installment status + position relative to nextDueId → display status. */
function resolveDisplayStatus(
  row: DtoInstallment,
  nextDueId: string | null,
): InstallmentVM["displayStatus"] {
  switch (row.status) {
    case "paid":
      return "paid";
    case "processing": {
      // Distinguish an automatic card payment in flight ("Procesando pago") from a
      // Zelle proof awaiting manual staff review ("En verificación"). Card payments
      // settle in seconds via the reconcile layers, so this is mostly transient;
      // Zelle stays here until finance confirms. Use the latest pending payment.
      const latestPending = [...row.payments]
        .filter((p) => p.status === "pending")
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
      return latestPending?.method === "stripe" ? "processingCard" : "processing";
    }
    case "waived":
      return "waived";
    case "overdue":
      return "overdue";
    case "pending":
      // The installment that is the "nextDue" shows as "due"; others as "scheduled"
      return row.id === nextDueId ? "due" : "scheduled";
    default:
      return "scheduled";
  }
}

// ---------------------------------------------------------------------------
// Server actions (app layer → billing use-cases via index)
// ---------------------------------------------------------------------------

/** API-BIL-01 — Stripe Checkout session for an installment (+ autopay opt-in). */
async function createInstallmentCheckoutAction(
  installmentId: string,
  enrollAutopay: boolean = false,
): Promise<{ ok: true; data: { url: string } } | { ok: false; error: string }> {
  "use server";
  try {
    const actor = await requireActor();
    const { url } = await createCheckoutSessionForInstallment(actor, installmentId, {
      enrollAutopay,
    });
    return { ok: true, data: { url } };
  } catch (err) {
    return { ok: false, error: err instanceof BillingError ? err.code : "CHECKOUT_FAILED" };
  }
}

/** DOC-71 §2.4 — Checkout mode=setup: save/replace the card without charging. */
async function createSetupCheckoutAction(
  caseId: string,
): Promise<{ ok: true; data: { url: string } } | { ok: false; error: string }> {
  "use server";
  try {
    const actor = await requireActor();
    const { url } = await createSetupCheckoutSession(actor, caseId);
    return { ok: true, data: { url } };
  } catch (err) {
    return { ok: false, error: err instanceof BillingError ? err.code : "SETUP_FAILED" };
  }
}

/** DOC-71 §2.4 — toggle autopay consent on the client's own plan. */
async function setAutopayClientAction(
  planId: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  "use server";
  try {
    const actor = await requireActor();
    await setAutopay(actor, { planId, enabled });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof BillingError ? err.code : "AUTOPAY_FAILED" };
  }
}

/** API-BIL-04 — signed upload URL for a Zelle proof (bucket payment-proofs). */
async function getZelleUploadUrlAction(
  installmentId: string,
  filename: string,
  contentType: string,
): Promise<
  | { ok: true; data: { uploadUrl: string; path: string } }
  | { ok: false; error: string }
> {
  "use server";
  try {
    const actor = await requireActor();
    const { signedUrl, path } = await getZelleProofUploadUrl(actor, {
      installmentId,
      filename,
      contentType,
    });
    return { ok: true, data: { uploadUrl: signedUrl, path } };
  } catch (err) {
    return { ok: false, error: err instanceof BillingError ? err.code : "UPLOAD_URL_FAILED" };
  }
}

/** API-BIL-05 — confirm the uploaded Zelle proof → installment processing. */
async function confirmZelleProofAction(
  installmentId: string,
  path: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  "use server";
  try {
    const actor = await requireActor();
    await submitZelleProof(actor, { installmentId, proofPath: path });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof BillingError ? err.code : "CONFIRM_FAILED" };
  }
}

// ---------------------------------------------------------------------------
// Page (RSC)
// ---------------------------------------------------------------------------

export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<{ caseId?: string }>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const tz = await getTimeZone();
  const t = await getTranslations("cliente.pagos");

  // List the client's cases for the selector (was: first case only — BIL-RSC-4).
  // RLS scopes the list to the client's own cases.
  let cases: { id: string; label: string }[] = [];
  try {
    const casesPage = await getCasesForClient(actor, { limit: 50 });
    cases = casesPage.items.map((c) => ({
      id: c.id,
      label: c.case_number ?? c.id.slice(0, 8),
    }));
  } catch {
    cases = [];
  }

  // Resolve the selected case from ?caseId= (validated against membership),
  // defaulting to the first case.
  const requested = (await searchParams)?.caseId ?? null;
  const caseId: string | null =
    (requested && cases.some((c) => c.id === requested) ? requested : cases[0]?.id) ?? null;

  // Account statement (plan + installments + aggregates + nextDue)
  let statement: AccountStatementDto | null = null;
  if (caseId) {
    try {
      statement = await getAccountStatement(actor, caseId);
    } catch (err) {
      // Known billing errors → empty state; unknown errors also degrade (no 500).
      void err;
      statement = null;
    }
  }

  // TODO BIL-RSC-2: Read from orgs.settings.zelle_destination once schema is extended.
  const zelleDestination = process.env.NEXT_PUBLIC_ZELLE_DESTINATION ?? null;

  // Autopay VM (DOC-71 §2.4): plan consent state + the client's saved card.
  let savedCard: { brand: string | null; last4: string | null } | null = null;
  try {
    const card = await getSavedCard(actor);
    savedCard = card ? { brand: card.brand, last4: card.last4 } : null;
  } catch {
    savedCard = null;
  }
  const autopay = statement?.plan
    ? {
        planId: statement.plan.id,
        enabled: statement.plan.autopayEnabled,
        disabledReason: statement.plan.autopayDisabledReason,
      }
    : null;

  // Map to view-model
  let installments: InstallmentVM[] | null = null;
  let nextDueId: string | null = null;
  let nextDueAmount: string | null = null;
  let nextDueDateLabel: string | null = null;
  let paidCount = 0;
  let totalCount = 0;
  let progressPct = 0;

  if (statement && statement.installments.length > 0) {
    const rows = [...statement.installments].sort((a, b) => a.number - b.number);

    nextDueId = statement.nextDue?.id ?? null;
    if (statement.nextDue) {
      nextDueAmount = formatCentsDisplay(statement.nextDue.amountCents);
      nextDueDateLabel = makeLongDateLabel(statement.nextDue.dueDate, locale, tz);
    }

    paidCount = rows.filter((r) => r.status === "paid").length;
    totalCount = rows.length;
    progressPct = totalCount > 0 ? Math.round((paidCount / totalCount) * 100) : 0;

    installments = rows.map((row): InstallmentVM => ({
      id: row.id,
      number: row.number,
      isDownpayment: row.isDownpayment,
      amountCents: row.amountCents,
      dateLabel: makeDateLabel(row.dueDate, locale, tz),
      displayStatus: resolveDisplayStatus(row, nextDueId),
    }));
  }

  const labels: PagosViewProps["labels"] = {
    title: t("title"),
    nextLabel: t("nextLabel"),
    // Raw templates: the client view interpolates the placeholders via String.replace.
    dueDate: t.raw("dueDate"),
    progressLabel: t.raw("progressLabel"),
    payNow: t("payNow"),
    allPaid: t("allPaid"),
    planTitle: t("planTitle"),
    installmentRow: t.raw("installmentRow"),
    statusPaid: t("statusPaid"),
    statusDue: t("statusDue"),
    statusScheduled: t("statusScheduled"),
    statusProcessing: t("statusProcessing"),
    statusProcessingCard: t("statusProcessingCard"),
    statusWaived: t("statusWaived"),
    statusOverdue: t("statusOverdue"),
    howToPayTitle: t("howToPayTitle"),
    zelleLabel: t("zelleLabel"),
    zelleRecommended: t("zelleRecommended"),
    zelleDestinationLabel: t("zelleDestinationLabel"),
    zelleUploadBtn: t("zelleUploadBtn"),
    zelleNote: t("zelleNote"),
    cardLabel: t("cardLabel"),
    cardSub: t("cardSub"),
    cardPayBtn: t("cardPayBtn"),
    footerSafe: t("footerSafe"),
    emptyTitle: t("emptyTitle"),
    emptyBody: t("emptyBody"),
    uploadSuccess: t("uploadSuccess"),
    uploadError: t("uploadError"),
    zelleSuccessTitle: t("zelleSuccessTitle"),
    zelleSuccessBody: t("zelleSuccessBody"),
    zelleSuccessBtn: t("zelleSuccessBtn"),
    stripeRedirecting: t("stripeRedirecting"),
    stripeError: t("stripeError"),
    offlineBanner: t("offlineBanner"),
    downpaymentLabel: t("downpaymentLabel"),
    zelleDestinationTodo: t("zelleDestinationTodo"),
    caseSelectorLabel: t("caseSelectorLabel"),
    autopayConsent: t("autopayConsent"),
    autopayActiveTitle: t("autopayActiveTitle"),
    autopayActiveSub: t("autopayActiveSub"),
    autopayCardLabel: t.raw("autopayCardLabel"),
    autopayChangeCard: t("autopayChangeCard"),
    autopayDisableBtn: t("autopayDisableBtn"),
    autopayReactivateBtn: t("autopayReactivateBtn"),
    autopayDisabledNotice: t("autopayDisabledNotice"),
    autopaySaveCardLink: t("autopaySaveCardLink"),
    autopayAutoChargeBadge: t("autopayAutoChargeBadge"),
    autopayError: t("autopayError"),
  };

  return (
    <PagosView
      installments={installments}
      nextDueId={nextDueId}
      nextDueAmount={nextDueAmount}
      nextDueDateLabel={nextDueDateLabel}
      paidCount={paidCount}
      totalCount={totalCount}
      progressPct={progressPct}
      zelleDestination={zelleDestination}
      planFrequencyLabel={
        statement?.plan
          ? statement.plan.frequency === "weekly"
            ? t("planWeekly")
            : t("planMonthly")
          : null
      }
      labels={labels}
      cases={cases}
      selectedCaseId={caseId}
      autopay={autopay}
      savedCard={savedCard}
      onCreateCheckout={createInstallmentCheckoutAction}
      onCreateSetupCheckout={createSetupCheckoutAction}
      onSetAutopay={setAutopayClientAction}
      onGetZelleUploadUrl={getZelleUploadUrlAction}
      onConfirmZelleProof={confirmZelleProofAction}
    />
  );
}
