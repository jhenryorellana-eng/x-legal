/**
 * TDD: insertAppointment — client_note vs notes separation (0034).
 *
 * The note a client writes when self-booking ("Nota para tu asesora") must land
 * in the dedicated `client_note` column and never contaminate `notes` (the staff
 * internal bitácora that completeAppointment/markNoShow merge into). This locks
 * the data contract at the repository boundary where the row is built.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockServiceClient = vi.hoisted(() => vi.fn());

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: mockServiceClient,
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { insertAppointment, type InsertAppointmentInput } from "../repository";

/** Builds an insert-chain mock that captures the row handed to `.insert()`. */
function makeInsertClient() {
  const captured: { row?: Record<string, unknown> } = {};
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    insert: vi.fn((row: Record<string, unknown>) => {
      captured.row = row;
      return chain;
    }),
    select: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve({ data: { id: "appt-1", ...captured.row }, error: null })),
  };
  return { chain, captured };
}

const baseInput: InsertAppointmentInput = {
  orgId: "22222222-2222-4222-8222-222222222001",
  caseId: "55555555-5555-4555-8555-555555555001",
  leadId: null,
  servicePhaseId: "66666666-6666-4666-8666-666666666001",
  staffId: "11111111-1111-4111-8111-111111111001",
  clientUserId: "33333333-3333-4333-8333-333333333001",
  startsAt: new Date("2026-06-08T15:00:00Z"),
  endsAt: new Date("2026-06-08T15:30:00Z"),
  kind: "video",
  status: "scheduled",
  sequenceNumber: 1,
  reminder1d: true,
  reminder1h: false,
  notes: null,
};

describe("insertAppointment — client_note vs notes separation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes the client note to client_note and keeps notes independent (client booking)", async () => {
    const { chain, captured } = makeInsertClient();
    mockServiceClient.mockReturnValue(chain);

    await insertAppointment({ ...baseInput, clientNote: "Cliente: dudas sobre I-765", notes: null });

    expect(captured.row?.client_note).toBe("Cliente: dudas sobre I-765");
    expect(captured.row?.notes).toBeNull();
  });

  it("keeps client_note null and writes notes for staff bookings (no clientNote)", async () => {
    const { chain, captured } = makeInsertClient();
    mockServiceClient.mockReturnValue(chain);

    await insertAppointment({ ...baseInput, notes: "Preparar I-589 antes de la cita" });

    expect(captured.row?.client_note).toBeNull();
    expect(captured.row?.notes).toBe("Preparar I-589 antes de la cita");
  });
});
