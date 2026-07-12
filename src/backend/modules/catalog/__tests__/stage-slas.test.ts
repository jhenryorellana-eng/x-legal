import { describe, it, expect } from "vitest";
import { UpsertStageSlasDtoSchema, STAGE_SLA_KEYS } from "../domain";

const SERVICE_ID = "33333333-3333-4333-8333-333333333003";

describe("UpsertStageSlasDtoSchema", () => {
  it("accepts a valid per-stage SLA set (sales + legal)", () => {
    const res = UpsertStageSlasDtoSchema.safeParse({
      service_id: SERVICE_ID,
      items: [
        { stage: "sales", duration_days: 7 },
        { stage: "legal", duration_days: 7 },
      ],
    });
    expect(res.success).toBe(true);
  });

  it("rejects duplicate stages", () => {
    const res = UpsertStageSlasDtoSchema.safeParse({
      service_id: SERVICE_ID,
      items: [
        { stage: "legal", duration_days: 7 },
        { stage: "legal", duration_days: 3 },
      ],
    });
    expect(res.success).toBe(false);
  });

  it("rejects a non-positive duration", () => {
    const res = UpsertStageSlasDtoSchema.safeParse({
      service_id: SERVICE_ID,
      items: [{ stage: "sales", duration_days: 0 }],
    });
    expect(res.success).toBe(false);
  });

  it("rejects an unknown stage (e.g. 'done' is terminal, not configurable)", () => {
    const res = UpsertStageSlasDtoSchema.safeParse({
      service_id: SERVICE_ID,
      items: [{ stage: "done", duration_days: 5 }],
    });
    expect(res.success).toBe(false);
  });

  it("accepts an empty items array (clears all stage SLAs → no countdown)", () => {
    const res = UpsertStageSlasDtoSchema.safeParse({ service_id: SERVICE_ID, items: [] });
    expect(res.success).toBe(true);
  });

  it("exposes exactly the three non-terminal stages", () => {
    expect([...STAGE_SLA_KEYS]).toEqual(["sales", "legal", "operations"]);
  });
});
