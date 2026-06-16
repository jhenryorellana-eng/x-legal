/**
 * Cola de impresión — `/finanzas/impresion` (Andrium).
 *
 * RSC page: guards the actor, loads the print queue + per-case history via the
 * expediente module-pub boundary, maps to serialisable VMs and passes them +
 * the server actions to the client view.
 *
 * RF-AND-023…027 / DOC-55 §2 / PROMPT-AND-02.
 */

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import {
  listPrintQueue,
  getCaseExpedientes,
  ExpedienteError,
  type PrintQueueItemDto,
  type ExpedienteRow,
} from "@/backend/modules/expediente";
import type { Locale } from "@/shared/i18n";
import {
  ImpresionView,
  type PrintQueueItemVM,
  type PrintHistoryAttemptVM,
  type ImpresionViewMessages,
} from "@/frontend/features/andrium/impresion/impresion-view";
import {
  markPrintedAction,
  markShippedAction,
  markFiledAction,
  getExpedientePdfUrlAction,
} from "./actions";

// ---------------------------------------------------------------------------
// Mapper: PrintQueueItemDto → PrintQueueItemVM
// ---------------------------------------------------------------------------

function toQueueVM(dto: PrintQueueItemDto, locale: Locale): PrintQueueItemVM {
  const serviceLabel =
    dto.serviceLabel
      ? (dto.serviceLabel[locale] ?? dto.serviceLabel.es ?? null)
      : null;
  return {
    expedienteId: dto.expedienteId,
    caseId: dto.caseId,
    caseNumber: dto.caseNumber,
    clientName: dto.clientName,
    serviceLabel,
    attemptNo: dto.attemptNo,
    pageCount: dto.pageCount,
    status:
      dto.status === "printed" ? "printed" : "sent_to_finance",
    sentToFinanceAt: dto.sentToFinanceAt,
    sentByName: dto.sentByName,
    withLawyer: dto.withLawyer,
    shippedAt: dto.shippedAt,
    filedAt: dto.filedAt,
    trackingRef: dto.trackingRef,
    hasPdf: dto.hasPdf,
  };
}

// ---------------------------------------------------------------------------
// Mapper: ExpedienteRow → PrintHistoryAttemptVM
//
// NOTE: ExpedienteRow stores staff IDs (built_by, printed_by) not names.
// Resolving IDs to display names requires a join not yet exposed by the
// module-pub boundary. Until a dedicated DTO is provided, we render IDs
// as truncated references (UI degrades gracefully).
// TODO API-EXP-20: expose PrintHistoryDto with resolved names.
// ---------------------------------------------------------------------------

function toHistoryVM(
  row: ExpedienteRow,
  currentAttemptNo: number,
): PrintHistoryAttemptVM {
  return {
    expedienteId: row.id,
    attemptNo: row.attempt_no,
    status: row.status,
    sentToFinanceAt: row.sent_to_finance_at ?? null,
    printedAt: row.printed_at ?? null,
    shippedAt: row.shipped_at ?? null,
    filedAt: row.filed_at ?? null,
    // IDs only — names require a join (TODO API-EXP-20)
    builtByName: row.built_by ? row.built_by.slice(0, 8) : null,
    printedByName: row.printed_by ? row.printed_by.slice(0, 8) : null,
    // with_lawyer / lawyer_verdict not in ExpedienteRow — use DTO enrichment when available
    withLawyer: false,
    lawyerVerdict: null,
    isCurrentAttempt: row.attempt_no === currentAttemptNo,
  };
}

// ---------------------------------------------------------------------------
// i18n strings builder
// ---------------------------------------------------------------------------

async function buildMessages(
  t: Awaited<ReturnType<typeof getTranslations<"staff.finanzas.impresion">>>,
): Promise<ImpresionViewMessages> {
  // Use t.raw for ALL keys: the client view interpolates placeholders ({n},
  // {fecha}, {nombre}) via String.replace, so messages must NOT be formatted
  // server-side (t() would throw FORMATTING_ERROR on placeholder templates).
  const rawFn = t.raw as unknown as (key: string) => string;
  const tRaw = (key: string) => rawFn(key);
  return {
    title: tRaw("title"),
    counterPending: tRaw("counterPending"),
    filterPending: tRaw("filterPending"),
    filterPrinted: tRaw("filterPrinted"),
    filterShipped: tRaw("filterShipped"),
    filterFiled: tRaw("filterFiled"),
    filterAll: tRaw("filterAll"),
    searchPlaceholder: tRaw("searchPlaceholder"),
    colCase: tRaw("colCase"),
    colService: tRaw("colService"),
    colAttempt: tRaw("colAttempt"),
    colPages: tRaw("colPages"),
    colSentBy: tRaw("colSentBy"),
    colStatus: tRaw("colStatus"),
    colActions: tRaw("colActions"),
    viewPdf: tRaw("viewPdf"),
    download: tRaw("download"),
    markPrinted: tRaw("markPrinted"),
    confirmPrinted: tRaw("confirmPrinted"),
    confirmPrintedBody: tRaw("confirmPrintedBody"),
    logShipment: tRaw("logShipment"),
    trackingLabel: tRaw("trackingLabel"),
    trackingPlaceholder: tRaw("trackingPlaceholder"),
    markFiled: tRaw("markFiled"),
    confirmFiled: tRaw("confirmFiled"),
    confirmFiledBody: tRaw("confirmFiledBody"),
    reprint: tRaw("reprint"),
    lawyerValidated: tRaw("lawyerValidated"),
    pdfUnavailable: tRaw("pdfUnavailable"),
    pdfUnavailableAsk: tRaw("pdfUnavailableAsk"),
    emptyTitle: tRaw("emptyTitle"),
    emptyBody: tRaw("emptyBody"),
    statusPending: tRaw("statusPending"),
    statusPrinted: tRaw("statusPrinted"),
    chipShipped: tRaw("chipShipped"),
    chipFiled: tRaw("chipFiled"),
    toastPrinted: tRaw("toastPrinted"),
    toastShipped: tRaw("toastShipped"),
    toastFiled: tRaw("toastFiled"),
    toastError: tRaw("toastError"),
    historyTitle: tRaw("historyTitle"),
    historyAttempt: tRaw("historyAttempt"),
    historyStatusLabel: tRaw("historyStatusLabel"),
    historySent: tRaw("historySent"),
    historyPrinted: tRaw("historyPrinted"),
    historyShipped: tRaw("historyShipped"),
    historyFiled: tRaw("historyFiled"),
    historyBuiltBy: tRaw("historyBuiltBy"),
    historyPrintedBy: tRaw("historyPrintedBy"),
    historyLawyerVerdict: tRaw("historyLawyerVerdict"),
    historyDownloadOnly: tRaw("historyDownloadOnly"),
    pdfModalTitle: tRaw("pdfModalTitle"),
    pdfModalPages: tRaw("pdfModalPages"),
    confirmCancel: tRaw("confirmCancel"),
    confirmAction: tRaw("confirmAction"),
    cancel: tRaw("cancel"),
    confirm: tRaw("confirm"),
    save: tRaw("save"),
    attemptChip: tRaw("attemptChip"),
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ImpresionPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.finanzas.impresion");
  const messages = await buildMessages(t);

  // Load print queue
  let queueDtos: PrintQueueItemDto[] = [];
  try {
    queueDtos = await listPrintQueue(actor);
  } catch (err) {
    if (!(err instanceof ExpedienteError)) throw err;
    // permission denied → render empty queue
  }

  const items = queueDtos.map((dto) => toQueueVM(dto, locale));

  // Load per-case history for all unique cases in the queue (RF-AND-027).
  // We fan out the reads so history panel has data without a second round-trip.
  const uniqueCaseIds = [...new Set(queueDtos.map((d) => d.caseId))];
  const historyMap: Record<string, PrintHistoryAttemptVM[]> = {};

  await Promise.allSettled(
    uniqueCaseIds.map(async (caseId) => {
      try {
        const rows = await getCaseExpedientes(actor, caseId);
        const currentAttemptNo =
          queueDtos.find((d) => d.caseId === caseId)?.attemptNo ?? 0;
        // sort descending by attempt_no (latest first)
        const sorted = [...rows].sort((a, b) => b.attempt_no - a.attempt_no);
        historyMap[caseId] = sorted.map((r) => toHistoryVM(r, currentAttemptNo));
      } catch {
        // silently skip — history panel gracefully handles missing data
      }
    }),
  );

  return (
    <ImpresionView
      items={items}
      history={historyMap}
      messages={messages}
      actions={{
        markPrinted: markPrintedAction,
        markShipped: markShippedAction,
        markFiled: markFiledAction,
        getPdfUrl: getExpedientePdfUrlAction,
      }}
    />
  );
}
