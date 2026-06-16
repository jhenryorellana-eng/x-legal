/**
 * Billing — F6-Ola3 unit tests (contabilidad + manual reminder).
 *
 * Covers: validateLedgerEntry/monthRange/previousMonth (pure), recordLedgerEntry,
 * updateLedgerEntry (candado + cross-org), getMonthlySummary, sendInstallmentReminder.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateLedgerEntry, monthRange, previousMonth } from "../domain";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockRepo = vi.hoisted(() => ({
  // F6-Ola3
  insertLedgerEntry: vi.fn(),
  findLedgerEntryById: vi.fn(),
  updateLedgerEntryRow: vi.fn(),
  listLedger: vi.fn(),
  monthlyLedgerSummary: vi.fn(),
  findCaseClientUserId: vi.fn(),
  // shared
  findInstallmentById: vi.fn(),
  updateInstallment: vi.fn().mockResolvedValue(undefined),
  findInstallmentCaseId: vi.fn(),
  // present so the service import resolves
  findPlanByContractId: vi.fn(),
  findPlanByCaseId: vi.fn(),
  insertPaymentPlan: vi.fn(),
  insertInstallments: vi.fn(),
  listInstallmentsForPlan: vi.fn(),
  insertPayment: vi.fn(),
  updatePayment: vi.fn(),
  findPaymentById: vi.fn(),
  findPendingZellePayment: vi.fn(),
  getAccountStatement: vi.fn(),
  findActiveStripePayment: vi.fn(),
  findPaymentByIntentId: vi.fn(),
  findPaymentBySessionId: vi.fn(),
  findStripeCustomer: vi.fn(),
  upsertStripeCustomer: vi.fn(),
  insertLedgerIfAbsent: vi.fn(),
  listOverdueUniverse: vi.fn(),
  listReminderTargets: vi.fn(),
  listDueCalendar: vi.fn(),
  listOverdueForCollections: vi.fn(),
  collectionMetrics: vi.fn(),
}));

const mockAppEvents = vi.hoisted(() => ({ emit: vi.fn() }));
const mockAudit = vi.hoisted(() => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));
const mockQstash = vi.hoisted(() => ({ enqueueJob: vi.fn().mockResolvedValue({ messageId: "m" }) }));
const mockNotifications = vi.hoisted(() => ({
  insertNotificationIdempotent: vi.fn(),
  findUserById: vi.fn(),
}));

vi.mock("../repository.js", () => mockRepo);
vi.mock("@/backend/platform/events", () => ({ appEvents: mockAppEvents }));
vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/backend/platform/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://test.localhost" },
}));
vi.mock("@/backend/platform/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/backend/platform/storage", () => ({
  createSignedUploadUrl: vi.fn(),
  validateUploadedObject: vi.fn(),
}));
vi.mock("@/backend/platform/ratelimit", () => ({
  limitBillingCheckout: vi.fn().mockResolvedValue({ allowed: true }),
  limitBillingUploadUrl: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock("@/backend/platform/qstash", () => mockQstash);
vi.mock("@/backend/modules/notifications", () => mockNotifications);
vi.mock("@/backend/modules/audit", () => mockAudit);

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn().mockResolvedValue(undefined),
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
      this.name = "AuthzError";
    }
  },
}));

const ORG_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const mockSupabase = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  createServerClient: vi.fn(),
}));
vi.mock("@/backend/platform/supabase", () => mockSupabase);

function makeServiceClientMock(data: Record<string, unknown> | null) {
  const maybeSingleFn = vi.fn().mockResolvedValue({ data, error: null });
  function makeNode(): Record<string, unknown> {
    return {
      eq: () => makeNode(),
      neq: () => makeNode(),
      in: () => makeNode(),
      select: () => makeNode(),
      order: () => makeNode(),
      maybeSingle: maybeSingleFn,
    };
  }
  return { from: vi.fn(() => makeNode()) };
}

function setOrg(orgId: string) {
  mockSupabase.createServiceClient.mockReturnValue(
    makeServiceClientMock({ org_id: orgId, status: null }),
  );
}

import {
  recordLedgerEntry,
  updateLedgerEntry,
  getMonthlySummary,
  sendInstallmentReminder,
} from "../service";
import { AuthzError } from "@/backend/platform/authz";

const FINANCE_ACTOR = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  orgId: ORG_ID,
  role: "finance" as const,
  kind: "staff" as const,
  permissions: new Map([["billing", { view: true, edit: true }]]),
} as import("@/backend/platform/authz").Actor;

const CASE_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

// ---------------------------------------------------------------------------
// Pure domain
// ---------------------------------------------------------------------------

describe("billing.domain: ledger helpers", () => {
  it("validateLedgerEntry accepts a positive integer + non-empty category", () => {
    expect(validateLedgerEntry({ amountCents: 1500, category: "marketing" })).toBeNull();
  });
  it("rejects non-positive or non-integer amounts", () => {
    expect(validateLedgerEntry({ amountCents: 0, category: "x" })).toBe("LEDGER_AMOUNT_INVALID");
    expect(validateLedgerEntry({ amountCents: -5, category: "x" })).toBe("LEDGER_AMOUNT_INVALID");
    expect(validateLedgerEntry({ amountCents: 10.5, category: "x" })).toBe("LEDGER_AMOUNT_INVALID");
  });
  it("rejects blank categories", () => {
    expect(validateLedgerEntry({ amountCents: 100, category: "   " })).toBe("LEDGER_CATEGORY_REQUIRED");
  });
  it("monthRange clamps to the last day of the month", () => {
    expect(monthRange("2026-06")).toEqual({ start: "2026-06-01", end: "2026-06-30" });
    expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthRange("2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
  });
  it("previousMonth wraps the year boundary", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-06")).toBe("2026-05");
  });
});

// ---------------------------------------------------------------------------
// recordLedgerEntry
// ---------------------------------------------------------------------------

describe("billing: recordLedgerEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOrg(ORG_ID);
    mockRepo.insertLedgerEntry.mockResolvedValue({
      id: "led-1", kind: "expense", category: "marketing", amount_cents: 5000,
    });
  });

  it("inserts a manual expense with org + recorder and writes audit", async () => {
    const res = await recordLedgerEntry(FINANCE_ACTOR, {
      kind: "expense", category: "marketing", amountCents: 5000, description: "Ads",
    });
    expect(res.id).toBe("led-1");
    expect(mockRepo.insertLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_ID, recordedBy: FINANCE_ACTOR.userId, kind: "expense", amountCents: 5000 }),
    );
    expect(mockAudit.writeAudit).toHaveBeenCalled();
  });

  it("rejects a non-positive amount before any insert", async () => {
    await expect(
      recordLedgerEntry(FINANCE_ACTOR, { kind: "expense", category: "x", amountCents: 0 }),
    ).rejects.toMatchObject({ code: "LEDGER_AMOUNT_INVALID" });
    expect(mockRepo.insertLedgerEntry).not.toHaveBeenCalled();
  });

  it("rejects a blank category", async () => {
    await expect(
      recordLedgerEntry(FINANCE_ACTOR, { kind: "expense", category: "   ", amountCents: 100 }),
    ).rejects.toMatchObject({ code: "LEDGER_CATEGORY_REQUIRED" });
  });

  it("rejects a case that belongs to another org", async () => {
    setOrg("other-org-9999");
    await expect(
      recordLedgerEntry(FINANCE_ACTOR, {
        kind: "expense", category: "x", amountCents: 100, caseId: CASE_ID,
      }),
    ).rejects.toBeInstanceOf(AuthzError);
    expect(mockRepo.insertLedgerEntry).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateLedgerEntry — candado + cross-org
// ---------------------------------------------------------------------------

describe("billing: updateLedgerEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOrg(ORG_ID);
    mockRepo.updateLedgerEntryRow.mockResolvedValue({
      id: "led-1", category: "salarios", amount_cents: 8000, entry_date: "2026-06-10", description: null,
    });
  });

  it("edits a manual entry", async () => {
    mockRepo.findLedgerEntryById.mockResolvedValue({
      id: "led-1", org_id: ORG_ID, payment_id: null, category: "marketing", amount_cents: 5000,
      entry_date: "2026-06-01", description: null,
    });
    await updateLedgerEntry(FINANCE_ACTOR, "led-1", { category: "salarios", amountCents: 8000 });
    expect(mockRepo.updateLedgerEntryRow).toHaveBeenCalledWith(
      "led-1",
      expect.objectContaining({ category: "salarios", amount_cents: 8000 }),
    );
  });

  it("LOCKS automatic (payment-linked) entries", async () => {
    mockRepo.findLedgerEntryById.mockResolvedValue({
      id: "led-2", org_id: ORG_ID, payment_id: "pay-1", category: "cuota", amount_cents: 50000,
      entry_date: "2026-06-01", description: null,
    });
    await expect(
      updateLedgerEntry(FINANCE_ACTOR, "led-2", { amountCents: 1 }),
    ).rejects.toMatchObject({ code: "LEDGER_ENTRY_NOT_EDITABLE" });
    expect(mockRepo.updateLedgerEntryRow).not.toHaveBeenCalled();
  });

  it("rejects an entry from another org (cross-org)", async () => {
    mockRepo.findLedgerEntryById.mockResolvedValue({
      id: "led-3", org_id: "other-org", payment_id: null, category: "x", amount_cents: 100,
      entry_date: "2026-06-01", description: null,
    });
    await expect(
      updateLedgerEntry(FINANCE_ACTOR, "led-3", { amountCents: 1 }),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("throws LEDGER_ENTRY_NOT_FOUND when missing", async () => {
    mockRepo.findLedgerEntryById.mockResolvedValue(null);
    await expect(
      updateLedgerEntry(FINANCE_ACTOR, "missing", { amountCents: 1 }),
    ).rejects.toMatchObject({ code: "LEDGER_ENTRY_NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// getMonthlySummary
// ---------------------------------------------------------------------------

describe("billing: getMonthlySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOrg(ORG_ID);
  });

  it("returns income/expense/balance + previous month", async () => {
    mockRepo.monthlyLedgerSummary
      .mockResolvedValueOnce({ incomeCents: 100000, expenseCents: 30000, byCategory: [] }) // current
      .mockResolvedValueOnce({ incomeCents: 80000, expenseCents: 20000, byCategory: [] }); // previous
    const res = await getMonthlySummary(FINANCE_ACTOR, "2026-06");
    expect(res.month).toBe("2026-06");
    expect(res.balanceCents).toBe(70000);
    expect(res.previous.balanceCents).toBe(60000);
  });
});

// ---------------------------------------------------------------------------
// sendInstallmentReminder
// ---------------------------------------------------------------------------

describe("billing: sendInstallmentReminder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOrg(ORG_ID);
    mockRepo.findInstallmentCaseId.mockResolvedValue(CASE_ID);
    mockRepo.findCaseClientUserId.mockResolvedValue("client-1");
    mockNotifications.insertNotificationIdempotent.mockResolvedValue({ created: true, row: { id: "notif-1" } });
    mockNotifications.findUserById.mockResolvedValue({ email: "c@test.com", emailBouncedAt: null, locale: "es" });
  });

  it("sends a reminder and records last_reminder_at", async () => {
    mockRepo.findInstallmentById.mockResolvedValue({
      id: "inst-1", status: "pending", number: 2, last_reminder_at: null, due_date: "2026-06-30",
    });
    await sendInstallmentReminder(FINANCE_ACTOR, "inst-1");
    expect(mockQstash.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: "deliver-notification", templateKey: "installment-reminder-due" }),
    );
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ last_reminder_at: expect.any(String) }),
    );
  });

  it("throws REMINDER_TOO_SOON when reminded within 12h", async () => {
    mockRepo.findInstallmentById.mockResolvedValue({
      id: "inst-1", status: "overdue", number: 2,
      last_reminder_at: new Date().toISOString(), due_date: "2026-06-01",
    });
    await expect(sendInstallmentReminder(FINANCE_ACTOR, "inst-1")).rejects.toMatchObject({
      code: "REMINDER_TOO_SOON",
    });
    expect(mockQstash.enqueueJob).not.toHaveBeenCalled();
  });
});
