/**
 * Ola A — service appointment schedule (cronograma) tests.
 *
 * Domain: UpsertAppointmentScheduleDtoSchema rejects duplicate sequence numbers
 * and enforces min duration/week_offset.
 * Service: upsertAppointmentSchedule maps items (with position), persists the
 * processing weeks, enforces org ownership (phase → service → org), and returns
 * the refreshed rows.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const repo = {
    findPhaseById: vi.fn(),
    findServiceById: vi.fn(),
    replaceAppointmentSchedule: vi.fn(),
    setPhaseProcessingWeeks: vi.fn(),
    listAppointmentSchedule: vi.fn(),
  };
  const can = vi.fn();
  const writeAudit = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const completeI18n = vi.fn();
  return { repo, can, writeAudit, logger, completeI18n };
});

// service.ts does `import * as repo` — provide the fns it touches in these paths.
vi.mock("../repository", () => mocks.repo);
vi.mock("@/backend/platform/supabase", () => ({ createServiceClient: vi.fn(() => ({})) }));
vi.mock("@/backend/platform/pdf", () => ({
  detectAcroFields: vi.fn(),
  fillAcroForm: vi.fn(),
  extractPdfText: vi.fn(),
  backfillNaTextFields: vi.fn(),
}));
vi.mock("@/backend/platform/anthropic", () => ({ getAnthropicClient: vi.fn(() => ({ messages: { create: vi.fn(), countTokens: vi.fn() } })) }));
vi.mock("@/backend/platform/authz", () => ({ can: mocks.can }));
vi.mock("@/backend/modules/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/backend/platform/logger", () => ({ logger: mocks.logger }));
vi.mock("@/backend/platform/events", () => ({ appEvents: { emit: vi.fn() } }));
vi.mock("@/backend/modules/ai-engine", () => ({
  proposeFormSegmentation: vi.fn(),
  proposeExtractionSchema: vi.fn(),
  startGeneration: vi.fn(),
  extractRawTextFromStorage: vi.fn().mockResolvedValue(null),
  completeI18n: mocks.completeI18n,
}));
vi.mock("@/backend/platform/storage", () => ({
  validateUploadedObject: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
}));

import type { Actor } from "@/backend/platform/authz";
import { upsertAppointmentSchedule } from "../service";
import { UpsertAppointmentScheduleDtoSchema } from "../domain";

const ACTOR: Actor = {
  userId: "11111111-1111-4111-8111-111111111001",
  orgId: "22222222-2222-4222-8222-222222222002",
  role: "admin",
  kind: "staff",
  permissions: new Map(),
};
const PHASE_ID = "33333333-3333-4333-8333-333333333003";

describe("UpsertAppointmentScheduleDtoSchema", () => {
  it("rejects duplicate sequence numbers", () => {
    const res = UpsertAppointmentScheduleDtoSchema.safeParse({
      service_phase_id: PHASE_ID,
      processing_weeks: 0,
      items: [
        { sequence_number: 1, duration_minutes: 60, kind: "video", week_offset: 1 },
        { sequence_number: 1, duration_minutes: 45, kind: "video", week_offset: 2 },
      ],
    });
    expect(res.success).toBe(false);
  });

  it("rejects a duration below the 5-minute minimum", () => {
    const res = UpsertAppointmentScheduleDtoSchema.safeParse({
      service_phase_id: PHASE_ID,
      items: [{ sequence_number: 1, duration_minutes: 4, kind: "video", week_offset: 1 }],
    });
    expect(res.success).toBe(false);
  });

  it("rejects a week_offset below 1", () => {
    const res = UpsertAppointmentScheduleDtoSchema.safeParse({
      service_phase_id: PHASE_ID,
      items: [{ sequence_number: 1, duration_minutes: 30, kind: "video", week_offset: 0 }],
    });
    expect(res.success).toBe(false);
  });

  it("accepts a valid per-cita schedule + processing weeks", () => {
    const res = UpsertAppointmentScheduleDtoSchema.safeParse({
      service_phase_id: PHASE_ID,
      processing_weeks: 2,
      items: [
        { sequence_number: 1, duration_minutes: 60, kind: "video", week_offset: 1 },
        { sequence_number: 2, duration_minutes: 45, kind: "phone", week_offset: 2 },
      ],
    });
    expect(res.success).toBe(true);
  });
});

describe("upsertAppointmentSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repo.findPhaseById.mockResolvedValue({ id: PHASE_ID, service_id: "svc-1" });
    mocks.repo.findServiceById.mockResolvedValue({ id: "svc-1", org_id: ACTOR.orgId });
    mocks.repo.replaceAppointmentSchedule.mockResolvedValue(undefined);
    mocks.repo.setPhaseProcessingWeeks.mockResolvedValue(undefined);
    mocks.repo.listAppointmentSchedule.mockResolvedValue([{ id: "row-1" }]);
    mocks.completeI18n.mockImplementation(async ({ es }: { es?: string; en?: string }) => ({
      es: es ?? "",
      en: `EN[${es}]`,
    }));
  });

  it("maps items with position, persists processing weeks, returns refreshed rows", async () => {
    const result = await upsertAppointmentSchedule(ACTOR, {
      service_phase_id: PHASE_ID,
      processing_weeks: 2,
      items: [
        { sequence_number: 1, duration_minutes: 60, kind: "video", week_offset: 1 },
        { sequence_number: 2, duration_minutes: 45, kind: "phone", week_offset: 2 },
      ],
    });

    expect(mocks.can).toHaveBeenCalledWith(ACTOR, "catalog", "edit");
    const [phaseArg, itemsArg] = mocks.repo.replaceAppointmentSchedule.mock.calls[0];
    expect(phaseArg).toBe(PHASE_ID);
    expect(itemsArg).toEqual([
      { service_phase_id: PHASE_ID, sequence_number: 1, duration_minutes: 60, kind: "video", week_offset: 1, label_i18n: null, objectives_i18n: null, position: 0 },
      { service_phase_id: PHASE_ID, sequence_number: 2, duration_minutes: 45, kind: "phone", week_offset: 2, label_i18n: null, objectives_i18n: null, position: 1 },
    ]);
    expect(mocks.repo.setPhaseProcessingWeeks).toHaveBeenCalledWith(PHASE_ID, 2);
    expect(result).toEqual([{ id: "row-1" }]);
  });

  it("auto-fills English for es-only objectives on save, leaving translated ones untouched", async () => {
    await upsertAppointmentSchedule(ACTOR, {
      service_phase_id: PHASE_ID,
      processing_weeks: 0,
      items: [
        {
          sequence_number: 1,
          duration_minutes: 30,
          kind: "video",
          week_offset: 1,
          objectives: [
            { id: "o1", text: { es: "Bienvenida", en: "" } }, // es-only → translate
            { id: "o2", text: { es: "Explicar plazo", en: "Explain deadline" } }, // has en → keep
          ],
        },
      ],
    });

    expect(mocks.completeI18n).toHaveBeenCalledTimes(1);
    expect(mocks.completeI18n).toHaveBeenCalledWith({ es: "Bienvenida", en: "" });

    const [, itemsArg] = mocks.repo.replaceAppointmentSchedule.mock.calls[0];
    expect(itemsArg[0].objectives_i18n).toEqual([
      { id: "o1", text: { es: "Bienvenida", en: "EN[Bienvenida]" } },
      { id: "o2", text: { es: "Explicar plazo", en: "Explain deadline" } },
    ]);
  });

  it("skips the AI translation when every objective already has both languages", async () => {
    await upsertAppointmentSchedule(ACTOR, {
      service_phase_id: PHASE_ID,
      processing_weeks: 0,
      items: [
        {
          sequence_number: 1,
          duration_minutes: 30,
          kind: "video",
          week_offset: 1,
          objectives: [{ id: "o1", text: { es: "Hola", en: "Hi" } }],
        },
      ],
    });
    expect(mocks.completeI18n).not.toHaveBeenCalled();
  });

  it("does not block the save when translation fails (keeps es-only)", async () => {
    mocks.completeI18n.mockRejectedValueOnce(new Error("gemini down"));
    await upsertAppointmentSchedule(ACTOR, {
      service_phase_id: PHASE_ID,
      processing_weeks: 0,
      items: [
        {
          sequence_number: 1,
          duration_minutes: 30,
          kind: "video",
          week_offset: 1,
          objectives: [{ id: "o1", text: { es: "Bienvenida", en: "" } }],
        },
      ],
    });
    const [, itemsArg] = mocks.repo.replaceAppointmentSchedule.mock.calls[0];
    expect(itemsArg[0].objectives_i18n).toEqual([
      { id: "o1", text: { es: "Bienvenida", en: "" } },
    ]);
  });

  it("rejects when the phase belongs to another org", async () => {
    mocks.repo.findServiceById.mockResolvedValue({ id: "svc-1", org_id: "other-org" });
    await expect(
      upsertAppointmentSchedule(ACTOR, {
        service_phase_id: PHASE_ID,
        processing_weeks: 0,
        items: [{ sequence_number: 1, duration_minutes: 30, kind: "video", week_offset: 1 }],
      }),
    ).rejects.toThrow();
    expect(mocks.repo.replaceAppointmentSchedule).not.toHaveBeenCalled();
  });

  it("rejects when the phase does not exist", async () => {
    mocks.repo.findPhaseById.mockResolvedValue(null);
    await expect(
      upsertAppointmentSchedule(ACTOR, {
        service_phase_id: PHASE_ID,
        processing_weeks: 0,
        items: [],
      }),
    ).rejects.toThrow();
    expect(mocks.repo.replaceAppointmentSchedule).not.toHaveBeenCalled();
  });
});
