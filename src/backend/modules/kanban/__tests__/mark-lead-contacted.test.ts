/**
 * API-LEAD-08: markLeadContacted — stamps contacted_at on first outreach.
 *
 * Regression: contactLeadAction previously called updateLead({ leadId }) with an
 * empty update, so the "Contactar" (call/WhatsApp) button never recorded
 * contacted_at — only moveCard did. That silently broke the conversion funnel
 * (getSalesMetrics stage1 = leads with a non-null contacted_at). markLeadContacted
 * is the dedicated, idempotent write for that signal.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindLead = vi.hoisted(() => vi.fn());
const mockUpdateLead = vi.hoisted(() => vi.fn());

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: () => ({ from: vi.fn() }),
  createServerClient: () => ({}),
}));

vi.mock("../repository.js", () => ({
  findLead: mockFindLead,
  updateLead: mockUpdateLead,
  findCard: vi.fn().mockResolvedValue(null),
  findColumn: vi.fn().mockResolvedValue(null),
  listLeads: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  findLeadsByLast4: vi.fn().mockResolvedValue([]),
  getBoard: vi.fn().mockResolvedValue(null),
  updateCard: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  systemActor: { userId: "system", orgId: "org-system", role: "admin", kind: "staff" },
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn(), emitAndWait: vi.fn() },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockWriteAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/backend/modules/audit", () => ({
  writeAudit: mockWriteAudit,
}));

// Import after mocks
import { markLeadContacted, KanbanError } from "../service";
import type { Actor } from "@/backend/platform/authz";

const STAFF_ACTOR: Actor = {
  userId: "11111111-1111-4111-8111-111111111001",
  orgId: "22222222-2222-4222-8222-222222222002",
  role: "sales",
  kind: "staff",
  permissions: new Map(),
};

const LEAD_ID = "66666666-6666-4666-8666-666666666006";

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    org_id: STAFF_ACTOR.orgId,
    phone_e164: "+15551234567",
    contacted_at: null,
    full_name: null,
    source: "inbound",
    status: "open",
    assigned_to: null,
    interested_service_id: null,
    category_id: null,
    note: null,
    won_case_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("API-LEAD-08: markLeadContacted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stamps contacted_at when it was null and records the channel in the audit", async () => {
    mockFindLead.mockResolvedValue(makeLead({ contacted_at: null }));
    mockUpdateLead.mockImplementation((_id: string, patch: Record<string, unknown>) =>
      Promise.resolve(makeLead({ contacted_at: patch.contacted_at })),
    );

    const result = await markLeadContacted(STAFF_ACTOR, LEAD_ID, "whatsapp");

    expect(mockUpdateLead).toHaveBeenCalledTimes(1);
    const [, patch] = mockUpdateLead.mock.calls[0];
    expect(typeof patch.contacted_at).toBe("string");
    expect(result.contacted_at).toBe(patch.contacted_at);

    // The outreach channel is threaded into the audit trail (not silently dropped).
    const auditCall = mockWriteAudit.mock.calls.at(-1);
    expect(auditCall?.[1]).toBe("leads.lead.contacted");
    expect((auditCall?.[4] as { after: { channel: string } }).after.channel).toBe("whatsapp");
  });

  it("is idempotent: does NOT rewrite contacted_at if already set", async () => {
    const already = "2026-01-01T00:00:00.000Z";
    mockFindLead.mockResolvedValue(makeLead({ contacted_at: already }));

    const result = await markLeadContacted(STAFF_ACTOR, LEAD_ID);

    expect(mockUpdateLead).not.toHaveBeenCalled();
    expect(result.contacted_at).toBe(already); // first-contact time preserved
  });

  it("throws LEAD_NOT_FOUND when the lead does not exist", async () => {
    mockFindLead.mockResolvedValue(null);
    await expect(markLeadContacted(STAFF_ACTOR, LEAD_ID)).rejects.toMatchObject({
      code: "LEAD_NOT_FOUND",
    });
  });

  it("throws LEAD_NOT_FOUND when the lead belongs to another org", async () => {
    mockFindLead.mockResolvedValue(makeLead({ org_id: "99999999-9999-4999-8999-999999999999" }));
    const err = await markLeadContacted(STAFF_ACTOR, LEAD_ID).catch((e) => e);
    expect(err).toBeInstanceOf(KanbanError);
    expect(err.code).toBe("LEAD_NOT_FOUND");
    expect(mockUpdateLead).not.toHaveBeenCalled();
  });
});
