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
  getProspectSlots,
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
  getAvailabilityConfig,
  saveAvailabilityRules,
  addAvailabilityException,
  removeAvailabilityException,
  updateSchedulingSettings,
  migrateAvailabilityTimezone,
  listOrgNonWorkingDays, // → cases SLA engine + new-case wizard (deadline-anchored SLAs)
  getAppointmentForClient,
  getCaseAppointments,
  getAppointmentAdvisor,
  // Case appointment route ("ruta de citas")
  getCaseRuta,
  addCaseAppointment,
  getCaseRouteExtras,
  // Error class
  SchedulingError,
} from "./service";

// Types needed by UI / route handlers
export type {
  GetSlotsInput,
  GetSlotsResult,
  GetProspectSlotsInput,
  GetProspectSlotsResult,
  BookAppointmentInput,
  BookAppointmentResult,
  RescheduleInput,
  ProspectAppointmentInput,
  WeekAgendaResult,
  AgendaAppointment,
  AvailabilityConfigResult,
  SaveRulesInput,
  ExceptionInput,
  SettingsInput,
  PhasePolicyInput,
  CaseOverrideInput,
  BookingWarning,
  AppointmentAdvisorResult,
  // Case appointment route
  CaseRutaResult,
  RutaCita,
  RutaCitaObjective,
  AddCaseAppointmentInput,
  AddCaseAppointmentResult,
  CaseRouteExtra,
} from "./service";

// Repository functions consumed by other modules via index.ts (DOC-43 §8)
export {
  getPhaseAppointmentsSummary, // → cases (phase progress, DOC-41 §3.5)
  findDueReminders,            // → jobs/appointment-reminders (DOC-26 §2.7)
  markReminderSent,            // → jobs/appointment-reminders (DOC-26 §2.7)
  getOfficeTimezone,           // → cases SLA engine (civil dates in the office TZ)
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
  ObjectiveTemplate,
  ObjectiveOutcome,
} from "./domain";

// Event types
export type {
  AppointmentBookedEvent,
  AppointmentCancelledEvent,
  AppointmentRescheduledEvent,
  AppointmentCompletedEvent,
  AppointmentNoShowEvent,
  SchedulingEvent,
} from "./events";
