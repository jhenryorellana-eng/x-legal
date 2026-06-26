"use server";

/**
 * Ventas (Vanessa) server actions (DOC-52, DOC-48 API-KAN/LEAD/SCH).
 *
 * Thin "use server" wrappers over the kanban / scheduling module-pub use cases,
 * normalized to a small result envelope for the client views. Each action builds
 * the Actor (requireActor) and delegates; the services authorize with can(...).
 * Boundary R1/R2: app → module-pub only (never repository/platform).
 *
 * API map:
 *   moveKanbanCardAction        → API-KAN-02
 *   createLeadAction            → API-LEAD-02
 *   createLeadCategoryAction    → API-LEAD-07
 *   updateLeadContactAction     → API-LEAD-03 (registers contacted_at)
 *   toggleTaskDoneAction        → API-KAN-09
 *   bookAppointmentAction       → API-SCH-02
 *   createProspectApptAction    → API-SCH-07
 *   completeAppointmentAction   → API-SCH-05
 *   cancelAppointmentAction     → API-SCH-03
 *   markNoShowAction            → API-SCH-06
 *   saveAvailabilityRulesAction → API-SCH-08
 *   addExceptionAction          → API-SCH-09
 *   removeExceptionAction       → API-SCH-10
 *   updateSchedulingSettingsAction → API-SCH-11
 *   liftRebookingBlockAction    → API-SCH (lift)
 *   setLocaleAction             → users.locale + cookie (DOC-23 §2.5)
 */

import { cookies } from "next/headers";
import { requireActor, AuthzError } from "@/backend/modules/identity";
import {
  moveCard,
  createLead,
  createLeadCategory,
  updateLeadCategory,
  deleteLeadCategory,
  reorderLeadCategories,
  listLeadCategories,
  updateLead,
  listLeads,
  toggleTaskDone,
  KanbanError,
} from "@/backend/modules/kanban";
import {
  getAvailableSlots,
  getProspectSlots,
  getCaseRuta,
  bookAppointment,
  createProspectAppointment,
  completeAppointment,
  rescheduleAppointment,
  cancelAppointment,
  markNoShow,
  saveAvailabilityRules,
  addAvailabilityException,
  removeAvailabilityException,
  updateSchedulingSettings,
  liftRebookingBlock,
  SchedulingError,
} from "@/backend/modules/scheduling";
import { searchBookableCases } from "@/backend/modules/cases";
import type { I18nText } from "@/shared/i18n";

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: { code: string } };

function mapErr(err: unknown): Err {
  if (err instanceof AuthzError) return { ok: false, error: { code: err.reason } };
  if (err instanceof KanbanError || err instanceof SchedulingError) {
    return { ok: false, error: { code: err.code } };
  }
  // H-5: log only the message, never the raw Error object (may carry PII in stack/metadata)
  console.error("[ventas action] unexpected:", (err as Error)?.message ?? String(err));
  return { ok: false, error: { code: "internal" } };
}

async function currentLocale(): Promise<"es" | "en"> {
  const jar = await cookies();
  return jar.get("ulp-locale")?.value === "en" ? "en" : "es";
}

function pickI18n(text: I18nText | null | undefined, locale: "es" | "en"): string | null {
  if (!text) return null;
  return text[locale] ?? text.es ?? text.en ?? null;
}

// --------------------------------------------------------------------------
// Leads / kanban
// --------------------------------------------------------------------------

export async function moveKanbanCardAction(input: {
  cardId: string;
  toColumnId: string;
  toPosition: number;
  lostReason?: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await moveCard(actor, {
      cardId: input.cardId,
      toColumnId: input.toColumnId,
      toPosition: input.toPosition,
      lostReason: input.lostReason,
    });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function createLeadAction(input: {
  phone: string;
  name: string | null;
  source: string;
  serviceId: string | null;
  categoryId: string | null;
  note: string | null;
  confirmDuplicate?: boolean;
}): Promise<
  | Ok<{ duplicate: { name: string; leadId: string } | null }>
  | (Err & { duplicate?: { name: string; leadId: string } | null })
> {
  try {
    const actor = await requireActor();
    const res = await createLead(actor, {
      phone: input.phone,
      fullName: input.name ?? undefined,
      source: input.source,
      interestedServiceId: input.serviceId ?? undefined,
      categoryId: input.categoryId ?? undefined,
      note: input.note ?? undefined,
      confirmDuplicate: input.confirmDuplicate,
    });
    if (res.type === "warning") {
      const match = res.exactMatches[0] ?? res.weakMatches[0];
      return {
        ok: false,
        error: { code: "LEAD_DUPLICATE_WARNING" },
        duplicate: match ? { name: match.fullName ?? match.phoneE164, leadId: match.id } : null,
      };
    }
    return { ok: true, duplicate: null };
  } catch (err) {
    return mapErr(err);
  }
}

export async function createLeadCategoryAction(input: {
  label: string;
  color: string;
}): Promise<{ ok: boolean; id?: string; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const cat = await createLeadCategory(actor, { label: input.label, color: input.color });
    return { ok: true, id: cat.id };
  } catch (err) {
    return mapErr(err);
  }
}

export interface LeadCategoryItem {
  id: string;
  label: string;
  color: string;
  position: number;
  isActive: boolean;
}

export async function listLeadCategoriesAction(): Promise<{
  ok: boolean;
  categories?: LeadCategoryItem[];
  error?: { code: string };
}> {
  try {
    const actor = await requireActor();
    const cats = await listLeadCategories(actor, { includeInactive: true });
    return {
      ok: true,
      categories: cats.map((c) => ({
        id: c.id,
        label: c.label,
        color: c.color,
        position: c.position,
        isActive: c.is_active,
      })),
    };
  } catch (err) {
    return mapErr(err);
  }
}

export async function updateLeadCategoryAction(input: {
  categoryId: string;
  label?: string;
  color?: string;
  isActive?: boolean;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await updateLeadCategory(actor, input);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function deleteLeadCategoryAction(input: {
  categoryId: string;
}): Promise<{ ok: boolean; softDeleted?: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const res = await deleteLeadCategory(actor, input.categoryId);
    return { ok: true, softDeleted: res.softDeleted };
  } catch (err) {
    return mapErr(err);
  }
}

export async function reorderLeadCategoriesAction(input: {
  orderedIds: string[];
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await reorderLeadCategories(actor, input.orderedIds);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function contactLeadAction(input: {
  leadId: string;
  channel: "call" | "whatsapp";
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    // Registers first contact (service no-ops if contacted_at already set).
    await updateLead(actor, { leadId: input.leadId });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function toggleTaskDoneAction(input: {
  taskId: string;
  done: boolean;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await toggleTaskDone(actor, input.taskId);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

// --------------------------------------------------------------------------
// Scheduling — Nueva cita modal (search + on-demand context)
// --------------------------------------------------------------------------

export interface ClientCaseResult {
  caseId: string;
  name: string;
  phone: string | null;
  serviceLabel: string;
  clientTz: string | null;
}

export async function searchCasesAction(
  query: string,
): Promise<{ ok: boolean; results?: ClientCaseResult[]; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const locale = await currentLocale();
    const results = await searchBookableCases(actor, query, locale);
    return { ok: true, results };
  } catch (err) {
    return mapErr(err);
  }
}

export interface CaseBookingContext {
  slots: string[];
  /** Office/global reference TZ — secondary chip only. */
  staffTimezone: string;
  /** Requesting staff's own profile TZ — PRIMARY display zone. */
  viewerTimezone: string;
  durationMinutes: number;
  kind: "video" | "phone" | "presencial";
  sequenceNumber: number;
  seqLabel: string;
  ruta: { number: number; label: string | null; kind: string; status: string }[];
}

/**
 * On selecting a case: returns its available slots (window now..+max) plus the
 * derived duration/modality/sequence and the display route. Everything the modal
 * shows as read-only is computed here from the route — single source of truth.
 */
export async function getCaseBookingContextAction(
  caseId: string,
): Promise<{ ok: boolean; context?: CaseBookingContext; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const locale = await currentLocale();
    const from = new Date();
    const to = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const [slotsRes, ruta] = await Promise.all([
      getAvailableSlots(actor, { caseId, windowFromUtc: from, windowToUtc: to }),
      getCaseRuta(actor, caseId),
    ]);
    const current = ruta.citas.find((c) => c.sequenceNumber === slotsRes.sequenceNumber)
      ?? ruta.citas.find((c) => c.status === "current");
    const displayNumber = current?.number ?? slotsRes.sequenceNumber;
    return {
      ok: true,
      context: {
        slots: slotsRes.slots.map((s) => s.startUtc.toISOString()),
        staffTimezone: slotsRes.staffTimezone,
        viewerTimezone: slotsRes.viewerTimezone,
        durationMinutes: slotsRes.durationMinutes,
        kind: slotsRes.kind,
        sequenceNumber: slotsRes.sequenceNumber,
        seqLabel: `${displayNumber}/${ruta.total}`,
        ruta: ruta.citas.map((c) => ({
          number: c.number,
          label: pickI18n(c.labelI18n, locale),
          kind: c.kind,
          status: c.status,
        })),
      },
    };
  } catch (err) {
    return mapErr(err);
  }
}

export interface ProspectResult {
  leadId: string;
  name: string | null;
  phone: string;
  source: string;
}

export async function searchProspectsAction(
  query: string,
): Promise<{ ok: boolean; results?: ProspectResult[]; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const { items } = await listLeads(actor, { limit: 200 });
    const q = query.trim().toLowerCase();
    const results = items
      .filter((l) => l.status !== "won")
      .map((l) => ({ leadId: l.id, name: l.full_name, phone: l.phone_e164, source: l.source }))
      .filter((l) => !q || (l.name ?? "").toLowerCase().includes(q) || l.phone.includes(q))
      .slice(0, 20);
    return { ok: true, results };
  } catch (err) {
    return mapErr(err);
  }
}

export interface ProspectSlotsContext {
  slots: string[];
  /** Office/global reference TZ — secondary chip only. */
  staffTimezone: string;
  /** Requesting staff's own profile TZ — PRIMARY display zone. */
  viewerTimezone: string;
  durationMinutes: number;
  kind: "video" | "phone" | "presencial";
}

export async function getProspectSlotsAction(): Promise<{
  ok: boolean;
  context?: ProspectSlotsContext;
  error?: { code: string };
}> {
  try {
    const actor = await requireActor();
    const from = new Date();
    const to = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const res = await getProspectSlots(actor, { windowFromUtc: from, windowToUtc: to });
    return {
      ok: true,
      context: {
        slots: res.slots.map((s) => s.startUtc.toISOString()),
        staffTimezone: res.staffTimezone,
        viewerTimezone: res.viewerTimezone,
        durationMinutes: res.durationMinutes,
        kind: res.kind,
      },
    };
  } catch (err) {
    return mapErr(err);
  }
}

export async function createProspectInlineAction(input: {
  phone: string;
  name: string | null;
}): Promise<{ ok: boolean; leadId?: string; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const res = await createLead(actor, {
      phone: input.phone,
      fullName: input.name ?? undefined,
      source: "manual",
      confirmDuplicate: true, // staff is explicitly creating a prospect to book now
    });
    if (res.type === "lead") return { ok: true, leadId: res.lead.id };
    return { ok: false, error: { code: "LEAD_DUPLICATE_WARNING" } };
  } catch (err) {
    return mapErr(err);
  }
}

export async function bookAppointmentAction(input: {
  caseId: string;
  startsAtIso: string;
  note: string;
  force: boolean;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    // Duration/kind are intentionally omitted: bookAppointment derives them from
    // the case route (case_overrides > phase policy > cronograma). Reminders are
    // always on (1 day + 1 hour) per product decision.
    const res = await bookAppointment(actor, {
      caseId: input.caseId,
      startsAtUtc: new Date(input.startsAtIso),
      reminder1d: true,
      reminder1h: true,
      notes: input.note || null,
      force: input.force,
    });
    if (!input.force && res.warnings && res.warnings.length > 0) {
      const w = res.warnings[0];
      return { ok: false, error: { code: w.code ?? "OUTSIDE_AVAILABILITY" } };
    }
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function createProspectApptAction(input: {
  leadId: string;
  startsAtIso: string;
  durationMinutes: number;
  note: string;
  force?: boolean;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const res = await createProspectAppointment(actor, {
      leadId: input.leadId,
      startsAtUtc: new Date(input.startsAtIso),
      durationMinutes: input.durationMinutes,
      kind: "video", // org default modality for prospect/eval citas
      reminder1d: true,
      reminder1h: true,
      notes: input.note || null,
      force: input.force ?? false,
    });
    if (!input.force && res.warnings && res.warnings.length > 0) {
      const w = res.warnings[0];
      return { ok: false, error: { code: w.code ?? "OUTSIDE_AVAILABILITY" } };
    }
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function completeAppointmentAction(input: {
  appointmentId: string;
  objectivesOutcome?: { id: string; text: string; achieved: boolean }[];
  notes?: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await completeAppointment(actor, {
      appointmentId: input.appointmentId,
      objectivesOutcome: input.objectivesOutcome,
      notes: input.notes || undefined,
    });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function rescheduleAppointmentAction(input: {
  appointmentId: string;
  startsAtIso: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await rescheduleAppointment(actor, {
      appointmentId: input.appointmentId,
      newStartsAtUtc: new Date(input.startsAtIso),
    });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function cancelAppointmentAction(input: {
  appointmentId: string;
  reason: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await cancelAppointment(actor, { appointmentId: input.appointmentId, reason: input.reason });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function markNoShowAction(input: {
  appointmentId: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await markNoShow(actor, { appointmentId: input.appointmentId });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function saveAvailabilityRulesAction(input: {
  rules: { weekday: number; startLocal: string; endLocal: string }[];
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await saveAvailabilityRules(actor, { rules: input.rules });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function addExceptionAction(input: {
  label: string;
  fromIso: string;
  toIso: string;
  acknowledgeAffected?: boolean;
}): Promise<{ ok: boolean; affected?: number; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await addAvailabilityException(actor, {
      staffId: actor.userId,
      startsAt: new Date(input.fromIso),
      endsAt: new Date(input.toIso),
      reason: input.label,
      acknowledgeAffected: input.acknowledgeAffected,
    });
    return { ok: true };
  } catch (err) {
    // Surface how many scheduled appointments the block would hit so the editor
    // can ask for explicit confirmation (DOC-52 §4 — "afecta N citas").
    if (
      err instanceof SchedulingError &&
      err.code === "EXCEPTION_AFFECTS_APPOINTMENTS"
    ) {
      const affected = (err.meta?.affected as string[] | undefined)?.length ?? 0;
      return { ok: false, affected, error: { code: err.code } };
    }
    return mapErr(err);
  }
}

export async function removeExceptionAction(input: {
  exceptionId: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await removeAvailabilityException(actor, input.exceptionId);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function updateSchedulingSettingsAction(input: {
  defaultDurationMinutes: number;
  minNoticeHours: number;
  remindersEnabled: boolean;
  videoLink?: string | null;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await updateSchedulingSettings(actor, {
      minNoticeHours: input.minNoticeHours,
      defaultDurationMinutes: input.defaultDurationMinutes,
      remindersEnabled: input.remindersEnabled,
      videoLink: input.videoLink,
    });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function liftRebookingBlockAction(input: {
  clientId: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await liftRebookingBlock(actor, input.clientId);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

// --------------------------------------------------------------------------
// Config — locale (DOC-23 §2.5)
// --------------------------------------------------------------------------

export async function setLocaleAction(locale: "es" | "en"): Promise<{ ok: boolean }> {
  // Mirror cookie for SSR (users.locale persistence handled by identity on a
  // dedicated profile action; here we set the operational cookie — the view
  // reloads to apply). Kept thin to avoid importing platform from app.
  const jar = await cookies();
  jar.set("ulp-locale", locale, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  return { ok: true };
}
