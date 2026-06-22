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
  updateLead,
  toggleTaskDone,
  KanbanError,
} from "@/backend/modules/kanban";
import {
  bookAppointment,
  createProspectAppointment,
  completeAppointment,
  cancelAppointment,
  markNoShow,
  saveAvailabilityRules,
  addAvailabilityException,
  removeAvailabilityException,
  updateSchedulingSettings,
  liftRebookingBlock,
  SchedulingError,
} from "@/backend/modules/scheduling";

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
// Scheduling
// --------------------------------------------------------------------------

export async function bookAppointmentAction(input: {
  caseId: string;
  apptType: "c1" | "c2" | "c3" | "call";
  startsAtIso: string;
  durationMinutes: number;
  modality: "video" | "phone";
  reminder1d: boolean;
  reminder1h: boolean;
  note: string;
  force: boolean;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const res = await bookAppointment(actor, {
      caseId: input.caseId,
      startsAtUtc: new Date(input.startsAtIso),
      durationMinutes: input.durationMinutes,
      kind: input.modality,
      reminder1d: input.reminder1d,
      reminder1h: input.reminder1h,
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
  modality: "video" | "phone";
  note: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await createProspectAppointment(actor, {
      leadId: input.leadId,
      startsAtUtc: new Date(input.startsAtIso),
      durationMinutes: input.durationMinutes,
      kind: input.modality,
      notes: input.note || null,
    });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function completeAppointmentAction(input: {
  appointmentId: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await completeAppointment(actor, { appointmentId: input.appointmentId });
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
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await updateSchedulingSettings(actor, {
      minNoticeHours: input.minNoticeHours,
      defaultDurationMinutes: input.defaultDurationMinutes,
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
