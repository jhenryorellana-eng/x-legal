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

import { can, requireCaseAccess } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { appEvents } from "@/backend/platform/events";
import { createServiceClient } from "@/backend/platform/supabase";
import { logger } from "@/backend/platform/logger";
import { writeAudit } from "@/backend/modules/audit";
import type { I18nText } from "@/shared/i18n";

import {
  canTransitionAppointment,
  isLateCancellation,
  canClientReschedule,
  hasStarted,
  effectivePolicy,
  effectiveAppointmentCount,
  scheduleEntryForSequence,
  nextRouteSequenceNumber,
  mergeCaseSchedule,
  resolveObjectivesOutcome,
  computeRebookingBlockedUntil,
  isRebookingBlocked,
  validateRuleSet,
  materializeSlots,
  convertRuleWallTime,
  isSlotInSet,
  type AppointmentStatus,
  type AppointmentActorKind,
  type Slot,
  type ObjectiveOutcome,
  type ObjectiveTemplate,
  type AppointmentScheduleEntry,
} from "./domain";

import * as repo from "./repository";
import type { AppointmentRow, RuleInput } from "./repository";

/**
 * Effective cronograma for a case = the service template (service_appointment_schedule)
 * merged with the case's own extra/intermediate citas (case_appointment_schedule).
 * Single source for the route, the booking quota, and objective resolution so an
 * added intermediate cita counts, schedules, shows objectives, and can be completed.
 */
async function getCaseEffectiveSchedule(
  caseId: string,
  phaseId: string,
): Promise<AppointmentScheduleEntry[]> {
  const [service, extras] = await Promise.all([
    repo.getAppointmentSchedule(phaseId),
    repo.getCaseAppointmentScheduleRows(caseId, phaseId),
  ]);
  return mergeCaseSchedule(service, extras);
}

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

/**
 * Resolves the org's default "serving" sales owner — the staff_id stamped on an
 * appointment when the case has no assigned sales. Picks the earliest-created
 * active sales member (today: Vanessa). This is the org-level fallback that
 * removes the NO_STAFF_ASSIGNED dead-end for cases created without a sales.
 *
 * Scalability note (DOC-43): with more than one sales, formalize this with an
 * additive `orgs.default_sales_owner_id` column instead of created_at ordering.
 */
async function defaultSalesOwner(orgId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("users")
    .select("id, staff_profiles!inner(role)")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .eq("staff_profiles.role", "sales")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
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
  orgId: string,
  startsAt: Date,
  endsAt: Date,
  // settings is intentionally ignored — the function re-fetches via repo.getSettings
  // to avoid stale-closure issues when called across multiple paths
  _settings?: unknown,
): Promise<BookingWarning[]> {
  const warnings: BookingWarning[] = [];
  const nowTs = now();

  const fullSettings = await repo.getSettings(orgId);

  // Check min_notice
  if (startsAt.getTime() < nowTs.getTime() + fullSettings.minNoticeHours * 3_600_000) {
    warnings.push({ code: "OUTSIDE_WINDOW" });
  }

  // Check max_advance
  if (startsAt.getTime() > nowTs.getTime() + fullSettings.maxAdvanceDays * 86_400_000) {
    warnings.push({ code: "OUTSIDE_WINDOW" });
  }

  // Check availability rules (is the slot within any active rule?)
  const rules = await repo.getActiveRules(orgId);
  const exceptions = await repo.getExceptionsInRange(
    orgId,
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
    // Neutralize BOTH window clips so this only tests "is the slot inside an
    // availability rule" (min_notice / max_advance are checked separately above).
    // Must sit in [startsAt − maxAdvance, startsAt − minNotice]: park it just
    // before the min_notice boundary. Using a far-past value would push
    // `nowUtc + maxAdvanceDays` BEFORE the slot, collapsing the window to empty
    // and flagging every booking as OUTSIDE_AVAILABILITY.
    nowUtc: new Date(startsAt.getTime() - fullSettings.minNoticeHours * 3_600_000 - 60_000),
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
  /**
   * Agenda/office reference TZ (the serving rules' snapshot zone, or the org
   * office TZ as fallback). Use ONLY for the secondary "office/global" chip —
   * never as the primary display zone.
   */
  staffTimezone: string;
  /**
   * The requesting actor's own profile TZ (`users.timezone`). This is the
   * PRIMARY display zone for whoever called: staff see their own zone, clients
   * see theirs. Slots are UTC; format them in this zone (DOC-23 §6.5).
   */
  viewerTimezone: string;
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
    getCaseEffectiveSchedule(input.caseId, c.currentPhaseId),
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

  // Org-level agenda: availability/anti-overlap belong to the ORG, not a person.
  // staffId is "who attends" — the case's assigned sales, falling back to the
  // org's default sales owner so a case without an assigned sales still books.
  const orgId = actor.orgId;
  const staffId = c.assignedSalesId ?? (await defaultSalesOwner(orgId));
  if (!staffId) {
    throw new SchedulingError("NO_STAFF_ASSIGNED");
  }

  // Resolve the NEXT cita's duration/kind from the cronograma (schedule row for
  // its sequence number), falling back to the uniform phase policy.
  const seqNumbers = await repo.getPhaseSequenceNumbers(
    input.caseId,
    c.currentPhaseId,
  );
  // Next cita to book follows the ROUTE order, so an intermediate cita is booked
  // before the citas it precedes (not by raw sequence_number max+1).
  const sequenceNumber = nextRouteSequenceNumber(schedule, seqNumbers);
  const entry = scheduleEntryForSequence(schedule, sequenceNumber);
  const durationMin = entry?.durationMinutes ?? policy.durationMinutes;
  const kind = entry?.kind ?? policy.kind;

  const [rules, settings, exceptions, booked] = await Promise.all([
    repo.getActiveRules(orgId),
    repo.getSettings(orgId),
    repo.getExceptionsInRange(orgId, input.windowFromUtc, input.windowToUtc),
    repo.findBookedForMaterialization(orgId, input.windowFromUtc, input.windowToUtc),
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

  // staffTimezone = the org's office/global reference TZ (the "Utah" secondary
  // chip); the per-rule snapshot zones are internal to materializeSlots. The
  // viewer TZ is the requester's own profile zone — the PRIMARY display
  // (DOC-23 §6.5).
  const staffTimezone = await repo.getOfficeTimezone(orgId);
  const viewerTimezone = await getUserTimezone(actor.userId);

  return {
    slots,
    durationMinutes: durationMin,
    kind,
    sequenceNumber,
    staffId,
    staffTimezone,
    viewerTimezone,
  };
}

// ---------------------------------------------------------------------------
// getProspectSlots — org-level slots for a lead/evaluation cita (no case)
// ---------------------------------------------------------------------------

export interface GetProspectSlotsInput {
  windowFromUtc: Date;
  windowToUtc: Date;
}

export interface GetProspectSlotsResult {
  slots: Slot[];
  durationMinutes: number;
  kind: "video" | "phone" | "presencial";
  /** Agenda/office reference TZ — secondary "office/global" chip only. */
  staffTimezone: string;
  /** Requesting staff's own profile TZ — PRIMARY display zone (DOC-23 §6.5). */
  viewerTimezone: string;
}

/**
 * Materialises slots for a prospect (lead) cita. There is no case/phase, so the
 * duration comes from the org's `prospect_duration_minutes` and the modality is
 * the org default ('video'). Availability/anti-overlap are org-level, exactly
 * like {@link getAvailableSlots}. Staff only.
 */
export async function getProspectSlots(
  actor: Actor,
  input: GetProspectSlotsInput,
): Promise<GetProspectSlotsResult> {
  can(actor, "calendar", "view");

  const orgId = actor.orgId;
  const [rules, settings, exceptions, booked] = await Promise.all([
    repo.getActiveRules(orgId),
    repo.getSettings(orgId),
    repo.getExceptionsInRange(orgId, input.windowFromUtc, input.windowToUtc),
    repo.findBookedForMaterialization(orgId, input.windowFromUtc, input.windowToUtc),
  ]);

  const durationMin = settings.prospectDurationMinutes;

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

  const staffTimezone = await repo.getOfficeTimezone(orgId);
  const viewerTimezone = await getUserTimezone(actor.userId);

  return { slots, durationMinutes: durationMin, kind: "video", staffTimezone, viewerTimezone };
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
  /** Note the CLIENT writes when self-booking ("Nota para tu asesora"). Stored
   *  separately from `notes` (staff internal log) so the two never mix. */
  clientNote: z.string().trim().max(5000).nullable().optional(),
  force: z.boolean().default(false),
  /** Per-cita override for the video link; falls back to the org default. */
  videoLink: z.string().trim().max(2000).nullable().optional(),
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
    getCaseEffectiveSchedule(p.caseId, phaseId),
  ]);
  const policy = effectivePolicy(phasePolicy, caseOverride);

  // Sequence number first, so the cita's own duration/kind (from the cronograma
  // schedule row) can be resolved. Staff-supplied values still win. Follows the
  // ROUTE order so an intermediate cita is booked before the ones it precedes.
  const sequenceNumber = nextRouteSequenceNumber(
    schedule,
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

  // Org-level agenda: staffId is "who attends" (assigned sales → org default).
  const orgId = actor.orgId;
  const staffId = c.assignedSalesId ?? (await defaultSalesOwner(orgId));
  if (!staffId) throw new SchedulingError("NO_STAFF_ASSIGNED");

  // Validate slot or compute warnings
  if (actor.kind === "client") {
    // Re-materialise around the requested slot to validate it's still available
    const margin = 2 * 86_400_000; // 2-day window
    const windowFrom = new Date(startsAt.getTime() - margin);
    const windowTo = new Date(endsAt.getTime() + margin);
    const [rules, settings, exceptions, booked] = await Promise.all([
      repo.getActiveRules(orgId),
      repo.getSettings(orgId),
      repo.getExceptionsInRange(orgId, windowFrom, windowTo),
      repo.findBookedForMaterialization(orgId, windowFrom, windowTo),
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
    const settings = await repo.getSettings(orgId);
    const warnings = await computeBookingWarnings(orgId, startsAt, endsAt, settings);
    if (warnings.length > 0 && !p.force) {
      return { warnings };
    }
  }

  // Insert the appointment — EXCLUDE protects against race conditions
  let appt: AppointmentRow;
  try {
    appt = await repo.insertAppointment({
      orgId,
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
      clientNote: p.clientNote ?? null,
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "SLOT_TAKEN_DB") throw new SchedulingError("SLOT_TAKEN");
    throw err;
  }

  // For video appointments: assign a LiveKit room (F7) and snapshot the video
  // link the client will open — a per-cita override, else the org default.
  if (apptKind === "video") {
    const orgVideoLink = (await repo.getSettings(orgId)).videoLink;
    const videoLink = p.videoLink ? p.videoLink : orgVideoLink;
    await repo.updateAppointment(appt.id, {
      livekitRoomId: `appt:${appt.id}`,
      videoLink: videoLink ?? null,
    });
    appt = { ...appt, livekit_room_id: `appt:${appt.id}`, video_link: videoLink ?? null };
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

  const settings = await repo.getSettings(a.org_id);
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
  const settings = await repo.getSettings(a.org_id);

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
      repo.getActiveRules(a.org_id),
      repo.getExceptionsInRange(a.org_id, windowFrom, windowTo),
      repo.findBookedForMaterialization(a.org_id, windowFrom, windowTo),
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

  // Atomicity + uniqueness invariant (C-1, revised):
  //   The partial unique index appointments_case_phase_seq_unique_idx forbids
  //   TWO rows sharing (case_id, service_phase_id, sequence_number) while both
  //   are 'scheduled'/'completed'. The new cita inherits the old one's
  //   sequence_number, so inserting it while the old row is still 'scheduled'
  //   ALWAYS violates that index for case citas (only lead / seq-less citas
  //   escaped it). Insert-first is therefore not viable — it 500s in prod even
  //   though the unit mocks (no real index, service_phase_id null) never caught
  //   it. So we FREE the slot first, then insert, then compensate on failure:
  //     Step 1 — mark the old cita 'rescheduled' (leaves the unique scope).
  //     Step 2 — insert the new cita. If it fails, roll the old cita back to
  //              'scheduled' so the case is never stranded.
  //   Worst case (insert fails AND the rollback fails — a double fault) leaves
  //   the old cita 'rescheduled' with no replacement: VISIBLE and recoverable,
  //   never a silent double-booking.
  //
  //   The atomic alternative is the reschedule_appointment_tx RPC
  //   (0016_scheduling_rpcs.sql); it must also free the slot before inserting,
  //   since the index is evaluated per-statement, not deferred to commit.

  // Step 1 — Free the unique (case, phase, seq) slot held by the old cita.
  await repo.updateAppointment(a.id, { status: "rescheduled" });

  // Step 2 — Insert the new cita; compensate the old one on any failure.
  let fresh: AppointmentRow;
  try {
    fresh = await repo.insertAppointment({
      orgId: a.org_id,
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
      clientNote: a.client_note,
    });
  } catch (err) {
    // Compensation: restore the old cita so it is never silently orphaned.
    try {
      await repo.updateAppointment(a.id, { status: "scheduled" });
    } catch (revertErr) {
      logger.error(
        { err: revertErr, appointmentId: a.id },
        "scheduling.reschedule: failed to roll back old appointment after insert error",
      );
    }
    const code = (err as { code?: string }).code;
    if (code === "SLOT_TAKEN_DB") throw new SchedulingError("SLOT_TAKEN");
    throw err;
  }

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
 * Records which objectives were achieved (snapshot on the appointment, staff
 * detail) and emits appointment.completed with a high-level summary so the cases
 * module can project a client-visible "X de Y objetivos" timeline entry.
 *
 * @api-id API-SCH-05
 */
export async function completeAppointment(
  actor: Actor,
  input: {
    appointmentId: string;
    notes?: string;
    objectivesOutcome?: ObjectiveOutcome[];
  },
): Promise<void> {
  can(actor, "calendar", "edit");

  const a = await repo.findById(input.appointmentId);
  if (!a || !canTransitionAppointment(a.status as AppointmentStatus, "completed", "staff")) {
    throw new SchedulingError("APPT_INVALID_TRANSITION");
  }
  if (!hasStarted(now(), new Date(a.starts_at))) {
    throw new SchedulingError("APPT_NOT_STARTED");
  }

  const outcome = input.objectivesOutcome ?? null;
  await repo.updateAppointment(a.id, {
    status: "completed",
    notes: mergeNotes(a.notes, input.notes),
    objectivesOutcome: outcome,
  });

  const objectivesSummary = outcome
    ? { total: outcome.length, achieved: outcome.filter((o) => o.achieved).length }
    : null;

  await emit({
    type: "appointment.completed",
    payload: {
      appointmentId: a.id,
      caseId: a.case_id,
      leadId: a.lead_id,
      servicePhaseId: a.service_phase_id,
      staffId: a.staff_id,
      sequenceNumber: a.sequence_number,
      objectivesSummary,
    },
  });

  await writeAudit(
    actor,
    "scheduling.appointment.completed",
    "appointment",
    a.id,
    { after: { status: "completed", objectivesSummary } },
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
  let blockedUntil: Date | null = null;
  if (a.case_id) {
    const settings = await repo.getSettings(a.org_id);
    const cases = await getCasesModule();
    const c = await cases.getCaseCore(a.case_id);
    if (c) {
      blockedUntil = computeRebookingBlockedUntil(
        now(),
        settings.rebookingPenaltyDays,
        c.rebookingBlockedUntil,
      );
      await cases.setRebookingBlock(a.case_id, blockedUntil);
    }
  }

  await emit({
    type: "appointment.no_show",
    payload: {
      appointmentId: a.id,
      caseId: a.case_id,
      leadId: a.lead_id,
      staffId: a.staff_id,
      clientUserId: a.client_user_id,
      startsAt: new Date(a.starts_at),
      blockedUntil,
    },
  });

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

  // Staff warnings (non-blocking) — org-level availability
  const settings = await repo.getSettings(actor.orgId);
  const warnings = await computeBookingWarnings(actor.orgId, startsAt, endsAt, settings);
  if (warnings.length > 0 && !p.force) {
    return { warnings };
  }

  let appt: AppointmentRow;
  try {
    appt = await repo.insertAppointment({
      orgId: actor.orgId,
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
    const videoLink = settings.videoLink;
    await repo.updateAppointment(appt.id, {
      livekitRoomId: `appt:${appt.id}`,
      videoLink: videoLink ?? null,
    });
    appt = { ...appt, livekit_room_id: `appt:${appt.id}`, video_link: videoLink ?? null };
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
  servicePhaseId: string | null;
  clientUserId: string | null;
  livekitRoomId: string | null;
  videoLink: string | null;
  notes: string | null;
  /** Note the CLIENT wrote when self-booking (read-only for staff). */
  clientNote: string | null;
  /** Objectives for this cita, resolved from the service cronograma (i18n). */
  objectives: ObjectiveTemplate[];
  /** Recorded objectives outcome when completed (staff detail); null otherwise. */
  objectivesOutcome: ObjectiveOutcome[] | null;
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
    /** @deprecated org-level agenda: ignored. Kept for call-site compatibility. */
    staffId?: string;
    weekStartLocal: string; // 'YYYY-MM-DD'
    filter?: "all" | "case" | "lead";
  },
): Promise<WeekAgendaResult> {
  can(actor, "calendar", "view");

  // Org-level agenda: every staff member sees the SAME appointments (DOC-43),
  // each rendered in THEIR OWN timezone (DOC-23 §6.5) — Vanessa in Colombia,
  // Henry in the US see the same citas at their respective local times.
  const orgId = actor.orgId;
  const staffTimezone = await getUserTimezone(actor.userId);

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
  const rows = await repo.findOrgAppointmentsInRange(orgId, fromUtc, toUtc, statuses);

  let appts: AgendaAppointment[] = rows.map((r) => ({
    id: r.id,
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
    kind: r.kind,
    status: r.status,
    sequenceNumber: r.sequence_number,
    caseId: r.case_id,
    leadId: r.lead_id,
    servicePhaseId: r.service_phase_id,
    clientUserId: r.client_user_id,
    livekitRoomId: r.livekit_room_id,
    videoLink: r.video_link,
    notes: r.notes,
    clientNote: r.client_note,
    objectives: [],
    objectivesOutcome: resolveObjectivesOutcome(r.objectives_outcome),
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

  // ── Batch objectives resolution (no N+1) ───────────────────────────────────
  // One effective schedule per distinct (case, phase) so per-case intermediate
  // citas resolve their own objectives; lead/prospect appointments (no case)
  // fall back to the service template. Objectives are matched by sequence_number.
  const schedKey = (caseId: string | null, phaseId: string) =>
    caseId ? `${caseId}::${phaseId}` : `service::${phaseId}`;
  const schedCombos = new Map<string, { caseId: string | null; phaseId: string }>();
  for (const a of appts) {
    if (a.servicePhaseId) {
      schedCombos.set(schedKey(a.caseId, a.servicePhaseId), {
        caseId: a.caseId,
        phaseId: a.servicePhaseId,
      });
    }
  }
  const schedulesByCombo = new Map<string, AppointmentScheduleEntry[]>();
  await Promise.all(
    [...schedCombos].map(async ([key, { caseId, phaseId }]) => {
      schedulesByCombo.set(
        key,
        caseId
          ? await getCaseEffectiveSchedule(caseId, phaseId)
          : await repo.getAppointmentSchedule(phaseId),
      );
    }),
  );

  // Merge names + objectives
  appts = appts.map((a) => {
    const entry =
      a.servicePhaseId && a.sequenceNumber != null
        ? scheduleEntryForSequence(
            schedulesByCombo.get(schedKey(a.caseId, a.servicePhaseId)) ?? [],
            a.sequenceNumber,
          )
        : null;
    return {
      ...a,
      objectives: entry?.objectives ?? [],
      clientName: a.clientUserId != null
        ? (clientNameMap.get(a.clientUserId) ?? null)
        : a.leadId != null
          ? (leadNameMap.get(a.leadId) ?? null)
          : null,
    };
  });

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
  /** Org-wide default video-call link (shown in "Reglas de la cita"). */
  videoLink: string | null;
  /** Org-wide default for automatic client reminders. */
  remindersEnabled: boolean;
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
  _input?: { staffId?: string },
): Promise<AvailabilityConfigResult> {
  can(actor, "availability", "edit");
  // Org-level agenda: a single shared availability config for the whole org.
  const orgId = actor.orgId;

  const [rules, settings, exceptions, actorTz, officeTz] = await Promise.all([
    repo.getAllRules(orgId),
    repo.getSettings(orgId),
    repo.listExceptions(orgId, now()),
    getUserTimezone(actor.userId),
    repo.getOfficeTimezone(orgId),
  ]);
  // The editor shows the org availability in the STAFF's own timezone (DOC-23
  // §6.5): convert each rule from the canonical office TZ to the actor's TZ.
  const ref = now();
  const staffTimezone = actorTz;

  return {
    rules: rules.map((r) => {
      // Stored as "HH:MM:SS" (time column); the editor works in "HH:MM".
      const fromTz = r.timezone || officeTz;
      const s = convertRuleWallTime(
        { weekday: r.weekday, hhmm: r.start_local.slice(0, 5) },
        fromTz,
        actorTz,
        ref,
      );
      const e = convertRuleWallTime(
        { weekday: r.weekday, hhmm: r.end_local.slice(0, 5) },
        fromTz,
        actorTz,
        ref,
      );
      return {
        weekday: s.weekday,
        startLocal: s.hhmm,
        endLocal: e.hhmm,
        isActive: r.is_active,
      };
    }),
    exceptions: exceptions.map((e) => ({
      id: e.id,
      reason: e.reason,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
    })),
    minNoticeHours: settings.minNoticeHours,
    rebookingPenaltyDays: settings.rebookingPenaltyDays,
    prospectDurationMinutes: settings.prospectDurationMinutes,
    videoLink: settings.videoLink,
    remindersEnabled: settings.remindersEnabled,
    staffTimezone,
  };
}

export async function saveAvailabilityRules(
  actor: Actor,
  input: SaveRulesInput,
): Promise<{ orphanedAppointments: AppointmentRow[] }> {
  can(actor, "availability", "edit");
  // Org-level agenda: the whole org shares one availability set.
  const orgId = actor.orgId;

  // Validate rules (domain pure check)
  const issues = validateRuleSet(input.rules);
  if (issues.some((i) => i.code === "RULE_OVERLAP")) {
    throw new SchedulingError("AVAILABILITY_OVERLAP");
  }
  if (issues.some((i) => i.code === "RULE_DURATION_INVALID")) {
    throw new SchedulingError("AVAILABILITY_INVALID_RANGE");
  }

  // Snapshot model (DOC-23 §6.4): the staff edits in THEIR OWN timezone and the
  // rule is persisted with that zone verbatim — NO collapse to a single office TZ.
  // This keeps "saved exactly as I see it in my zone" literal and avoids DST drift
  // for zones without DST (e.g. America/Lima, America/Bogota): a rule stored as
  // "09:00 America/Lima" is always 09:00 Lima. Each rule carries its own snapshot
  // TZ; display and materialisation translate per rule (getAvailabilityConfig +
  // materializeSlots already read `rule.timezone`). The org `office_timezone` is
  // only a reference/label and a fallback for rules with no snapshot.
  const actorTz = await getUserTimezone(actor.userId);
  const ruleRows: RuleInput[] = input.rules.map((r) => ({
    weekday: r.weekday,
    startLocal: r.startLocal,
    endLocal: r.endLocal,
    timezone: actorTz,
    isActive: true,
  }));

  await repo.replaceRules(orgId, ruleRows);

  const orphaned = await repo.findScheduledOutsideRules(orgId, now());

  await writeAudit(
    actor,
    "scheduling.availability.updated",
    "org",
    orgId,
    { after: { ruleCount: ruleRows.length } },
  );

  return { orphanedAppointments: orphaned };
}

export interface ExceptionInput {
  /** @deprecated org-level agenda: ignored. Kept for call-site compatibility. */
  staffId?: string;
  startsAt: Date;
  endsAt: Date;
  reason?: string | null;
  acknowledgeAffected?: boolean;
}

/**
 * Adds an availability exception (block) for the org. Returns affected future
 * appointments.
 *
 * @api-id API-SCH-10 (add)
 */
export async function addAvailabilityException(
  actor: Actor,
  input: ExceptionInput,
): Promise<{ exceptionRow: repo.AvailabilityExceptionRow; affected: AppointmentRow[] }> {
  can(actor, "availability", "edit");
  const orgId = actor.orgId;

  if (input.endsAt <= input.startsAt) {
    throw new SchedulingError("AVAILABILITY_INVALID_RANGE");
  }

  const affected = await repo.findScheduledInRange(
    orgId,
    input.startsAt,
    input.endsAt,
  );
  if (affected.length > 0 && !input.acknowledgeAffected) {
    throw new SchedulingError("EXCEPTION_AFFECTS_APPOINTMENTS", {
      affected: affected.map((a) => a.id),
    });
  }

  const row = await repo.insertException({
    orgId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    reason: input.reason ?? null,
  });

  await writeAudit(
    actor,
    "scheduling.exception.created",
    "availability_exception",
    row.id,
    { after: { orgId } },
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
  // Org-wide default video-call link ("" clears it) + auto-reminders toggle.
  videoLink: z.string().trim().max(2000).nullable().optional(),
  remindersEnabled: z.boolean().optional(),
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
  // Org-level agenda: one settings row per org.
  const orgId = actor.orgId;

  await repo.upsertSettings(orgId, {
    minNoticeHours: p.minNoticeHours,
    maxAdvanceDays: p.maxAdvanceDays,
    bufferMinutes: p.bufferMinutes,
    cancellationWindowHours: p.cancellationWindowHours,
    rebookingPenaltyDays: p.rebookingPenaltyDays,
    prospectDurationMinutes: p.defaultDurationMinutes,
    // Normalize "" → null so an empty field clears the org link.
    videoLink:
      p.videoLink === undefined ? undefined : p.videoLink ? p.videoLink : null,
    remindersEnabled: p.remindersEnabled,
  });

  await writeAudit(
    actor,
    "scheduling.settings.updated",
    "org",
    orgId,
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
  const orgId = actor.orgId;

  if (input.convert) {
    const tz = await getUserTimezone(actor.userId);
    await repo.rewriteRulesTimezone(orgId, tz);
  }

  await writeAudit(
    actor,
    "scheduling.availability.tz_migrated",
    "org",
    orgId,
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
// Case appointment route ("ruta de citas") — API-SCH-18 / API-SCH-19
// ---------------------------------------------------------------------------

const zUuidLax = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    "uuid",
  );

export interface RutaCitaObjective {
  id: string;
  /** Template text (i18n) for planned citas; outcome text wrapped for completed ones. */
  text: I18nText;
  /** Outcome flag once the cita is completed; null while planned/in-progress. */
  achieved: boolean | null;
}

export interface RutaCita {
  /** Display order in the route (1-based). The "Cita N" the user sees. */
  number: number;
  /** Internal id linking the planned cita to its booked instance. NOT the display number. */
  sequenceNumber: number;
  labelI18n: I18nText | null;
  kind: "video" | "phone" | "presencial";
  weekOffset: number;
  /** "service" = from the shared cronograma; "case" = an extra added to this case. */
  origin: "service" | "case";
  /** completed = the booked instance is completed; current = next pending; rest upcoming. */
  status: "completed" | "current" | "upcoming";
  objectives: RutaCitaObjective[];
  /** The booked instance for this cita (by sequence_number), if any. */
  appointment: {
    id: string;
    startsAt: string;
    status: string;
    videoLink: string | null;
  } | null;
}

export interface CaseRutaResult {
  phaseId: string | null;
  phaseLabelI18n: I18nText | null;
  /** Number of citas planned for the current phase (service + per-case extras). */
  total: number;
  /** Sequence number of the cita the case is currently on, or null if all done. */
  currentSequence: number | null;
  citas: RutaCita[];
}

/** One entry of the ordered effective route + its live instance + computed status. */
interface CaseRouteEntry {
  entry: AppointmentScheduleEntry;
  appt: AppointmentRow | null;
  status: "completed" | "current" | "upcoming";
}

/**
 * Builds the ordered effective route of a case's phase with each cita's LIVE
 * instance and status (completed / current / upcoming). Shared by getCaseRuta
 * (display) and addCaseAppointment (anchor for intermediate insertion).
 *
 * The route order is the effective schedule order (mergeCaseSchedule), so the
 * "current" cita is the first NON-completed one IN ROUTE ORDER — an intermediate
 * cita that sorts before a later one becomes current ahead of it.
 */
async function computeCaseRouteEntries(
  actor: Actor,
  caseId: string,
  phaseId: string,
): Promise<CaseRouteEntry[]> {
  const [schedule, appts] = await Promise.all([
    getCaseEffectiveSchedule(caseId, phaseId),
    getCaseAppointments(actor, caseId),
  ]);

  // Index the LIVE booked instance of THIS phase by sequence_number. We exclude
  // `cancelled` and `rescheduled`: rescheduling inserts a fresh `scheduled` row
  // with the SAME sequence_number and marks the old one `rescheduled`, so the
  // stale row must not shadow the live one (the two would otherwise race on
  // starts_at order). What remains is scheduled | completed | no_show.
  const apptBySeq = new Map<number, AppointmentRow>();
  for (const a of appts) {
    if (
      a.service_phase_id === phaseId &&
      a.sequence_number != null &&
      a.status !== "cancelled" &&
      a.status !== "rescheduled"
    ) {
      apptBySeq.set(a.sequence_number, a);
    }
  }

  let currentAssigned = false;
  return schedule.map((entry) => {
    const appt = apptBySeq.get(entry.sequenceNumber) ?? null;
    // Only a completed cita advances the route. A `no_show` deliberately stays
    // "current": the slot isn't counted against the quota (see countPhaseAppointments
    // in bookAppointment), so the cita must be rebooked before the case moves on.
    const isCompleted = appt?.status === "completed";
    let status: CaseRouteEntry["status"];
    if (isCompleted) {
      status = "completed";
    } else if (!currentAssigned) {
      status = "current";
      currentAssigned = true;
    } else {
      status = "upcoming";
    }
    return { entry, appt, status };
  });
}

/**
 * The appointment route for a case's CURRENT phase: every planned cita (service
 * cronograma + per-case extras), which one the case is on, and each cita's
 * objectives (with outcome flags for completed ones). Powers the staff "Ruta de
 * citas" tab.
 *
 * The "Cita N" the user sees is the 1-based ROUTE position (index), not the raw
 * sequence_number — so an intermediate cita renumbers the ones after it.
 *
 * Client: requireCaseAccess. Staff: cases.view (via requireCaseAccess).
 *
 * @api-id API-SCH-18
 */
export async function getCaseRuta(
  actor: Actor,
  caseId: string,
): Promise<CaseRutaResult> {
  await requireCaseAccess(actor, caseId);

  const cases = await getCasesModule();
  const c = await cases.getCaseCore(caseId);
  if (!c || !c.currentPhaseId) {
    return { phaseId: null, phaseLabelI18n: null, total: 0, currentSequence: null, citas: [] };
  }
  const phaseId = c.currentPhaseId;

  const supabase = createServiceClient();
  const [routeEntries, phaseRes] = await Promise.all([
    computeCaseRouteEntries(actor, caseId, phaseId),
    supabase.from("service_phases").select("label_i18n").eq("id", phaseId).maybeSingle(),
  ]);

  let currentSequence: number | null = null;
  const citas: RutaCita[] = routeEntries.map(({ entry, appt, status }, idx) => {
    if (status === "current") currentSequence = entry.sequenceNumber;

    // Objectives: template (i18n) is the base; completed citas overlay the
    // snapshotted outcome flags (matched by id). Outcome-only objectives (removed
    // from the template after completion) are appended so nothing is lost.
    const isCompleted = status === "completed";
    const outcome = appt ? resolveObjectivesOutcome(appt.objectives_outcome) : [];
    const outcomeById = new Map(outcome.map((o) => [o.id, o]));
    const templateIds = new Set(entry.objectives.map((t) => t.id));
    const objectives: RutaCitaObjective[] = entry.objectives.map((t) => ({
      id: t.id,
      text: t.text,
      achieved: isCompleted ? (outcomeById.get(t.id)?.achieved ?? false) : null,
    }));
    if (isCompleted) {
      for (const o of outcome) {
        if (!templateIds.has(o.id)) {
          objectives.push({ id: o.id, text: { es: o.text, en: o.text }, achieved: o.achieved });
        }
      }
    }

    return {
      number: idx + 1,
      sequenceNumber: entry.sequenceNumber,
      labelI18n: entry.labelI18n,
      kind: entry.kind,
      weekOffset: entry.weekOffset,
      origin: entry.origin ?? "service",
      status,
      objectives,
      appointment: appt
        ? {
            id: appt.id,
            startsAt: appt.starts_at,
            status: appt.status,
            videoLink: appt.video_link,
          }
        : null,
    };
  });

  return {
    phaseId,
    phaseLabelI18n: (phaseRes.data?.label_i18n as I18nText | null) ?? null,
    total: citas.length,
    currentSequence,
    citas,
  };
}

const AddCaseAppointmentInputSchema = z.object({
  caseId: zUuidLax,
  labelI18n: z
    .object({ es: z.string(), en: z.string() })
    .nullable()
    .optional(),
  objectives: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        text: z.object({ es: z.string(), en: z.string() }),
      }),
    )
    .default([]),
  kind: z.enum(["video", "phone", "presencial"]).optional(),
  durationMinutes: z.number().int().positive().optional(),
});

export type AddCaseAppointmentInput = z.input<typeof AddCaseAppointmentInputSchema>;

export interface AddCaseAppointmentResult {
  id: string;
  sequenceNumber: number;
}

/**
 * Adds an INTERMEDIATE cita to a single case's current phase (e.g. a follow-up
 * when the previous cita's objectives were not all met). The new cita carries
 * its own label + objectives, raises the case's effective appointment count, and
 * appears in both the staff "Ruta de citas" and the client's "Mi proceso"
 * cronograma. The date/time is booked later with the normal "Nueva cita" flow.
 *
 * Staff only: can('calendar','edit').
 *
 * @api-id API-SCH-19
 */
export async function addCaseAppointment(
  actor: Actor,
  input: AddCaseAppointmentInput,
): Promise<AddCaseAppointmentResult> {
  can(actor, "calendar", "edit");
  const p = AddCaseAppointmentInputSchema.parse(input);
  await requireCaseAccess(actor, p.caseId);

  const cases = await getCasesModule();
  const c = await cases.getCaseCore(p.caseId);
  if (!c || c.status !== "active" || !c.currentPhaseId) {
    throw new SchedulingError("CASE_NOT_ACTIVE");
  }
  const phaseId = c.currentPhaseId;

  // Build the ordered route with statuses to find the ANCHOR cita the new one
  // follows. An intermediate is inserted right after the cita whose objectives
  // weren't met = the last COMPLETED cita (falls back to the first cita, or a
  // fresh "Cita 1" when the phase has no cronograma yet).
  const routeEntries = await computeCaseRouteEntries(actor, p.caseId, phaseId);
  let anchorIdx = -1;
  routeEntries.forEach((r, i) => {
    if (r.status === "completed") anchorIdx = i;
  });
  if (anchorIdx < 0 && routeEntries.length > 0) anchorIdx = 0;
  const anchor = anchorIdx >= 0 ? routeEntries[anchorIdx].entry : null;

  const schedule = routeEntries.map((r) => r.entry);
  // sequence_number is unique per (case, phase): max over the route AND any booked
  // instances so we never collide with an agendada cita. It stays IMMUTABLE (the
  // display number is the route index), so booked instances keep their link.
  const seqNumbers = await repo.getPhaseSequenceNumbers(p.caseId, phaseId);
  const sequenceNumber =
    Math.max(0, ...schedule.map((e) => e.sequenceNumber), ...seqNumbers.map((s) => s ?? 0)) + 1;

  // Place the new cita immediately AFTER the anchor: same (weekOffset, position)
  // as the anchor + a higher sequence_number. The route sort (weekOffset, position,
  // sequenceNumber) then lands it right after the anchor and before the next cita
  // (higher position/weekOffset), so the rest renumber by index ("2nd becomes 3rd").
  const last = anchor; // duration/kind defaults inherited from the anchor cita
  const weekOffset = anchor ? anchor.weekOffset : 1;
  const position = anchor ? (anchor.position ?? anchor.sequenceNumber) : 0;

  // Objectives: ensure each has a stable id (generate for new ones).
  const objectives: ObjectiveTemplate[] = p.objectives.map((o) => ({
    id: o.id ?? crypto.randomUUID(),
    text: o.text,
  }));

  const id = await repo.insertCaseAppointmentScheduleRow({
    caseId: p.caseId,
    servicePhaseId: phaseId,
    sequenceNumber,
    durationMinutes: p.durationMinutes ?? last?.durationMinutes ?? 30,
    kind: p.kind ?? last?.kind ?? "video",
    weekOffset,
    position,
    labelI18n: p.labelI18n ?? null,
    objectivesI18n: objectives.length > 0 ? objectives : null,
    createdBy: actor.userId,
  });

  await writeAudit(actor, "scheduling.case_appointment.added", "case_appointment_schedule", id, {
    after: { case_id: p.caseId, service_phase_id: phaseId, sequence_number: sequenceNumber },
  });

  return { id, sequenceNumber };
}

/** Per-case extra cita for the client cronograma merge (cases.getCaseTimeline). */
export interface CaseRouteExtra {
  phaseId: string;
  phaseLabelI18n: I18nText | null;
  sequenceNumber: number;
  durationMinutes: number;
  kind: string;
  weekOffset: number;
  labelI18n: I18nText | null;
}

/**
 * Per-case extra citas (every phase) enriched with their phase label, for the
 * client-facing cronograma. No actor: called server-side by cases.getCaseTimeline
 * AFTER it has run requireCaseAccess (established internal-read pattern, like
 * getCaseCore). Returns [] when the table is empty or absent (clean degradation).
 */
export async function getCaseRouteExtras(caseId: string): Promise<CaseRouteExtra[]> {
  const extras = await repo.getCaseAppointmentScheduleAll(caseId);
  if (extras.length === 0) return [];

  const phaseIds = [...new Set(extras.map((e) => e.servicePhaseId))];
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("service_phases")
    .select("id, label_i18n")
    .in("id", phaseIds);
  const labelByPhase = new Map<string, I18nText | null>();
  for (const r of data ?? []) {
    labelByPhase.set(r.id, (r.label_i18n as I18nText | null) ?? null);
  }

  return extras.map((e) => ({
    phaseId: e.servicePhaseId,
    phaseLabelI18n: labelByPhase.get(e.servicePhaseId) ?? null,
    sequenceNumber: e.sequenceNumber,
    durationMinutes: e.durationMinutes,
    kind: e.kind,
    weekOffset: e.weekOffset,
    labelI18n: e.labelI18n,
  }));
}

// ---------------------------------------------------------------------------
// Advisor name for client-facing cita screen — API-SCH-17
// ---------------------------------------------------------------------------

export interface AppointmentAdvisorResult {
  displayName: string;
  avatarUrl: string | null;
  /** The attending staff member's IANA timezone (office TZ for the dual hour). */
  timezone: string;
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

  // Office TZ for the dual hour = the attending staff member's timezone.
  const timezone = await getUserTimezone(a.staff_id);

  return {
    displayName: data.display_name,
    avatarUrl: data.avatar_url,
    timezone,
  };
}
