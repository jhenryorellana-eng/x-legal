/**
 * Scheduling module — public API (module-pub boundary).
 *
 * Other modules MUST import from here, never from service.ts / repository.ts directly.
 * Rule R3: no cross-module imports except via index.ts.
 *
 * DOC-43 §8 (index.ts section).
 */

// Use cases
export {
  getAvailableSlots,
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
  completeAppointment,
  markNoShow,
  createProspectAppointment,
  getWeekAgenda,
  liftRebookingBlock,
  upsertPhasePolicy,
  setCaseOverride,
  saveAvailabilityRules,
  addAvailabilityException,
  removeAvailabilityException,
  updateSchedulingSettings,
  migrateAvailabilityTimezone,
  getAppointmentForClient,
  getCaseAppointments,
  getAppointmentAdvisor,
  // Error class
  SchedulingError,
} from "./service";

// Types needed by UI / route handlers
export type {
  GetSlotsInput,
  GetSlotsResult,
  BookAppointmentInput,
  BookAppointmentResult,
  RescheduleInput,
  ProspectAppointmentInput,
  WeekAgendaResult,
  AgendaAppointment,
  SaveRulesInput,
  ExceptionInput,
  SettingsInput,
  PhasePolicyInput,
  CaseOverrideInput,
  BookingWarning,
  AppointmentAdvisorResult,
} from "./service";

// Repository functions consumed by other modules via index.ts (DOC-43 §8)
export {
  getPhaseAppointmentsSummary, // → cases (phase progress, DOC-41 §3.5)
  findDueReminders,            // → jobs/appointment-reminders (DOC-26 §2.7)
  markReminderSent,            // → jobs/appointment-reminders (DOC-26 §2.7)
} from "./repository";

// Repository row types
export type {
  AppointmentRow,
  ReminderRow,
} from "./repository";

// Domain types consumed by other modules
export type {
  Slot,
  PhasePolicy,
  AppointmentStatus,
  SchedulingSettings,
} from "./domain";

// Event types
export type {
  AppointmentBookedEvent,
  AppointmentCancelledEvent,
  AppointmentRescheduledEvent,
  AppointmentCompletedEvent,
  SchedulingEvent,
} from "./events";
