"use server";

/**
 * Scheduling server actions for the client — Agendar (DOC-51 §18, API-SCH-01/02).
 *
 * Thin "use server" wrappers over the scheduling module-pub use cases. The
 * Agendar screen calls `getSlotsAction` when it navigates the calendar and
 * `bookAppointmentAction` to confirm. Slots are returned as UTC ISO strings; the
 * client renders the dual hour (its own TZ big + the staff TZ small) with the
 * date-fns-tz helper — the offset is NEVER computed here (DOC-23 §6.4).
 *
 * Boundary R1/R2: app → module-pub (scheduling/identity index) only. We never
 * import repository/platform from the app layer.
 */

import { requireActor } from "@/backend/modules/identity";
import {
  getAvailableSlots,
  bookAppointment,
  SchedulingError,
} from "@/backend/modules/scheduling";

/** A materialised slot as wire-friendly UTC ISO strings. */
export interface SlotWire {
  startUtc: string;
  endUtc: string;
}

export interface GetSlotsActionResult {
  ok: boolean;
  slots?: SlotWire[];
  durationMinutes?: number;
  kind?: "video" | "phone" | "presencial";
  sequenceNumber?: number;
  staffTimezone?: string;
  error?: { code: string; blockedUntil?: string | null };
}

/**
 * Materialises the available slots for the case's current phase across the given
 * UTC window. Used both on first render (server page) and when the client moves
 * the calendar to another month/range (client refetch).
 *
 * @api-id API-SCH-01
 */
export async function getSlotsAction(input: {
  caseId: string;
  windowFromUtc: string;
  windowToUtc: string;
}): Promise<GetSlotsActionResult> {
  try {
    const actor = await requireActor();
    const result = await getAvailableSlots(actor, {
      caseId: input.caseId,
      windowFromUtc: new Date(input.windowFromUtc),
      windowToUtc: new Date(input.windowToUtc),
    });
    return {
      ok: true,
      slots: result.slots.map((s) => ({
        startUtc: s.startUtc.toISOString(),
        endUtc: s.endUtc.toISOString(),
      })),
      durationMinutes: result.durationMinutes,
      kind: result.kind,
      sequenceNumber: result.sequenceNumber,
      staffTimezone: result.staffTimezone,
    };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export interface BookAppointmentActionResult {
  ok: boolean;
  appointmentId?: string;
  error?: { code: string; blockedUntil?: string | null };
}

/**
 * Books an appointment at the chosen UTC instant. The server re-validates that
 * the slot is still materialisable (carrera entre dos clientes) and the EXCLUDE
 * constraint is the last defense → SLOT_TAKEN. On success the client navigates to
 * the confirmed screen (which fires the confetti).
 *
 * @api-id API-SCH-02
 */
export async function bookAppointmentAction(input: {
  caseId: string;
  startsAtUtc: string;
  reminder1d: boolean;
  reminder1h: boolean;
  notes?: string | null;
}): Promise<BookAppointmentActionResult> {
  try {
    const actor = await requireActor();
    const { appointment } = await bookAppointment(actor, {
      caseId: input.caseId,
      startsAtUtc: new Date(input.startsAtUtc),
      reminder1d: input.reminder1d,
      reminder1h: input.reminder1h,
      // The client's note is their own ("Nota para tu asesora") — route it to the
      // dedicated client_note column, NOT the staff internal log (`notes`).
      clientNote: input.notes ?? null,
    });
    if (!appointment) {
      // Clients never trigger the staff "warnings" path; treat as a generic retry.
      return { ok: false, error: { code: "UNEXPECTED" } };
    }
    return { ok: true, appointmentId: appointment.id };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

function toError(err: unknown): { code: string; blockedUntil?: string | null } {
  if (err instanceof SchedulingError) {
    const raw = err.meta?.["blockedUntil"];
    const blockedUntil =
      raw instanceof Date
        ? raw.toISOString()
        : typeof raw === "string"
          ? raw
          : null;
    return { code: err.code, blockedUntil };
  }
  return { code: "UNEXPECTED" };
}
