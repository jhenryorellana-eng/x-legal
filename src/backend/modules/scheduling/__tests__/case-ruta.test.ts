/**
 * getCaseRuta + addCaseAppointment — appointment route for a case (DOC-52 §5.5).
 *
 * getCaseRuta: builds the current-phase route (service cronograma + per-case
 * extras), marks completed/current/upcoming, and overlays objective outcomes.
 * addCaseAppointment: inserts an intermediate cita with sequence = max+1 and a
 * trailing position so it follows the current route.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAppointmentSchedule = vi.hoisted(() => vi.fn());
const mockGetCaseScheduleRows = vi.hoisted(() => vi.fn());
const mockGetCaseScheduleAll = vi.hoisted(() => vi.fn());
const mockGetPhaseSeqNumbers = vi.hoisted(() => vi.fn());
const mockInsertCaseSchedule = vi.hoisted(() => vi.fn());

vi.mock("../repository.js", () => ({
  getAppointmentSchedule: mockGetAppointmentSchedule,
  getCaseAppointmentScheduleRows: mockGetCaseScheduleRows,
  getCaseAppointmentScheduleAll: mockGetCaseScheduleAll,
  getPhaseSequenceNumbers: mockGetPhaseSeqNumbers,
  insertCaseAppointmentScheduleRow: mockInsertCaseSchedule,
}));

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn(),
}));

const mockCaseRow = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const mockApptRows = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));
const mockPhaseRow = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const mockPhaseList = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "cases") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mockCaseRow.current }) }) }),
        };
      }
      if (table === "appointments") {
        return {
          select: () => ({ eq: () => ({ order: async () => ({ data: mockApptRows.current }) }) }),
        };
      }
      if (table === "service_phases") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: mockPhaseRow.current }) }),
            in: async () => ({ data: mockPhaseList.current }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    },
  })),
  createServerClient: vi.fn(() => ({})),
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn(), emitAndWait: vi.fn() },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockWriteAudit = vi.hoisted(() => vi.fn());
vi.mock("@/backend/modules/audit", () => ({ writeAudit: mockWriteAudit }));

import { getCaseRuta, addCaseAppointment, getCaseRouteExtras } from "../service";
import type { Actor } from "@/backend/platform/authz";

const STAFF: Actor = {
  userId: "11111111-1111-4111-8111-111111111001",
  orgId: "22222222-2222-4222-8222-222222222002",
  role: "sales",
  kind: "staff",
  permissions: new Map(),
};

const CASE_ID = "33333333-3333-4333-8333-333333333003";
const PHASE_ID = "44444444-4444-4444-8444-444444444004";

function svcEntry(seq: number, over: Record<string, unknown> = {}) {
  return {
    sequenceNumber: seq,
    durationMinutes: 30,
    kind: "video",
    weekOffset: seq,
    labelI18n: null,
    objectives: [],
    position: seq - 1,
    origin: "service" as const,
    id: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCaseRow.current = {
    id: CASE_ID,
    status: "active",
    current_phase_id: PHASE_ID,
    assigned_sales_id: null,
    primary_client_id: "client-1",
    rebooking_blocked_until: null,
  };
  mockApptRows.current = [];
  mockPhaseRow.current = { label_i18n: { es: "Fase 1", en: "Phase 1" } };
  mockPhaseList.current = [];
  mockGetCaseScheduleRows.mockResolvedValue([]);
  mockGetCaseScheduleAll.mockResolvedValue([]);
  mockGetPhaseSeqNumbers.mockResolvedValue([]);
  mockInsertCaseSchedule.mockResolvedValue("new-row-id");
});

describe("getCaseRuta", () => {
  it("marks completed/current/upcoming and overlays objective outcomes", async () => {
    mockGetAppointmentSchedule.mockResolvedValue([
      svcEntry(1, {
        labelI18n: { es: "Inducción" },
        objectives: [
          { id: "o1", text: { es: "A" } },
          { id: "o2", text: { es: "B" } },
        ],
      }),
      svcEntry(2, { objectives: [{ id: "o3", text: { es: "C" } }] }),
    ]);
    mockApptRows.current = [
      {
        id: "ap1",
        service_phase_id: PHASE_ID,
        sequence_number: 1,
        status: "completed",
        starts_at: "2026-06-01T15:00:00Z",
        video_link: null,
        objectives_outcome: [
          { id: "o1", text: "A", achieved: true },
          { id: "o2", text: "B", achieved: false },
        ],
      },
    ];

    const ruta = await getCaseRuta(STAFF, CASE_ID);

    expect(ruta.total).toBe(2);
    expect(ruta.currentSequence).toBe(2);
    expect(ruta.phaseLabelI18n).toEqual({ es: "Fase 1", en: "Phase 1" });

    expect(ruta.citas[0].status).toBe("completed");
    expect(ruta.citas[0].objectives).toEqual([
      { id: "o1", text: { es: "A" }, achieved: true },
      { id: "o2", text: { es: "B" }, achieved: false },
    ]);
    expect(ruta.citas[0].appointment?.id).toBe("ap1");

    expect(ruta.citas[1].status).toBe("current");
    expect(ruta.citas[1].objectives[0].achieved).toBeNull();
  });

  it("merges per-case extras into the route (count rises)", async () => {
    mockGetAppointmentSchedule.mockResolvedValue([svcEntry(1), svcEntry(2)]);
    mockGetCaseScheduleRows.mockResolvedValue([
      svcEntry(3, { origin: "case", id: "extra-1", position: 1, weekOffset: 1 }),
    ]);

    const ruta = await getCaseRuta(STAFF, CASE_ID);
    expect(ruta.total).toBe(3);
    expect(ruta.citas.some((c) => c.origin === "case" && c.sequenceNumber === 3)).toBe(true);
  });

  it("returns an empty route when the case has no current phase", async () => {
    mockCaseRow.current = { ...mockCaseRow.current!, current_phase_id: null };
    const ruta = await getCaseRuta(STAFF, CASE_ID);
    expect(ruta.total).toBe(0);
    expect(ruta.citas).toEqual([]);
  });
});

describe("addCaseAppointment", () => {
  it("inserts an intermediate cita with sequence = max+1 and trailing position", async () => {
    mockGetAppointmentSchedule.mockResolvedValue([svcEntry(1), svcEntry(2)]);
    mockGetCaseScheduleRows.mockResolvedValue([]);
    mockGetPhaseSeqNumbers.mockResolvedValue([1, 2]);

    const res = await addCaseAppointment(STAFF, {
      caseId: CASE_ID,
      labelI18n: { es: "Seguimiento", en: "Follow-up" },
      objectives: [{ text: { es: "Revisar docs", en: "Review docs" } }],
    });

    expect(res).toEqual({ id: "new-row-id", sequenceNumber: 3 });
    const arg = mockInsertCaseSchedule.mock.calls[0][0];
    expect(arg.sequenceNumber).toBe(3);
    expect(arg.position).toBe(2); // last position (1) + 1
    expect(arg.weekOffset).toBe(2); // follows the last cita's week
    expect(arg.objectivesI18n).toHaveLength(1);
    expect(arg.objectivesI18n[0].id).toBeTruthy(); // id generated for the new objective
    expect(mockWriteAudit).toHaveBeenCalled();
  });

  it("takes max+1 across booked sequence numbers too", async () => {
    mockGetAppointmentSchedule.mockResolvedValue([svcEntry(1)]);
    mockGetCaseScheduleRows.mockResolvedValue([]);
    mockGetPhaseSeqNumbers.mockResolvedValue([1, 5]); // a booked cita jumped to 5

    const res = await addCaseAppointment(STAFF, { caseId: CASE_ID, objectives: [] });
    expect(res.sequenceNumber).toBe(6);
  });

  it("defaults to sequence 1 / week 1 / position 1 when the phase has no schedule", async () => {
    mockGetAppointmentSchedule.mockResolvedValue([]);
    mockGetCaseScheduleRows.mockResolvedValue([]);
    mockGetPhaseSeqNumbers.mockResolvedValue([]);

    const res = await addCaseAppointment(STAFF, { caseId: CASE_ID, objectives: [] });
    expect(res.sequenceNumber).toBe(1);
    const arg = mockInsertCaseSchedule.mock.calls[0][0];
    expect(arg.weekOffset).toBe(1);
    expect(arg.position).toBe(1);
  });
});

describe("getCaseRouteExtras", () => {
  it("enriches per-case extras with their phase label (client cronograma source)", async () => {
    mockGetCaseScheduleAll.mockResolvedValue([
      {
        servicePhaseId: PHASE_ID,
        sequenceNumber: 3,
        durationMinutes: 30,
        kind: "video",
        weekOffset: 2,
        labelI18n: { es: "Seguimiento" },
        objectives: [],
        origin: "case",
        id: "extra-1",
      },
    ]);
    mockPhaseList.current = [{ id: PHASE_ID, label_i18n: { es: "Fase 1", en: "Phase 1" } }];

    const extras = await getCaseRouteExtras(CASE_ID);
    expect(extras).toHaveLength(1);
    expect(extras[0]).toMatchObject({
      phaseId: PHASE_ID,
      phaseLabelI18n: { es: "Fase 1", en: "Phase 1" },
      sequenceNumber: 3,
      labelI18n: { es: "Seguimiento" },
    });
  });

  it("returns [] when the case has no extras", async () => {
    mockGetCaseScheduleAll.mockResolvedValue([]);
    expect(await getCaseRouteExtras(CASE_ID)).toEqual([]);
  });
});
