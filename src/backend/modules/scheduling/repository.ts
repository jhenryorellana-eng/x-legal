/**
 * Scheduling module — repository (data-access layer).
 *
 * Single point of contact with Supabase for the scheduling module.
 * Uses createServiceClient for mutations (transactions, event handlers)
 * and createServerClient for actor-scoped reads.
 *
 * Cross-module reads: accesses cases / catalog / leads ONLY via their index.ts.
 *
 * @module scheduling/repository
 */

import { createServiceClient } from "@/backend/platform/supabase";
import { logger } from "@/backend/platform/logger";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/database.types";
import type {
  AvailabilityRule,
  SchedulingSettings,
  PhasePolicy,
  CaseOverride,
} from "./domain";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type AppointmentRow = Tables<"appointments">;
export type AvailabilityRuleRow = Tables<"availability_rules">;
export type AvailabilityExceptionRow = Tables<"availability_exceptions">;
export type StaffSchedulingSettingsRow = Tables<"staff_scheduling_settings">;
export type PhasePolicyRow = Tables<"phase_appointment_policies">;
export type CaseOverrideRow = Tables<"case_overrides">;

// ---------------------------------------------------------------------------
// Default scheduling settings (DOC-30 §7, DOC-43 §4)
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: SchedulingSettings = {
  minNoticeHours: 24,
  maxAdvanceDays: 30,
  bufferMinutes: 0,
  cancellationWindowHours: 24,
  rebookingPenaltyDays: 7,
};

function rowToSettings(row: StaffSchedulingSettingsRow): SchedulingSettings {
  return {
    minNoticeHours: row.min_notice_hours,
    maxAdvanceDays: row.max_advance_days,
    bufferMinutes: row.buffer_minutes,
    cancellationWindowHours: row.cancellation_window_hours,
    rebookingPenaltyDays: row.rebooking_penalty_days,
  };
}

function rowToRule(row: AvailabilityRuleRow): AvailabilityRule {
  return {
    weekday: row.weekday,
    startLocal: row.start_local,
    endLocal: row.end_local,
    timezone: row.timezone,
    isActive: row.is_active,
  };
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

/** Returns a single appointment by ID; null if not found or SQLSTATE error. */
export async function findById(id: string): Promise<AppointmentRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, appointmentId: id }, "scheduling.repo: findById error");
    return null;
  }
  return data;
}

export interface InsertAppointmentInput {
  caseId: string | null;
  leadId: string | null;
  servicePhaseId: string | null;
  staffId: string;
  clientUserId: string | null;
  startsAt: Date;
  endsAt: Date;
  kind: string;
  status: string;
  sequenceNumber: number | null;
  reminder1d: boolean;
  reminder1h: boolean;
  notes: string | null;
  cancelledReason?: string | null;
  livekitRoomId?: string | null;
}

/**
 * Inserts an appointment row.
 * Translates SQLSTATE 23P01 (exclusion violation = SLOT_TAKEN) for the service layer.
 * Throws with code 'SLOT_TAKEN_DB' when the EXCLUDE constraint fires.
 */
export async function insertAppointment(
  input: InsertAppointmentInput,
): Promise<AppointmentRow> {
  const supabase = createServiceClient();
  const row: TablesInsert<"appointments"> = {
    case_id: input.caseId,
    lead_id: input.leadId,
    service_phase_id: input.servicePhaseId,
    staff_id: input.staffId,
    client_user_id: input.clientUserId,
    starts_at: input.startsAt.toISOString(),
    ends_at: input.endsAt.toISOString(),
    kind: input.kind,
    status: input.status,
    sequence_number: input.sequenceNumber,
    reminder_1d: input.reminder1d,
    reminder_1h: input.reminder1h,
    notes: input.notes,
    cancelled_reason: input.cancelledReason ?? null,
    livekit_room_id: input.livekitRoomId ?? null,
  };

  const { data, error } = await supabase
    .from("appointments")
    .insert(row)
    .select()
    .single();

  if (error) {
    // SQLSTATE 23P01 = exclusion violation → SLOT_TAKEN
    // Supabase surfaces this as code "23P01" or "exclusion_violation"
    const isExclusion =
      (error as { code?: string }).code === "23P01" ||
      (error.message ?? "").toLowerCase().includes("exclusion");

    if (isExclusion) {
      const err = new Error("SLOT_TAKEN");
      (err as { code?: string }).code = "SLOT_TAKEN_DB";
      throw err;
    }
    logger.error({ err: error }, "scheduling.repo: insertAppointment error");
    throw error;
  }

  return data;
}

export interface UpdateAppointmentInput {
  status?: string;
  notes?: string | null;
  cancelledReason?: string | null;
  livekitRoomId?: string | null;
  reminder1dSentAt?: string | null;
  reminder1hSentAt?: string | null;
}

export async function updateAppointment(
  id: string,
  patch: UpdateAppointmentInput,
): Promise<void> {
  const supabase = createServiceClient();
  const update: TablesUpdate<"appointments"> = {};
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.cancelledReason !== undefined)
    update.cancelled_reason = patch.cancelledReason;
  if (patch.livekitRoomId !== undefined)
    update.livekit_room_id = patch.livekitRoomId;
  if (patch.reminder1dSentAt !== undefined)
    update.reminder_1d_sent_at = patch.reminder1dSentAt;
  if (patch.reminder1hSentAt !== undefined)
    update.reminder_1h_sent_at = patch.reminder1hSentAt;

  const { error } = await supabase
    .from("appointments")
    .update(update)
    .eq("id", id);

  if (error) {
    logger.error({ err: error, appointmentId: id }, "scheduling.repo: updateAppointment error");
    throw error;
  }
}

/** Finds all staff appointments in [fromUtc, toUtc) with given statuses. */
export async function findStaffAppointmentsInRange(
  staffId: string,
  fromUtc: Date,
  toUtc: Date,
  statuses: string[],
): Promise<AppointmentRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("staff_id", staffId)
    .gte("starts_at", fromUtc.toISOString())
    .lt("starts_at", toUtc.toISOString())
    .in("status", statuses)
    .order("starts_at");

  if (error) {
    logger.error({ err: error }, "scheduling.repo: findStaffAppointmentsInRange error");
    return [];
  }
  return data ?? [];
}

/**
 * Finds booked (status='scheduled') appointments that OVERLAP the given range.
 * Includes citas that START before toUtc and END after fromUtc (border-crossing).
 * This is the correct input for materializeSlots (DOC-43 §4).
 */
export async function findBookedForMaterialization(
  staffId: string,
  fromUtc: Date,
  toUtc: Date,
): Promise<Array<{ startsAt: Date; endsAt: Date }>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("appointments")
    .select("starts_at, ends_at")
    .eq("staff_id", staffId)
    .eq("status", "scheduled")
    .lt("starts_at", toUtc.toISOString())
    .gt("ends_at", fromUtc.toISOString());

  if (error) {
    logger.error({ err: error }, "scheduling.repo: findBookedForMaterialization error");
    return [];
  }
  return (data ?? []).map((r) => ({
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
  }));
}

/** Count appointments for a case/phase with given statuses. */
export async function countPhaseAppointments(
  caseId: string,
  phaseId: string,
  statuses: string[],
): Promise<number> {
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("appointments")
    .select("*", { count: "exact", head: true })
    .eq("case_id", caseId)
    .eq("service_phase_id", phaseId)
    .in("status", statuses);

  if (error) {
    logger.error({ err: error }, "scheduling.repo: countPhaseAppointments error");
    return 0;
  }
  return count ?? 0;
}

/** Returns non-cancelled sequence_numbers for a case/phase (for nextSequenceNumber). */
export async function getPhaseSequenceNumbers(
  caseId: string,
  phaseId: string,
): Promise<Array<number | null>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("appointments")
    .select("sequence_number")
    .eq("case_id", caseId)
    .eq("service_phase_id", phaseId)
    .neq("status", "cancelled");

  if (error) {
    logger.error({ err: error }, "scheduling.repo: getPhaseSequenceNumbers error");
    return [];
  }
  return (data ?? []).map((r) => r.sequence_number);
}

/** Summary for cases module phase progress (DOC-41 §3.5). */
export async function getPhaseAppointmentsSummary(
  caseId: string,
  phaseId: string,
): Promise<{ expected: number; completed: number }> {
  const [policy, override, completedCount] = await Promise.all([
    getPhasePolicy(phaseId),
    getCaseOverride(caseId, phaseId),
    countPhaseAppointments(caseId, phaseId, ["completed"]),
  ]);

  const { appointmentCount } = effectivePolicy(policy, override);
  return { expected: appointmentCount, completed: completedCount };
}

function effectivePolicy(
  policy: PhasePolicy | null,
  override: CaseOverride | null,
): PhasePolicy {
  const base: PhasePolicy = policy ?? {
    appointmentCount: 1,
    durationMinutes: 30,
    kind: "video",
  };
  return {
    appointmentCount: override?.appointmentCount ?? base.appointmentCount,
    durationMinutes: override?.durationMinutes ?? base.durationMinutes,
    kind: base.kind,
  };
}

// ---------------------------------------------------------------------------
// Reminder queries (contract with jobs/appointment-reminders, DOC-43 §6)
// ---------------------------------------------------------------------------

export interface ReminderRow {
  id: string;
  caseId: string | null;
  leadId: string | null;
  staffId: string;
  clientUserId: string | null;
  startsAt: Date;
  kind: string;
}

/** Finds appointments due for a reminder of the given kind within the window. */
export async function findDueReminders(
  kind: "1d" | "1h",
  windowStartUtc: Date,
  windowEndUtc: Date,
): Promise<ReminderRow[]> {
  const supabase = createServiceClient();
  const sentAtCol =
    kind === "1d" ? "reminder_1d_sent_at" : "reminder_1h_sent_at";
  const flagCol = kind === "1d" ? "reminder_1d" : "reminder_1h";

  const { data, error } = await supabase
    .from("appointments")
    .select(
      "id, case_id, lead_id, staff_id, client_user_id, starts_at, kind",
    )
    .eq("status", "scheduled")
    .eq(flagCol, true)
    .is(sentAtCol, null)
    .gt("starts_at", windowStartUtc.toISOString())
    .lte("starts_at", windowEndUtc.toISOString());

  if (error) {
    logger.error({ err: error }, "scheduling.repo: findDueReminders error");
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    caseId: r.case_id,
    leadId: r.lead_id,
    staffId: r.staff_id,
    clientUserId: r.client_user_id,
    startsAt: new Date(r.starts_at),
    kind: r.kind,
  }));
}

/**
 * Marks a reminder as sent — idempotent (UPDATE WHERE sent_at IS NULL).
 * Returns true if the update affected a row (i.e. not already sent).
 */
export async function markReminderSent(
  appointmentId: string,
  kind: "1d" | "1h",
): Promise<boolean> {
  const supabase = createServiceClient();
  const nowIso = new Date().toISOString();

  // Use explicit branches to keep strict Supabase column typing intact.
  // A computed-key object { [col]: value } widens to { [string]: string } which
  // the Supabase TS client rejects because the update type forbids index signatures.
  const { data, error } =
    kind === "1d"
      ? await supabase
          .from("appointments")
          .update({ reminder_1d_sent_at: nowIso })
          .eq("id", appointmentId)
          .is("reminder_1d_sent_at", null)
          .select("id")
      : await supabase
          .from("appointments")
          .update({ reminder_1h_sent_at: nowIso })
          .eq("id", appointmentId)
          .is("reminder_1h_sent_at", null)
          .select("id");

  if (error) {
    logger.error({ err: error, appointmentId }, "scheduling.repo: markReminderSent error");
    return false;
  }
  return (data?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Availability rules
// ---------------------------------------------------------------------------

/** Returns all active rules for a staff member, ordered by weekday. */
export async function getActiveRules(staffId: string): Promise<AvailabilityRule[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("availability_rules")
    .select("*")
    .eq("staff_id", staffId)
    .eq("is_active", true)
    .order("weekday")
    .order("start_local");

  if (error) {
    logger.error({ err: error }, "scheduling.repo: getActiveRules error");
    return [];
  }
  return (data ?? []).map(rowToRule);
}

/** Returns ALL rules for a staff member (active and inactive). */
export async function getAllRules(staffId: string): Promise<AvailabilityRuleRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("availability_rules")
    .select("*")
    .eq("staff_id", staffId)
    .order("weekday")
    .order("start_local");

  if (error) {
    logger.error({ err: error }, "scheduling.repo: getAllRules error");
    return [];
  }
  return data ?? [];
}

export interface RuleInput {
  weekday: number;
  startLocal: string;
  endLocal: string;
  timezone: string;
  isActive: boolean;
}

/**
 * Replaces all availability rules for a staff member in a single transaction
 * (delete old → insert new). RF-VAN-032 step 5.
 */
export async function replaceRules(
  staffId: string,
  rules: RuleInput[],
): Promise<void> {
  const supabase = createServiceClient();

  // Delete existing rules
  const { error: delErr } = await supabase
    .from("availability_rules")
    .delete()
    .eq("staff_id", staffId);

  if (delErr) {
    logger.error({ err: delErr }, "scheduling.repo: replaceRules delete error");
    throw delErr;
  }

  if (rules.length === 0) return;

  // Insert new rules
  const rows: TablesInsert<"availability_rules">[] = rules.map((r) => ({
    staff_id: staffId,
    weekday: r.weekday,
    start_local: r.startLocal,
    end_local: r.endLocal,
    timezone: r.timezone,
    is_active: r.isActive,
  }));

  const { error: insErr } = await supabase
    .from("availability_rules")
    .insert(rows);

  if (insErr) {
    logger.error({ err: insErr }, "scheduling.repo: replaceRules insert error");
    throw insErr;
  }
}

/**
 * Rewrites all rules for a staff member with a new timezone snapshot,
 * keeping the same start_local/end_local wall times. (DOC-23 §7.1 migration)
 */
export async function rewriteRulesTimezone(
  staffId: string,
  newTimezone: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("availability_rules")
    .update({ timezone: newTimezone })
    .eq("staff_id", staffId);

  if (error) {
    logger.error({ err: error }, "scheduling.repo: rewriteRulesTimezone error");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Availability exceptions
// ---------------------------------------------------------------------------

/** Finds exceptions that overlap the given UTC range (for materialization). */
export async function getExceptionsInRange(
  staffId: string,
  fromUtc: Date,
  toUtc: Date,
): Promise<Array<{ startsAt: Date; endsAt: Date }>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("availability_exceptions")
    .select("starts_at, ends_at")
    .eq("staff_id", staffId)
    .lt("starts_at", toUtc.toISOString())
    .gt("ends_at", fromUtc.toISOString());

  if (error) {
    logger.error({ err: error }, "scheduling.repo: getExceptionsInRange error");
    return [];
  }
  return (data ?? []).map((r) => ({
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
  }));
}

export interface InsertExceptionInput {
  staffId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
}

export async function insertException(
  input: InsertExceptionInput,
): Promise<AvailabilityExceptionRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("availability_exceptions")
    .insert({
      staff_id: input.staffId,
      starts_at: input.startsAt.toISOString(),
      ends_at: input.endsAt.toISOString(),
      reason: input.reason,
    })
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, "scheduling.repo: insertException error");
    throw error;
  }
  return data;
}

export async function deleteException(exceptionId: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("availability_exceptions")
    .delete()
    .eq("id", exceptionId);

  if (error) {
    logger.error({ err: error }, "scheduling.repo: deleteException error");
    throw error;
  }
}

/**
 * Lists upcoming exceptions (full rows) for the availability editor — anything
 * that has not fully elapsed yet (ends in the future). Ordered by start.
 */
export async function listExceptions(
  staffId: string,
  fromUtc: Date,
): Promise<AvailabilityExceptionRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("availability_exceptions")
    .select("*")
    .eq("staff_id", staffId)
    .gt("ends_at", fromUtc.toISOString())
    .order("starts_at");

  if (error) {
    logger.error({ err: error }, "scheduling.repo: listExceptions error");
    return [];
  }
  return data ?? [];
}

/** Finds scheduled appointments that overlap the given range (exception check). */
export async function findScheduledInRange(
  staffId: string,
  fromUtc: Date,
  toUtc: Date,
): Promise<AppointmentRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("staff_id", staffId)
    .eq("status", "scheduled")
    .lt("starts_at", toUtc.toISOString())
    .gt("ends_at", fromUtc.toISOString());

  if (error) {
    logger.error({ err: error }, "scheduling.repo: findScheduledInRange error");
    return [];
  }
  return data ?? [];
}

/**
 * Finds future scheduled appointments that fall outside the new availability rules.
 * Used by saveAvailabilityRules to surface orphaned appointments. (RF-VAN-032 A3)
 * Simplified: returns all future scheduled appointments for the staff member —
 * the service layer compares them against the new rules.
 */
export async function findScheduledOutsideRules(
  staffId: string,
  afterUtc: Date,
): Promise<AppointmentRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("staff_id", staffId)
    .eq("status", "scheduled")
    .gt("starts_at", afterUtc.toISOString())
    .order("starts_at");

  if (error) {
    logger.error({ err: error }, "scheduling.repo: findScheduledOutsideRules error");
    return [];
  }
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Staff scheduling settings
// ---------------------------------------------------------------------------

/** Returns the scheduling settings for a staff member, or defaults if no row exists. */
export async function getSettings(staffId: string): Promise<SchedulingSettings> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("staff_scheduling_settings")
    .select("*")
    .eq("staff_id", staffId)
    .maybeSingle();

  if (!data) return DEFAULT_SETTINGS;
  return rowToSettings(data);
}

export interface SettingsPatch {
  minNoticeHours?: number;
  maxAdvanceDays?: number;
  bufferMinutes?: number;
  cancellationWindowHours?: number;
  rebookingPenaltyDays?: number;
}

export async function upsertSettings(
  staffId: string,
  patch: SettingsPatch,
): Promise<void> {
  const supabase = createServiceClient();
  const update: TablesInsert<"staff_scheduling_settings"> = {
    staff_id: staffId,
    min_notice_hours: patch.minNoticeHours ?? DEFAULT_SETTINGS.minNoticeHours,
    max_advance_days: patch.maxAdvanceDays ?? DEFAULT_SETTINGS.maxAdvanceDays,
    buffer_minutes: patch.bufferMinutes ?? DEFAULT_SETTINGS.bufferMinutes,
    cancellation_window_hours:
      patch.cancellationWindowHours ?? DEFAULT_SETTINGS.cancellationWindowHours,
    rebooking_penalty_days:
      patch.rebookingPenaltyDays ?? DEFAULT_SETTINGS.rebookingPenaltyDays,
  };

  const { error } = await supabase
    .from("staff_scheduling_settings")
    .upsert(update, { onConflict: "staff_id" });

  if (error) {
    logger.error({ err: error }, "scheduling.repo: upsertSettings error");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Phase appointment policies
// ---------------------------------------------------------------------------

/** Returns the phase appointment policy; null if not set (caller uses defaults). */
export async function getPhasePolicy(
  servicePhaseId: string,
): Promise<PhasePolicy | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("phase_appointment_policies")
    .select("*")
    .eq("service_phase_id", servicePhaseId)
    .maybeSingle();

  if (!data) return null;
  return {
    appointmentCount: data.appointment_count,
    durationMinutes: data.duration_minutes,
    kind: data.kind as "video" | "phone" | "presencial",
  };
}

export interface PhasePolicyPatch {
  appointmentCount: number;
  durationMinutes: number;
  kind: string;
  updatedBy: string;
}

export async function upsertPhasePolicy(
  servicePhaseId: string,
  patch: PhasePolicyPatch,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("phase_appointment_policies").upsert(
    {
      service_phase_id: servicePhaseId,
      appointment_count: patch.appointmentCount,
      duration_minutes: patch.durationMinutes,
      kind: patch.kind,
      updated_by: patch.updatedBy,
    },
    { onConflict: "service_phase_id" },
  );

  if (error) {
    logger.error({ err: error }, "scheduling.repo: upsertPhasePolicy error");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Case overrides
// ---------------------------------------------------------------------------

/** Returns the case override for a specific case/phase pair; null if not set. */
export async function getCaseOverride(
  caseId: string,
  servicePhaseId: string,
): Promise<CaseOverride | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("case_overrides")
    .select("appointment_count, duration_minutes")
    .eq("case_id", caseId)
    .eq("service_phase_id", servicePhaseId)
    .maybeSingle();

  if (!data) return null;
  return {
    appointmentCount: data.appointment_count,
    durationMinutes: data.duration_minutes,
  };
}

export interface CaseOverrideInput {
  caseId: string;
  servicePhaseId: string;
  appointmentCount: number | null;
  durationMinutes: number | null;
  setBy: string;
}

export async function upsertCaseOverride(input: CaseOverrideInput): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("case_overrides").upsert(
    {
      case_id: input.caseId,
      service_phase_id: input.servicePhaseId,
      appointment_count: input.appointmentCount,
      duration_minutes: input.durationMinutes,
      set_by: input.setBy,
    },
    { onConflict: "case_id,service_phase_id" },
  );

  if (error) {
    logger.error({ err: error }, "scheduling.repo: upsertCaseOverride error");
    throw error;
  }
}

export async function deleteCaseOverride(
  caseId: string,
  servicePhaseId: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("case_overrides")
    .delete()
    .eq("case_id", caseId)
    .eq("service_phase_id", servicePhaseId);

  if (error) {
    logger.error({ err: error }, "scheduling.repo: deleteCaseOverride error");
    throw error;
  }
}
