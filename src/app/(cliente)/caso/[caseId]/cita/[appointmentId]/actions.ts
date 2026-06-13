"use server";

/**
 * Scheduling server actions for the client — Cita confirmada
 * (DOC-51 §19, API-SCH-03/04).
 *
 * Thin "use server" wrappers over the scheduling module-pub use cases. The
 * confirmed-appointment screen calls `cancelAppointmentAction` (after the
 * confirmation dialog that RECUERDA the 7-day penalty) and
 * `rescheduleAppointmentAction` (only outside the cancellation window — the
 * domain enforces OUTSIDE_WINDOW otherwise).
 *
 * Boundary R1/R2: app → module-pub (scheduling/identity index) only.
 */

import { requireActor } from "@/backend/modules/identity";
import {
  cancelAppointment,
  rescheduleAppointment,
  SchedulingError,
} from "@/backend/modules/scheduling";

export interface CancelAppointmentActionResult {
  ok: boolean;
  error?: { code: string };
}

/**
 * Cancels a scheduled appointment. Late cancellation (<24h) applies the rebooking
 * penalty in the domain; the Citas tab then renders the 7-day block.
 *
 * @api-id API-SCH-03
 */
export async function cancelAppointmentAction(input: {
  appointmentId: string;
  reason: string;
}): Promise<CancelAppointmentActionResult> {
  try {
    const actor = await requireActor();
    await cancelAppointment(actor, {
      appointmentId: input.appointmentId,
      reason: input.reason,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export interface RescheduleAppointmentActionResult {
  ok: boolean;
  appointmentId?: string;
  error?: { code: string };
}

/**
 * Reschedules an appointment to a new UTC instant (old → rescheduled + new →
 * scheduled, inheriting the sequence number so it does NOT consume quota). The
 * client may only reschedule outside the cancellation window.
 *
 * @api-id API-SCH-04
 */
export async function rescheduleAppointmentAction(input: {
  appointmentId: string;
  newStartsAtUtc: string;
  reminder1d?: boolean;
  reminder1h?: boolean;
}): Promise<RescheduleAppointmentActionResult> {
  try {
    const actor = await requireActor();
    const fresh = await rescheduleAppointment(actor, {
      appointmentId: input.appointmentId,
      newStartsAtUtc: new Date(input.newStartsAtUtc),
      reminder1d: input.reminder1d,
      reminder1h: input.reminder1h,
    });
    return { ok: true, appointmentId: fresh.id };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

function toError(err: unknown): { code: string } {
  if (err instanceof SchedulingError) return { code: err.code };
  return { code: "UNEXPECTED" };
}
