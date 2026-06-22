/**
 * Scheduling module — service layer (use cases).
 *
 * Authorization: can() / requireCaseAccess() is ALWAYS the first line.
 * Mutations: writeAudit() on every staff mutation.
 * Events: appEvents.emit() for domain events.
 * Cross-module reads: via cases/index.ts and leads/index.ts ONLY.
 *
 * @module scheduling/service
 */

import { z } from "zod";
import { addMinutes, addDays } from "date-fns";
import { fromZonedTime } from "date-fns-tz";

import { can, requireCaseAccess, AuthzError } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { appEvents } from "@/backend/platform/events";
import { createServiceClient } from "@/backend/platform/supabase";
import { logger } from "@/backend/platform/logger";
import { writeAudit } from "@/backend/modules/audit";

import {
  canTransitionAppointment,
  isLateCancellation,
  canClientReschedule,
  hasStarted,
  effectivePolicy,
  nextSequenceNumber,
  effectiveAppointmentCount,
  scheduleEntryForSequence,
  computeRebookingBlockedUntil,
  isRebookingBlocked,
  validateRuleSet,
  materializeSlots,
  isSlotInSet,
  type AppointmentStatus,
  type AppointmentActorKind,
  type Slot,
} from "./domain";

import * as repo from "./repository";
import type { AppointmentRow, RuleInput } from "./repository";

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class SchedulingError extends Error {
  constructor(
    public readonly code:
      | "SLOT_TAKEN"
      | "REBOOKING_BLOCKED"
      | "NO_APPOINTMENTS_LEFT"
      | "OUTSIDE_WINDOW"
      | "OUTSIDE_AVAILABILITY"
      | "CASE_NOT_ACTIVE"
      | "NO_STAFF_ASSIGNED"
      | "APPT_NOT_FOUND"
      | "APPT_INVALID_TRANSITION"
      | "APPT_ALREADY_STARTED"
      | "APPT_NOT_STARTED"
      | "AVAILABILITY_INVALID_RANGE"
      | "AVAILABILITY_OVERLAP"
      | "EXCEPTION_AFFECTS_APPOINTMENTS"
      | "POLICY_INVALID",
    public readonly meta?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "SchedulingError";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function now(): Date {
  return new Date();
}

/** Reads users.timezone for any user ID. Falls back to America/New_York. */
async function getUserTimezone(userId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("users")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  return data?.timezone ?? "America/New_York";
}

/** Lazily loads the cases module to avoid circular dependencies. */
async function getCasesModule(): Promise<{
  getCaseCore: (caseId: string) => Promise<{
    id: string;
    status: string;
    currentPhaseId: string | null;
    assignedSalesId: string | null;
    primaryClientId: string;
    rebookingBlockedUntil: Date | null;
  } | null>;
  setRebookingBlock: (caseId: string, until: Date | null) => Promise<void>;
}> {
  // Dynamic import avoids circular: scheduling → cases → scheduling would fail
  // if scheduling consumed cases at module load. This is the established pattern
  // used across the codebase (cases.service.ts line 332, 380, etc).
  const mod = await import("@/backend/modules/cases");

  return {
    async getCaseCore(caseId: string) {
      // getCaseCore is NOT in cases/index.ts yet — SOT-6 proposes adding it.
      // Interim: use the service client to read the cases table directly.
      // This is an accepted interim pending the SOT-6 resolution (DOC-43 §9 SOT-6).
      const supabase = createServiceClient();
      const { data } = await supabase
        .from("cases")
        .select(
          "id, status, current_phase_id, assigned_sales_id, primary_client_id, rebooking_blocked_until",
        )
        .eq("id", caseId)
        .maybeSingle();

      if (!data) return null;
      return {
        id: data.id,
        status: data.status,
        currentPhaseId: data.current_phase_id,
        assignedSalesId: data.assigned_sales_id,
        primaryClientId: data.primary_client_id,
        rebookingBlockedUntil: data.rebooking_blocked_until
          ? new Date(data.rebooking_blocked_until)
          : null,
      };
    },

    async setRebookingBlock(caseId: string, until: Date | null) {
      // SOT-6: this should be delegated to cases/index.ts setRebookingBlock.
      // Interim: write directly (scheduling owns the cases.rebooking_blocked_until
      // column per DOC-43 §3.3 / §3.5 / §3.9, SOT-6 accepted in V2.0).
      // TODO(SoT): replace with cases.setRebookingBlock once exported from cases/index.ts
      const supabase = createServiceClient();
      const { error } = await supabase
        .from("cases")
        .update({
          rebooking_blocked_until: until ? until.toISOString() : null,
        })
        .eq("id", caseId);

      if (error) {
        logger.error(
          { err: error, caseId },
          "scheduling: setRebookingBlock failed",
        );
        throw error;
      }
    },
  };

  // Reference to avoid unused import warning (mod is used indirectly for
  // future SOT-6 delegation — the function above uses createServiceClient directly)
  void mod;
}

/** Merges old notes + new notes (appends with separator). */
function mergeNotes(
  existing: string | null,
  addition?: string | null,
): string | null {
  if (!addition) return existing;
  if (!existing) return addition;
  return `${existing}\n---\n${addition}`;
}

/** Duration in minutes of an existing appointment row. */
function durationMinutes(a: AppointmentRow): number {
  const start = new Date(a.starts_at).getTime();
  const end = new Date(a.ends_at).getTime();
  return Math.round((end - start) / 60_000);
}

/**
 * Emits a domain event and AWAITS its consumers. Awaiting is required inside a
 * Vercel serverless request: the function is frozen once the response is sent,
 * which would drop a fire-and-forget consumer's notification insert / QStash
 * enqueue (DOC-20 §5 — heavy work still goes to QStash inside the consumer).
 */
async function emit(event: { type: string; payload: unknown }): Promise<void> {
  await appEvents.emitAndWait({
    type: event.type,
    payload: event.payload,
    occurredAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Booking warnings (non-blocking, staff only) — DOC-43 §3.2
// ---------------------------------------------------------------------------

export interface BookingWarning {
  code:
    | "OUTSIDE_AVAILABILITY"
    | "OUTSIDE_WINDOW"
    | "SLOT_CONFLICT";
}

async function computeBookingWarnings(
  staffId: string,
  startsAt: Date,
  endsAt: Date,
  // settings is intentionally ignored — the function re-fetches via repo.getSettings
  // to avoid stale-closure issues when called across multiple paths
  _settings?: unknown,
): Promise<BookingWarning[]> {
  const warnings: BookingWarning[] = [];
  const nowTs = now();

  const fullSettings = await repo.getSettings(staffId);

  // Check min_notice
  if (startsAt.getTime() < nowTs.getTime() + fullSettings.minNoticeHours * 3_600_000) {
    warnings.push({ code: "OUTSIDE_WINDOW" });
  }

  // Check max_advance
  if (startsAt.getTime() > nowTs.getTime() + fullSettings.maxAdvanceDays * 86_400_000) {
    warnings.push({ code: "OUTSIDE_WINDOW" });
  }

  // Check availability rules (is the slot within any active rule?)
  const rules = await repo.getActiveRules(staffId);
  const exceptions = await repo.getExceptionsInRange(
    staffId,
    new Date(startsAt.getTime() - 86_400_000),
    new Date(endsAt.getTime() + 86_400_000),
  );
  const slots = materializeSlots({
    rules,
    settings: fullSettings,
    exceptions,
    booked: [],
    windowFromUtc: new Date(startsAt.getTime() - 60_000),
    windowToUtc: new Date(endsAt.getTime() + 60_000),
    durationMin: durationMinutes({ starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() } as AppointmentRow),
    nowUtc: new Date(startsAt.getTime() - 86_400_000 * 60), // far past to avoid min_notice clipping
  });
  const slotObj = { startUtc: startsAt, endUtc: endsAt };
  if (!isSlotInSet(slotObj, slots)) {
    warnings.push({ code: "OUTSIDE_AVAILABILITY" });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// getAvailableSlots — API-SCH-01
// ---------------------------------------------------------------------------

export interface GetSlotsInput {
  caseId: string;
  windowFromUtc: Date;
  windowToUtc: Date;
}

export interface GetSlotsResult {
  slots: Slot[];
  durationMinutes: number;
  kind: "video" | "phone" | "presencial";
  sequenceNumber: number;
  staffId: string;
  staffTimezone: string;
}

/**
 * Returns materialised appointment slots for a case's current phase.
 *
 * Client: requireCaseAccess. Staff: can('calendar','view').
 * Validates rebooking block and appointment quota before materialising.
 *
 * @api-id API-SCH-01
 */
export async function getAvailableSlots(
  actor: Actor,
  input: GetSlotsInput,
): Promise<GetSlotsResult> {
  await requireCaseAccess(actor, input.caseId);

  const cases = await getCasesModule();
  const c = await cases.getCaseCore(input.caseId);
  if (!c || c.status !== "active" || !c.currentPhaseId) {
    throw new SchedulingError("CASE_NOT_ACTIVE");
  }

  if (
    actor.kind === "client" &&
    isRebookingBlocked(now(), c.rebookingBlockedUntil)
  ) {
    throw new SchedulingError("REBOOKING_BLOCKED", {
      blockedUntil: c.rebookingBlockedUntil,
    });
  }

  const [phasePolicy, caseOverride, schedule] = await Promise.all([
    repo.getPhasePolicy(c.currentPhaseId),
    repo.getCaseOverride(input.caseId, c.currentPhaseId),
    repo.getAppointmentSchedule(c.currentPhaseId),
  ]);
  const policy = effectivePolicy(phasePolicy, caseOverride);

  const consumed = await repo.countPhaseAppointments(
    input.caseId,
    c.currentPhaseId,
    ["scheduled", "completed"],
  );
  // When a per-cita schedule exists it defines the count (one row per cita);
  // otherwise fall back to the uniform phase-policy count.
  const totalAppointments = effectiveAppointmentCount(policy, schedule);
  if (totalAppointments - consumed <= 0) {
    throw new SchedulingError("NO_APPOINTMENTS_LEFT", {
      count: totalAppointments,
    });
  }

  const staffId = c.assignedSalesId;
  if (!staffId) {
    throw new SchedulingError("NO_STAFF_ASSIGNED");
  }

  // Resolve the NEXT cita's duration/kind from the cronograma (schedule row for
  // its sequence number), falling back to the uniform phase policy.
  const seqNumbers = await repo.getPhaseSequenceNumbers(
    input.caseId,
    c.currentPhaseId,
  );
  const sequenceNumber = nextSequenceNumber(seqNumbers);
  const entry = scheduleEntryForSequence(schedule, sequenceNumber);
  const durationMin = entry?.durationMinutes ?? policy.durationMinutes;
  const kind = entry?.kind ?? policy.kind;

  const [rules, settings, exceptions, booked] = await Promise.all([
    repo.getActiveRules(staffId),
    repo.getSettings(staffId),
    repo.getExceptionsInRange(staffId, input.windowFromUtc, input.windowToUtc),
    repo.findBookedForMaterialization(staffId, input.windowFromUtc, input.windowToUtc),
  ]);

  const slots = materializeSlots({
    rules,
    settings,
    exceptions,
    booked,
    windowFromUtc: input.windowFromUtc,
    windowToUtc: input.windowToUtc,
    durationMin,
    nowUtc: now(),
  });

  const staffTimezone = await getUserTimezone(staffId);

  return {
    slots,
    durationMinutes: durationMin,
    kind,
    sequenceNumber,
    staffId,
    staffTimezone,
  };
}

// ---------------------------------------------------------------------------
// bookAppointment — API-SCH-02
// ---------------------------------------------------------------------------

const BookAppointmentInputSchema = z.object({
  caseId: z.string().uuid(),
  startsAtUtc: z.date(),
  durationMinutes: z.number().int().positive().optional(),
  kind: z.enum(["video", "phone", "presencial"]).optional(),
  reminder1d: z.boolean().default(true),
  reminder1h: z.boolean().default(false),
  notes: z.string().nullable().optional(),
  force: z.boolean().default(false),
});

export type BookAppointmentInput = z.input<typeof BookAppointmentInputSchema>;

export interface BookAppointmentResult {
  appointment?: AppointmentRow;
  warnings?: BookingWarning[];
}

/**
 * Books an appointment for a case.
 *
 * Client: requireCaseAccess, validates slot membership.
 * Staff: can('calendar','edit'), warnings non-blocking (force=true skips them).
 * EXCLUDE constraint (23P01) is the last defense — translated to SLOT_TAKEN.
 *
 * @api-id API-SCH-02
 */
export async function bookAppointment(
  actor: Actor,
  input: BookAppointmentInput,
): Promise<BookAppointmentResult> {
  if (actor.kind === "client") {
    await requireCaseAccess(actor, input.caseId);
  } else {
    can(actor, "calendar", "edit");
  }

  const p = BookAppointmentInputSchema.parse(input);

  const cases = await getCasesModule();
  const c = await cases.getCaseCore(p.caseId);
  if (!c || c.status !== "active" || !c.currentPhaseId) {
    throw new SchedulingError("CASE_NOT_ACTIVE");
  }

  const phaseId = c.currentPhaseId;
  const [phasePolicy, caseOverride, schedule] = await Promise.all([
    repo.getPhasePolicy(phaseId),
    repo.getCaseOverride(p.caseId, phaseId),
    repo.getAppointmentSchedule(phaseId),
  ]);
  const policy = effectivePolicy(phasePolicy, caseOverride);

  // Sequence number first, so the cita's own duration/kind (from the cronograma
  // schedule row) can be resolved. Staff-supplied values still win.
  const sequenceNumber = nextSequenceNumber(
    await repo.getPhaseSequenceNumbers(p.caseId, phaseId),
  );
  const entry = scheduleEntryForSequence(schedule, sequenceNumber);

  const startsAt = p.startsAtUtc;
  const duration = p.durationMinutes ?? entry?.durationMinutes ?? policy.durationMinutes;
  const apptKind = p.kind ?? entry?.kind ?? policy.kind;
  const endsAt = addMinutes(startsAt, duration);

  // Gate: quota
  const consumed = await repo.countPhaseAppointments(p.caseId, phaseId, [
    "scheduled",
    "completed",
  ]);
  if (effectiveAppointmentCount(policy, schedule) - consumed <= 0) {
    throw new SchedulingError("NO_APPOINTMENTS_LEFT");
  }

  // Gate: rebooking block (client only)
  if (
    actor.kind === "client" &&
    isRebookingBlocked(now(), c.rebookingBlockedUntil)
  ) {
    throw new SchedulingError("REBOOKING_BLOCKED", {
      blockedUntil: c.rebookingBlockedUntil,
    });
  }

  const staffId = c.assignedSalesId;
  if (!staffId) throw new SchedulingError("NO_STAFF_ASSIGNED");

  // Validate slot or compute warnings
  if (actor.kind === "client") {
    // Re-materialise around the requested slot to validate it's still available
    const margin = 2 * 86_400_000; // 2-day window
    const windowFrom = new Date(startsAt.getTime() - margin);
    const windowTo = new Date(endsAt.getTime() + margin);
    const [rules, settings, exceptions, booked] = await Promise.all([
      repo.getActiveRules(staffId),
      repo.getSettings(staffId),
      repo.getExceptionsInRange(staffId, windowFrom, windowTo),
      repo.findBookedForMaterialization(staffId, windowFrom, windowTo),
    ]);
    const slots = materializeSlots({
      rules,
      settings,
      exceptions,
      booked,
      windowFromUtc: windowFrom,
      windowToUtc: windowTo,
      durationMin: duration,
      nowUtc: now(),
    });
    if (!isSlotInSet({ startUtc: startsAt, endUtc: endsAt }, slots)) {
      throw new SchedulingError("SLOT_TAKEN");
    }
  } else {
    // Staff: compute non-blocking warnings
    const settings = await repo.getSettings(staffId);
    const warnings = await computeBookingWarnings(staffId, startsAt, endsAt, settings);
    if (warnings.length > 0 && !p.force) {
      return { warnings };
    }
  }

  // Insert the appointment — EXCLUDE protects against race conditions
  let appt: AppointmentRow;
  try {
    appt = await repo.insertAppointment({
      caseId: p.caseId,
      leadId: null,
      servicePhaseId: phaseId,
      staffId,
      clientUserId: c.primaryClientId,
      startsAt,
      endsAt,
      kind: apptKind,
      status: "scheduled",
      sequenceNumber,
      reminder1d: p.reminder1d,
      reminder1h: p.reminder1h,
      notes: p.notes ?? null,
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "SLOT_TAKEN_DB") throw new SchedulingError("SLOT_TAKEN");
    throw err;
  }

  // Set LiveKit room ID for video appointments
  const kind = p.kind ?? policy.kind;
  if (kind === "video") {
    await repo.updateAppointment(appt.id, {
      livekitRoomId: `appt:${appt.id}`,
    });
  }

  await emit({
    type: "appointment.booked",
    payload: {
      appointmentId: appt.id,
      caseId: appt.case_id,
      leadId: appt.lead_id,
      servicePhaseId: appt.service_phase_id,
      staffId: appt.staff_id,
      clientUserId: appt.client_user_id,
      startsAt: new Date(appt.starts_at),
      kind: appt.kind,
      sequenceNumber: appt.sequence_number,
      bookedBy: actor.kind === "client" ? "client" : "staff",
    },
  });

  if (actor.kind === "staff") {
    await writeAudit(
      actor,
      "scheduling.appointment.booked",
      "appointment",
      appt.id,
      { after: { caseId: appt.case_id, startsAt: appt.starts_at } },
    );
  }

  return { appointment: appt };
}

// ---------------------------------------------------------------------------
// cancelAppointment — API-SCH-03
// ---------------------------------------------------------------------------

/**
 * Cancels a scheduled appointment.
 *
 * Client: requireCaseAccess + has-not-started check.
 * Staff: can('calendar','edit'), no window restriction.
 * Late client cancellation → applies rebooking penalty.
 *
 * @api-id API-SCH-03
 */
export async function cancelAppointment(
  actor: Actor,
  input: { appointmentId: string; reason: string },
): Promise<void> {
  const a = await repo.findById(input.appointmentId);
  if (!a) throw new SchedulingError("APPT_NOT_FOUND");

  const actorKind: AppointmentActorKind =
    actor.kind === "client" ? "client" : "staff";

  if (actorKind === "client") {
    await requireCaseAccess(actor, a.case_id!);
    if (hasStarted(now(), new Date(a.starts_at))) {
      throw new SchedulingError("APPT_ALREADY_STARTED");
    }
  } else {
    can(actor, "calendar", "edit");
  }

  if (
    !canTransitionAppointment(a.status as AppointmentStatus, "cancelled", actorKind)
  ) {
    throw new SchedulingError("APPT_INVALID_TRANSITION", { from: a.status });
  }

  const settings = await repo.getSettings(a.staff_id);
  const late =
    actorKind === "client" &&
    isLateCancellation(now(), new Date(a.starts_at), settings.cancellationWindowHours);

  await repo.updateAppointment(a.id, {
    status: "cancelled",
    cancelledReason: input.reason,
  });

  // Apply penalty if late client cancellation
  if (late && a.case_id) {
    const cases = await getCasesModule();
    const c = await cases.getCaseCore(a.case_id);
    if (c) {
      const blockedUntil = computeRebookingBlockedUntil(
        now(),
        settings.rebookingPenaltyDays,
        c.rebookingBlockedUntil,
      );
      await cases.setRebookingBlock(a.case_id, blockedUntil);
    }
  }

  await emit({
    type: "appointment.cancelled",
    payload: {
      appointmentId: a.id,
      caseId: a.case_id,
      leadId: a.lead_id,
      staffId: a.staff_id,
      clientUserId: a.client_user_id,
      startsAt: new Date(a.starts_at),
      cancelledBy: actorKind,
      late,
      reason: input.reason,
    },
  });

  if (actorKind === "staff") {
    await writeAudit(
      actor,
      "scheduling.appointment.cancelled",
      "appointment",
      a.id,
      { after: { status: "cancelled", reason: input.reason } },
    );
  }
}

// ---------------------------------------------------------------------------
// rescheduleAppointment — API-SCH-04
// ---------------------------------------------------------------------------

export interface RescheduleInput {
  appointmentId: string;
  newStartsAtUtc: Date;
  reminder1d?: boolean;
  reminder1h?: boolean;
  force?: boolean;
}

/**
 * Reschedules an appointment atomically (old → rescheduled + new → scheduled).
 *
 * Client: only outside the cancellation window (OUTSIDE_WINDOW otherwise).
 * Staff: any time before starts_at.
 * New appointment inherits the same sequence_number (reagendar does NOT consume quota).
 * EXCLUDE applies to the new row as well.
 *
 * @api-id API-SCH-04
 */
export async function rescheduleAppointment(
  actor: Actor,
  input: RescheduleInput,
): Promise<AppointmentRow> {
  const a = await repo.findById(input.appointmentId);
  if (!a || (a.status as AppointmentStatus) !== "scheduled") {
    throw new SchedulingError("APPT_INVALID_TRANSITION");
  }

  const actorKind: AppointmentActorKind =
    actor.kind === "client" ? "client" : "staff";
  const settings = await repo.getSettings(a.staff_id);

  if (actorKind === "client") {
    await requireCaseAccess(actor, a.case_id!);
    if (!canClientReschedule(now(), new Date(a.starts_at), settings.cancellationWindowHours)) {
      throw new SchedulingError("OUTSIDE_WINDOW", {
        windowHours: settings.cancellationWindowHours,
      });
    }
  } else {
    can(actor, "calendar", "edit");
    if (hasStarted(now(), new Date(a.starts_at))) {
      throw new SchedulingError("APPT_ALREADY_STARTED");
    }
  }

  const newStarts = input.newStartsAtUtc;
  const newEnds = addMinutes(newStarts, durationMinutes(a));

  // Client: validate the new slot is still available
  if (actorKind === "client") {
    const margin = 2 * 86_400_000;
    const windowFrom = new Date(newStarts.getTime() - margin);
    const windowTo = new Date(newEnds.getTime() + margin);
    const [rules, exceptions, booked] = await Promise.all([
      repo.getActiveRules(a.staff_id),
      repo.getExceptionsInRange(a.staff_id, windowFrom, windowTo),
      repo.findBookedForMaterialization(a.staff_id, windowFrom, windowTo),
    ]);
    // Exclude the current appointment from "booked" (it will be rescheduled)
    const bookedWithoutCurrent = booked.filter(
      (b) => b.startsAt.getTime() !== new Date(a.starts_at).getTime(),
    );
    const slots = materializeSlots({
      rules,
      settings,
      exceptions,
      booked: bookedWithoutCurrent,
      windowFromUtc: windowFrom,
      windowToUtc: windowTo,
      durationMin: durationMinutes(a),
      nowUtc: now(),
    });
    if (!isSlotInSet({ startUtc: newStarts, endUtc: newEnds }, slots)) {
      throw new SchedulingError("SLOT_TAKEN");
    }
  }

  // Atomicity invariant (C-1):
  //   Step 1 — Insert the new appointment FIRST (can fail on EXCLUDE constraint
  //            or any DB error). If it fails, the old appointment remains
  //            'scheduled' — no data loss, fully recoverable.
  //   Step 2 — Only if Step 1 succeeds, mark the old appointment 'rescheduled'.
  //            If Step 2 fails, both rows are 'scheduled' simultaneously.
  //            This is VISIBLE (two active rows) and therefore recoverable by
  //            support/cron, never a silent orphan.
  //
  // This order is strictly safer than the inverse (mark-old first) because:
  //   - insert fail → old stays 'scheduled' (clean state, user can retry)
  //   - mark-old fail → two 'scheduled' rows (visible, never lost)
  //
  // Optional improvement: replace steps 1+2 with a single Postgres RPC
  // (reschedule_appointment_tx) defined in migration 0016_scheduling_rpcs.sql.
  // The RPC wraps both in a BEGIN/COMMIT. Until the migration is applied, the
  // two-step reorder below is the active implementation.

  // Step 1 — Insert new appointment
  let fresh: AppointmentRow;
  try {
    fresh = await repo.insertAppointment({
      caseId: a.case_id,
      leadId: a.lead_id,
      servicePhaseId: a.service_phase_id,
      staffId: a.staff_id,
      clientUserId: a.client_user_id,
      startsAt: newStarts,
      endsAt: newEnds,
      kind: a.kind,
      status: "scheduled",
      sequenceNumber: a.sequence_number,
      reminder1d: input.reminder1d ?? a.reminder_1d,
      reminder1h: input.reminder1h ?? a.reminder_1h,
      notes: a.notes,
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "SLOT_TAKEN_DB") {
      // Old appointment is still 'scheduled' — no data loss.
      throw new SchedulingError("SLOT_TAKEN");
    }
    // Old appointment is still 'scheduled' — caller can retry.
    throw err;
  }

  // Step 2 — Mark old appointment as rescheduled (only reached if Step 1 ok)
  await repo.updateAppointment(a.id, { status: "rescheduled" });

  // Set LiveKit room ID for video
  if (fresh.kind === "video") {
    await repo.updateAppointment(fresh.id, { livekitRoomId: `appt:${fresh.id}` });
  }

  await emit({
    type: "appointment.rescheduled",
    payload: {
      oldAppointmentId: a.id,
      newAppointmentId: fresh.id,
      caseId: a.case_id,
      leadId: a.lead_id,
      staffId: a.staff_id,
      clientUserId: a.client_user_id,
      oldStartsAt: new Date(a.starts_at),
      newStartsAt: newStarts,
      rescheduledBy: actorKind,
    },
  });

  if (actorKind === "staff") {
    await writeAudit(
      actor,
      "scheduling.appointment.rescheduled",
      "appointment",
      a.id,
      {
        after: {
          newAppointmentId: fresh.id,
          newStartsAt: newStarts.toISOString(),
        },
      },
    );
  }

  return fresh;
}

// ---------------------------------------------------------------------------
// completeAppointment — API-SCH-05
// ---------------------------------------------------------------------------

/**
 * Marks an appointment as completed (staff only, after starts_at).
 *
 * Emits appointment.completed for cases progress tracking.
 *
 * @api-id API-SCH-05
 */
export async function completeAppointment(
  actor: Actor,
  input: { appointmentId: string; notes?: string },
): Promise<void> {
  can(actor, "calendar", "edit");

  const a = await repo.findById(input.appointmentId);
  if (!a || !canTransitionAppointment(a.status as AppointmentStatus, "completed", "staff")) {
    throw new SchedulingError("APPT_INVALID_TRANSITION");
  }
  if (!hasStarted(now(), new Date(a.starts_at))) {
    throw new SchedulingError("APPT_NOT_STARTED");
  }

  await repo.updateAppointment(a.id, {
    status: "completed",
    notes: mergeNotes(a.notes, input.notes),
  });

  await emit({
    type: "appointment.completed",
    payload: {
      appointmentId: a.id,
      caseId: a.case_id,
      leadId: a.lead_id,
      servicePhaseId: a.service_phase_id,
      staffId: a.staff_id,
      sequenceNumber: a.sequence_number,
    },
  });

  await writeAudit(
    actor,
    "scheduling.appointment.completed",
    "appointment",
    a.id,
    { after: { status: "completed" } },
  );
}

// ---------------------------------------------------------------------------
// markNoShow — API-SCH-06
// ---------------------------------------------------------------------------

/**
 * Marks an appointment as no_show (staff only, after starts_at).
 *
 * Applies the same rebooking penalty as a late cancellation.
 * Note: no canonical appointment.no_show event in DOC-20 §5 (Propuesta SOT-4).
 *
 * @api-id API-SCH-06
 */
export async function markNoShow(
  actor: Actor,
  input: { appointmentId: string; notes?: string },
): Promise<void> {
  can(actor, "calendar", "edit");

  const a = await repo.findById(input.appointmentId);
  if (!a || !canTransitionAppointment(a.status as AppointmentStatus, "no_show", "staff")) {
    throw new SchedulingError("APPT_INVALID_TRANSITION");
  }
  if (!hasStarted(now(), new Date(a.starts_at))) {
    throw new SchedulingError("APPT_NOT_STARTED");
  }

  await repo.updateAppointment(a.id, {
    status: "no_show",
    notes: mergeNotes(a.notes, input.notes),
  });

  // Apply penalty (same as late cancellation — DOC-43 §2.4)
  if (a.case_id) {
    const settings = await repo.getSettings(a.staff_id);
    const cases = await getCasesModule();
    const c = await cases.getCaseCore(a.case_id);
    if (c) {
      const blockedUntil = computeRebookingBlockedUntil(
        now(),
        settings.rebookingPenaltyDays,
        c.rebookingBlockedUntil,
      );
      await cases.setRebookingBlock(a.case_id, blockedUntil);
    }
  }

  await writeAudit(
    actor,
    "scheduling.appointment.no_show",
    "appointment",
    a.id,
    { after: { status: "no_show" } },
  );
}

// ---------------------------------------------------------------------------
// createProspectAppointment — API-SCH-07
// ---------------------------------------------------------------------------

const ProspectAppointmentSchema = z.object({
  leadId: z.string().uuid(),
  startsAtUtc: z.date(),
  durationMinutes: z.number().int().positive(),
  kind: z.enum(["video", "phone", "presencial"]),
  reminder1d: z.boolean().default(true),
  reminder1h: z.boolean().default(false),
  notes: z.string().nullable().optional(),
  force: z.boolean().default(false),
});

export type ProspectAppointmentInput = z.input<typeof ProspectAppointmentSchema>;

/**
 * Creates an appointment for a lead (no case, no phase policy, no penalty).
 *
 * Staff only (can('calendar','edit')).
 * EXCLUDE still protects the staff's calendar from overlap.
 *
 * @api-id API-SCH-07
 */
export async function createProspectAppointment(
  actor: Actor,
  input: ProspectAppointmentInput,
): Promise<BookAppointmentResult> {
  can(actor, "calendar", "edit");
  const p = ProspectAppointmentSchema.parse(input);

  // Verify the lead exists in this org
  const supabase = createServiceClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, org_id")
    .eq("id", p.leadId)
    .maybeSingle();

  if (!lead || lead.org_id !== actor.orgId) {
    throw new SchedulingError("APPT_NOT_FOUND"); // uniform anti-enumeration
  }

  const startsAt = p.startsAtUtc;
  const endsAt = addMinutes(startsAt, p.durationMinutes);

  // Staff warnings (non-blocking)
  const settings = await repo.getSettings(actor.userId);
  const warnings = await computeBookingWarnings(actor.userId, startsAt, endsAt, settings);
  if (warnings.length > 0 && !p.force) {
    return { warnings };
  }

  let appt: AppointmentRow;
  try {
    appt = await repo.insertAppointment({
      caseId: null,
      leadId: p.leadId,
      servicePhaseId: null,
      staffId: actor.userId,
      clientUserId: null,
      startsAt,
      endsAt,
      kind: p.kind,
      status: "scheduled",
      sequenceNumber: null,
      reminder1d: p.reminder1d,
      reminder1h: p.reminder1h,
      notes: p.notes ?? null,
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "SLOT_TAKEN_DB") throw new SchedulingError("SLOT_TAKEN");
    throw err;
  }

  if (p.kind === "video") {
    await repo.updateAppointment(appt.id, { livekitRoomId: `appt:${appt.id}` });
  }

  await emit({
    type: "appointment.booked",
    payload: {
      appointmentId: appt.id,
      caseId: null,
      leadId: appt.lead_id,
      servicePhaseId: null,
      staffId: appt.staff_id,
      clientUserId: null,
      startsAt: new Date(appt.starts_at),
      kind: appt.kind,
      sequenceNumber: null,
      bookedBy: "staff",
    },
  });

  await writeAudit(
    actor,
    "scheduling.appointment.booked",
    "appointment",
    appt.id,
    { after: { leadId: appt.lead_id, startsAt: appt.starts_at } },
  );

  return { appointment: appt };
}

// ---------------------------------------------------------------------------
// getWeekAgenda — API-SCH-12
// ---------------------------------------------------------------------------

export interface AgendaAppointment {
  id: string;
  startsAt: Date;
  endsAt: Date;
  kind: string;
  status: string;
  sequenceNumber: number | null;
  caseId: string | null;
  leadId: string | null;
  clientUserId: string | null;
  livekitRoomId: string | null;
  notes: string | null;
  /** Resolved display name: client preferred_name/first_name or lead full_name. */
  clientName: string | null;
}

export interface WeekAgendaResult {
  appointments: AgendaAppointment[];
  staffTimezone: string;
}

/**
 * Returns the staff's week agenda as enriched appointment list.
 *
 * fromUtc/toUtc derive from weekStartLocal in the staff's TZ.
 * Filter 'case' / 'lead' maps to case_id != null / lead_id != null.
 *
 * @api-id API-SCH-12
 */
export async function getWeekAgenda(
  actor: Actor,
  input: {
    staffId?: string;
    weekStartLocal: string; // 'YYYY-MM-DD'
    filter?: "all" | "case" | "lead";
  },
): Promise<WeekAgendaResult> {
  can(actor, "calendar", "view");

  const staffId = input.staffId ?? actor.userId;
  const staffTimezone = await getUserTimezone(staffId);

  // Convert local week boundaries to UTC (DOC-23 §6.1 — fromZonedTime by concrete date).
  // M-7 FIX: add 7 CIVIL days in the staff timezone before converting to UTC.
  // Using addDays() on the local date string avoids the DST drift that occurs
  // when adding 7×86400s to a UTC timestamp (clocks shift by 1h across a DST
  // boundary, so 7×86400s ≠ exactly 7 local days in spring/fall).
  const fromUtc = fromZonedTime(`${input.weekStartLocal}T00:00:00`, staffTimezone);
  const toUtc = fromZonedTime(
    `${addDays(new Date(`${input.weekStartLocal}T00:00:00`), 7).toISOString().slice(0, 10)}T00:00:00`,
    staffTimezone,
  );

  const statuses = ["scheduled", "completed", "no_show"];
  const rows = await repo.findStaffAppointmentsInRange(staffId, fromUtc, toUtc, statuses);

  let appts = rows.map((r) => ({
    id: r.id,
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
    kind: r.kind,
    status: r.status,
    sequenceNumber: r.sequence_number,
    caseId: r.case_id,
    leadId: r.lead_id,
    clientUserId: r.client_user_id,
    livekitRoomId: r.livekit_room_id,
    notes: r.notes,
    clientName: null as string | null,
  }));

  // Apply filter
  if (input.filter === "case") {
    appts = appts.filter((a) => a.caseId != null);
  } else if (input.filter === "lead") {
    appts = appts.filter((a) => a.leadId != null);
  }

  // ── Batch name resolution (no N+1) ─────────────────────────────────────────
  // Two parallel queries: client_profiles for case appointments, leads for
  // prospect/lead appointments. Both scoped to actor.orgId for safety.

  const clientUserIds = [...new Set(appts.map((a) => a.clientUserId).filter((id): id is string => id != null))];
  const leadIds       = [...new Set(appts.map((a) => a.leadId).filter((id): id is string => id != null))];

  const supabase = createServiceClient();

  const [clientProfilesRes, leadsRes] = await Promise.all([
    clientUserIds.length > 0
      ? supabase
          .from("client_profiles")
          .select("user_id, first_name, preferred_name")
          .in("user_id", clientUserIds)
      : Promise.resolve({ data: [], error: null }),

    leadIds.length > 0
      ? supabase
          .from("leads")
          .select("id, full_name")
          .eq("org_id", actor.orgId)
          .in("id", leadIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  // Build lookup maps
  const clientNameMap = new Map<string, string>();
  for (const p of clientProfilesRes.data ?? []) {
    if (p.user_id) {
      clientNameMap.set(p.user_id, (p.preferred_name ?? p.first_name) || p.user_id);
    }
  }

  const leadNameMap = new Map<string, string>();
  for (const l of leadsRes.data ?? []) {
    if (l.id && l.full_name) {
      leadNameMap.set(l.id, l.full_name);
    }
  }

  // Merge names
  appts = appts.map((a) => ({
    ...a,
    clientName: a.clientUserId != null
      ? (clientNameMap.get(a.clientUserId) ?? null)
      : a.leadId != null
        ? (leadNameMap.get(a.leadId) ?? null)
        : null,
  }));

  return { appointments: appts, staffTimezone };
}

// ---------------------------------------------------------------------------
// Availability management — API-SCH-09, API-SCH-10, API-SCH-11
// ---------------------------------------------------------------------------

export interface SaveRulesInput {
  staffId?: string;
  rules: Array<{
    weekday: number;
    startLocal: string;
    endLocal: string;
  }>;
}

/**
 * Replaces all availability rules for a staff member (transactional set-based).
 * Returns orphaned future scheduled appointments.
 *
 * @api-id API-SCH-09
 */
/** Serializable availability config for the staff editor (read path). */
export interface AvailabilityConfigResult {
  rules: Array<{ weekday: number; startLocal: string; endLocal: string; isActive: boolean }>;
  exceptions: Array<{ id: string; reason: string | null; startsAt: string; endsAt: string }>;
  minNoticeHours: number;
  rebookingPenaltyDays: number;
  /** Default duration (min) for prospect/initial-evaluation appointments. */
  prospectDurationMinutes: number;
  staffTimezone: string;
}

/**
 * Reads a staff member's own availability configuration for the editor: weekly
 * rules + upcoming exceptions + the scheduling settings the editor surfaces.
 *
 * The editor page previously rendered hardcoded defaults (all days off), so the
 * weekly schedule a rep saved never reappeared on reload (RF-VAN-032 read path).
 *
 * @api-id API-SCH-09-READ
 */
export async function getAvailabilityConfig(
  actor: Actor,
  input?: { staffId?: string },
): Promise<AvailabilityConfigResult> {
  can(actor, "availability", "edit");
  const staffId = input?.staffId ?? actor.userId;

  if (staffId !== actor.userId && actor.role !== "admin") {
    throw new AuthzError("forbidden_module");
  }

  const [rules, settings, exceptions, staffTimezone] = await Promise.all([
    repo.getAllRules(staffId),
    repo.getSettings(staffId),
    repo.listExceptions(staffId, now()),
    getUserTimezone(staffId),
  ]);

  return {
    rules: rules.map((r) => ({
      weekday: r.weekday,
      // Stored as "HH:MM:SS" (time column) — the editor works in "HH:MM".
      startLocal: r.start_local.slice(0, 5),
      endLocal: r.end_local.slice(0, 5),
      isActive: r.is_active,
    })),
    exceptions: exceptions.map((e) => ({
      id: e.id,
      reason: e.reason,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
    })),
    minNoticeHours: settings.minNoticeHours,
    rebookingPenaltyDays: settings.rebookingPenaltyDays,
    prospectDurationMinutes: settings.prospectDurationMinutes,
    staffTimezone,
  };
}

export async function saveAvailabilityRules(
  actor: Actor,
  input: SaveRulesInput,
): Promise<{ orphanedAppointments: AppointmentRow[] }> {
  can(actor, "availability", "edit");
  const staffId = input.staffId ?? actor.userId;

  if (staffId !== actor.userId && actor.role !== "admin") {
    throw new AuthzError("forbidden_module");
  }

  // Validate rules (domain pure check)
  const issues = validateRuleSet(input.rules);
  if (issues.some((i) => i.code === "RULE_OVERLAP")) {
    throw new SchedulingError("AVAILABILITY_OVERLAP");
  }
  if (issues.some((i) => i.code === "RULE_DURATION_INVALID")) {
    throw new SchedulingError("AVAILABILITY_INVALID_RANGE");
  }

  const tz = await getUserTimezone(staffId);
  const ruleRows: RuleInput[] = input.rules.map((r) => ({
    weekday: r.weekday,
    startLocal: r.startLocal,
    endLocal: r.endLocal,
    timezone: tz,
    isActive: true,
  }));

  await repo.replaceRules(staffId, ruleRows);

  const orphaned = await repo.findScheduledOutsideRules(staffId, now());

  await writeAudit(
    actor,
    "scheduling.availability.updated",
    "staff_profile",
    staffId,
    { after: { ruleCount: ruleRows.length } },
  );

  return { orphanedAppointments: orphaned };
}

export interface ExceptionInput {
  staffId: string;
  startsAt: Date;
  endsAt: Date;
  reason?: string | null;
  acknowledgeAffected?: boolean;
}

/**
 * Adds an availability exception (block). Returns affected future appointments.
 *
 * @api-id API-SCH-10 (add)
 */
export async function addAvailabilityException(
  actor: Actor,
  input: ExceptionInput,
): Promise<{ exceptionRow: repo.AvailabilityExceptionRow; affected: AppointmentRow[] }> {
  can(actor, "availability", "edit");

  if (input.endsAt <= input.startsAt) {
    throw new SchedulingError("AVAILABILITY_INVALID_RANGE");
  }

  const affected = await repo.findScheduledInRange(
    input.staffId,
    input.startsAt,
    input.endsAt,
  );
  if (affected.length > 0 && !input.acknowledgeAffected) {
    throw new SchedulingError("EXCEPTION_AFFECTS_APPOINTMENTS", {
      affected: affected.map((a) => a.id),
    });
  }

  const row = await repo.insertException({
    staffId: input.staffId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    reason: input.reason ?? null,
  });

  await writeAudit(
    actor,
    "scheduling.exception.created",
    "availability_exception",
    row.id,
    { after: { staffId: input.staffId } },
  );

  return { exceptionRow: row, affected };
}

/**
 * Removes an availability exception (block removed → slots available again).
 *
 * @api-id API-SCH-10 (remove)
 */
export async function removeAvailabilityException(
  actor: Actor,
  exceptionId: string,
): Promise<void> {
  can(actor, "availability", "edit");
  await repo.deleteException(exceptionId);

  await writeAudit(
    actor,
    "scheduling.exception.removed",
    "availability_exception",
    exceptionId,
    {},
  );
}

const SettingsSchema = z.object({
  staffId: z.string().uuid().optional(),
  minNoticeHours: z.number().min(0).optional(),
  maxAdvanceDays: z.number().positive().optional(),
  bufferMinutes: z.number().min(0).optional(),
  cancellationWindowHours: z.number().min(0).optional(),
  rebookingPenaltyDays: z.number().min(0).optional(),
  // Prospect/initial-evaluation cita duration (Mi disponibilidad). The view
  // sends it as `defaultDurationMinutes`; persisted to prospect_duration_minutes.
  defaultDurationMinutes: z.number().min(5).optional(),
});

export type SettingsInput = z.input<typeof SettingsSchema>;

/**
 * Updates scheduling settings for a staff member.
 * Only affects future slots/bookings (no retroactive changes — RF-VAN-035 CA1).
 *
 * @api-id (settings mutation)
 */
export async function updateSchedulingSettings(
  actor: Actor,
  input: SettingsInput,
): Promise<void> {
  can(actor, "availability", "edit");
  const p = SettingsSchema.parse(input);
  const staffId = p.staffId ?? actor.userId;

  await repo.upsertSettings(staffId, {
    minNoticeHours: p.minNoticeHours,
    maxAdvanceDays: p.maxAdvanceDays,
    bufferMinutes: p.bufferMinutes,
    cancellationWindowHours: p.cancellationWindowHours,
    rebookingPenaltyDays: p.rebookingPenaltyDays,
    prospectDurationMinutes: p.defaultDurationMinutes,
  });

  await writeAudit(
    actor,
    "scheduling.settings.updated",
    "staff_profile",
    staffId,
    { after: p },
  );
}

/**
 * Migrates availability rule timezones when staff changes their TZ.
 * convert=true: rewrite start_local/end_local/timezone keeping wall times in new TZ.
 * convert=false: keep snapshot as-is (slots will shift in the new TZ).
 *
 * @api-id API-SCH-11
 */
export async function migrateAvailabilityTimezone(
  actor: Actor,
  input: { staffId?: string; convert: boolean },
): Promise<void> {
  can(actor, "availability", "edit");
  const staffId = input.staffId ?? actor.userId;

  if (input.convert) {
    const tz = await getUserTimezone(staffId);
    await repo.rewriteRulesTimezone(staffId, tz);
  }

  await writeAudit(
    actor,
    "scheduling.availability.tz_migrated",
    "staff_profile",
    staffId,
    { after: { convert: input.convert } },
  );
}

// ---------------------------------------------------------------------------
// Phase policies & case overrides — API-SCH-13
// ---------------------------------------------------------------------------

const PhasePolicySchema = z.object({
  servicePhaseId: z.string().uuid(),
  appointmentCount: z.number().int().positive(),
  durationMinutes: z.number().int().positive(),
  kind: z.enum(["video", "phone", "presencial"]),
});

export type PhasePolicyInput = z.input<typeof PhasePolicySchema>;

/**
 * Upserts the appointment policy for a service phase.
 * Affects all future appointments in the phase (except case overrides).
 *
 * @api-id API-SCH-13
 */
export async function upsertPhasePolicy(
  actor: Actor,
  input: PhasePolicyInput,
): Promise<void> {
  can(actor, "calendar", "edit");
  const p = PhasePolicySchema.parse(input);

  await repo.upsertPhasePolicy(p.servicePhaseId, {
    appointmentCount: p.appointmentCount,
    durationMinutes: p.durationMinutes,
    kind: p.kind,
    updatedBy: actor.userId,
  });

  await writeAudit(
    actor,
    "scheduling.phase_policy.updated",
    "service_phase",
    p.servicePhaseId,
    { after: p },
  );
}

const CaseOverrideSchema = z.object({
  caseId: z.string().uuid(),
  servicePhaseId: z.string().uuid(),
  appointmentCount: z.number().int().positive().nullable().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
});

export type CaseOverrideInput = z.input<typeof CaseOverrideSchema>;

/**
 * Sets (or removes) the appointment override for a specific case + phase.
 * Pass null for both counts to remove the override (revert to phase global).
 */
export async function setCaseOverride(
  actor: Actor,
  input: CaseOverrideInput,
): Promise<void> {
  can(actor, "calendar", "edit");
  const p = CaseOverrideSchema.parse(input);

  if (p.appointmentCount == null && p.durationMinutes == null) {
    await repo.deleteCaseOverride(p.caseId, p.servicePhaseId);
  } else {
    await repo.upsertCaseOverride({
      caseId: p.caseId,
      servicePhaseId: p.servicePhaseId,
      appointmentCount: p.appointmentCount ?? null,
      durationMinutes: p.durationMinutes ?? null,
      setBy: actor.userId,
    });
  }

  await writeAudit(
    actor,
    "scheduling.case_override.set",
    "case",
    p.caseId,
    { after: p },
  );
}

/**
 * Lifts the rebooking block for a client (staff/admin action).
 */
export async function liftRebookingBlock(
  actor: Actor,
  caseId: string,
): Promise<void> {
  can(actor, "calendar", "edit");

  const cases = await getCasesModule();
  await cases.setRebookingBlock(caseId, null);

  await writeAudit(
    actor,
    "scheduling.rebooking_block.lifted",
    "case",
    caseId,
    { after: { rebookingBlockedUntil: null } },
  );
}

// ---------------------------------------------------------------------------
// Client-facing reads
// ---------------------------------------------------------------------------

/**
 * Returns a single appointment for client verification (anti-enumeration: same
 * error for not found / access denied).
 */
export async function getAppointmentForClient(
  actor: Actor,
  appointmentId: string,
): Promise<AppointmentRow> {
  const a = await repo.findById(appointmentId);
  if (!a) throw new SchedulingError("APPT_NOT_FOUND");
  if (a.case_id) {
    await requireCaseAccess(actor, a.case_id);
  } else if (actor.kind !== "staff") {
    throw new SchedulingError("APPT_NOT_FOUND");
  }
  return a;
}

/**
 * Lists appointments for a case (client or staff).
 */
export async function getCaseAppointments(
  actor: Actor,
  caseId: string,
): Promise<AppointmentRow[]> {
  await requireCaseAccess(actor, caseId);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("appointments")
    .select("*")
    .eq("case_id", caseId)
    .order("starts_at");
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Advisor name for client-facing cita screen — API-SCH-17
// ---------------------------------------------------------------------------

export interface AppointmentAdvisorResult {
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Returns the display name + avatar URL of the staff member assigned to an
 * appointment, scoped for a client actor.
 *
 * Security:
 *  - `requireCaseAccess` runs first, enforcing RLS: the client may only read
 *    this if they are a member of the case the appointment belongs to.
 *  - `createServiceClient` (service_role) is used to read `staff_profiles`
 *    because clients have no direct SELECT policy on that table. The returned
 *    shape is intentionally minimal: {displayName, avatarUrl} — no PII beyond
 *    what DOC-51 §19 requires.
 *
 * @api-id API-SCH-17
 */
export async function getAppointmentAdvisor(
  actor: Actor,
  appointmentId: string,
): Promise<AppointmentAdvisorResult | null> {
  // 1. Load the appointment (service client for bypassing RLS on appointments)
  const a = await repo.findById(appointmentId);
  if (!a) return null;

  // 2. Enforce: client must be a member of the case this appointment belongs to.
  if (a.case_id) {
    await requireCaseAccess(actor, a.case_id);
  } else if (actor.kind !== "staff") {
    // Prospect appointments have no case; a non-staff actor has no business here.
    return null;
  }

  // 3. Read staff_profiles via service client (clients have no SELECT policy there).
  //    We expose ONLY {displayName, avatarUrl} — never role, email, or other PII.
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("staff_profiles")
    .select("display_name, avatar_url")
    .eq("user_id", a.staff_id)
    .maybeSingle();

  if (!data) return null;

  return {
    displayName: data.display_name,
    avatarUrl: data.avatar_url,
  };
}
