/**
 * Scheduling module — domain event types.
 *
 * Conventions: DOC-21 §3 (recurso.evento in past tense), DOC-43 §5.
 * Payloads are minimal (IDs + routing data; zero PII).
 * Consumers re-read the DB row for full data.
 *
 * Events defined here:
 *  - appointment.booked     (§3.2 and §3.6)
 *  - appointment.cancelled  (§3.3)
 *  - appointment.rescheduled (§3.4 — Propuesta SOT-1)
 *  - appointment.completed  (§3.5)
 *
 * @module scheduling/events
 */

import type { DomainEvent } from "@/backend/platform/events";

// ---------------------------------------------------------------------------
// appointment.booked
// ---------------------------------------------------------------------------

export interface AppointmentBookedPayload {
  appointmentId: string;
  caseId: string | null;
  leadId: string | null;
  servicePhaseId: string | null;
  staffId: string;
  clientUserId: string | null;
  startsAt: Date;
  kind: string;
  sequenceNumber: number | null;
  bookedBy: "client" | "staff";
}

export type AppointmentBookedEvent = DomainEvent<AppointmentBookedPayload>;

// ---------------------------------------------------------------------------
// appointment.cancelled
// ---------------------------------------------------------------------------

export interface AppointmentCancelledPayload {
  appointmentId: string;
  caseId: string | null;
  leadId: string | null;
  staffId: string;
  clientUserId: string | null;
  startsAt: Date;
  cancelledBy: "client" | "staff";
  /** True when the client cancelled within the penalty window. */
  late: boolean;
  reason: string;
}

export type AppointmentCancelledEvent = DomainEvent<AppointmentCancelledPayload>;

// ---------------------------------------------------------------------------
// appointment.rescheduled (Propuesta SOT-1 — DOC-43 §5)
// ---------------------------------------------------------------------------

export interface AppointmentRescheduledPayload {
  oldAppointmentId: string;
  newAppointmentId: string;
  caseId: string | null;
  leadId: string | null;
  staffId: string;
  clientUserId: string | null;
  oldStartsAt: Date;
  newStartsAt: Date;
  rescheduledBy: "client" | "staff";
}

export type AppointmentRescheduledEvent =
  DomainEvent<AppointmentRescheduledPayload>;

// ---------------------------------------------------------------------------
// appointment.completed
// ---------------------------------------------------------------------------

export interface AppointmentCompletedPayload {
  appointmentId: string;
  caseId: string | null;
  leadId: string | null;
  servicePhaseId: string | null;
  staffId: string;
  sequenceNumber: number | null;
}

export type AppointmentCompletedEvent = DomainEvent<AppointmentCompletedPayload>;

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type SchedulingEvent =
  | AppointmentBookedEvent
  | AppointmentCancelledEvent
  | AppointmentRescheduledEvent
  | AppointmentCompletedEvent;
