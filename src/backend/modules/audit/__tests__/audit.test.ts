/**
 * Audit module tests.
 *
 * Repository is fully mocked — NO real DB calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Actor } from "@/backend/platform/authz";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/backend/modules/audit/repository", () => ({
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  listAuditLogRows: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// platform/supabase — mock to avoid env.ts validation at module load.
// authz.ts imports createServerClient at module level which pulls in env.ts.
vi.mock("@/backend/platform/supabase", () => ({
  createServerClient: vi.fn(),
  createServiceClient: vi.fn(),
  revokeAllSessions: vi.fn(),
}));

import { writeAudit, listAuditLog, exportAuditCsv } from "@/backend/modules/audit/service";
import { insertAuditLog, listAuditLogRows } from "@/backend/modules/audit/repository";
import { AuthzError } from "@/backend/platform/authz";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAdminActor(): Actor {
  return {
    userId: "00000000-0000-0000-0000-000000000001",
    orgId: "00000000-0000-0000-0000-000000000010",
    kind: "staff",
    role: "admin",
    permissions: new Map(),
  };
}

function makeStaffActor(permissions: Record<string, { view: boolean; edit: boolean }> = {}): Actor {
  return {
    userId: "00000000-0000-0000-0000-000000000002",
    orgId: "00000000-0000-0000-0000-000000000010",
    kind: "staff",
    role: "paralegal",
    permissions: new Map(Object.entries(permissions)) as Actor["permissions"],
  };
}

function makeClientActor(): Actor {
  return {
    userId: "00000000-0000-0000-0000-000000000003",
    orgId: "00000000-0000-0000-0000-000000000010",
    kind: "client",
    role: null,
    permissions: new Map(),
  };
}

// ---------------------------------------------------------------------------
// writeAudit
// ---------------------------------------------------------------------------

describe("writeAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts an audit row for a staff actor", async () => {
    const actor = makeAdminActor();
    await writeAudit(actor, "catalog.service.created", "services", "service-id-1", {
      after: { slug: "asilo-politico" },
    });

    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: actor.orgId,
        actor_user_id: actor.userId,
        action: "catalog.service.created",
        entity_type: "services",
        entity_id: "service-id-1",
      }),
    );
  });

  it("inserts an audit row with actor_user_id=null for system actor", async () => {
    await writeAudit("system", "system.job.ran", "audit_log", null, {});

    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_user_id: null,
        action: "system.job.ran",
      }),
    );
  });

  it("does NOT throw when insertAuditLog fails — non-fatal (RF-TRX-023)", async () => {
    vi.mocked(insertAuditLog).mockRejectedValueOnce(new Error("DB down"));
    const actor = makeAdminActor();

    // Must not throw
    await expect(
      writeAudit(actor, "catalog.service.created", "services", "id-1", {}),
    ).resolves.toBeUndefined();
  });

  it("passes entity_id=null for bulk operations", async () => {
    const actor = makeAdminActor();
    await writeAudit(actor, "catalog.service.reordered", "services", null, {
      after: ["id1", "id2"],
    });

    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entity_id: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// listAuditLog — authorization
// ---------------------------------------------------------------------------

describe("listAuditLog — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("admin can list audit log", async () => {
    const actor = makeAdminActor();
    const result = await listAuditLog(actor, {});
    expect(listAuditLogRows).toHaveBeenCalledWith(actor.orgId, {});
    expect(result.items).toEqual([]);
  });

  it("staff with audit:view can list", async () => {
    const actor = makeStaffActor({ audit: { view: true, edit: false } });
    await expect(listAuditLog(actor, {})).resolves.toBeDefined();
  });

  it("staff without audit permission is denied (AuthzError)", async () => {
    const actor = makeStaffActor({});
    await expect(listAuditLog(actor, {})).rejects.toBeInstanceOf(AuthzError);
  });

  it("client actor is denied (AuthzError wrong_kind)", async () => {
    const actor = makeClientActor();
    await expect(listAuditLog(actor, {})).rejects.toBeInstanceOf(AuthzError);
  });
});

// ---------------------------------------------------------------------------
// exportAuditCsv
// ---------------------------------------------------------------------------

describe("exportAuditCsv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns CSV string with header row", async () => {
    const actor = makeAdminActor();
    vi.mocked(listAuditLogRows).mockResolvedValueOnce({
      items: [
        {
          id: "log-1",
          created_at: "2026-06-01T00:00:00Z",
          actor_user_id: actor.userId,
          action: "catalog.service.created",
          entity_type: "services",
          entity_id: "svc-1",
          org_id: actor.orgId,
          diff: { after: { slug: "asilo" } },
          ip: null,
        },
      ],
      nextCursor: null,
    });

    const csv = await exportAuditCsv(actor, {});
    expect(csv).toContain("id,created_at");
    expect(csv).toContain("log-1");
    expect(csv).toContain("catalog.service.created");
  });

  it("escapes commas and quotes in CSV values", async () => {
    const actor = makeAdminActor();
    vi.mocked(listAuditLogRows).mockResolvedValueOnce({
      items: [
        {
          id: "log-2",
          created_at: "2026-06-01T00:00:00Z",
          actor_user_id: null,
          action: 'test, "action"',
          entity_type: "services",
          entity_id: null,
          org_id: actor.orgId,
          diff: null,
          ip: null,
        },
      ],
      nextCursor: null,
    });

    const csv = await exportAuditCsv(actor, {});
    expect(csv).toContain('"test, ""action"""');
  });

  it("denies non-audit staff", async () => {
    const actor = makeStaffActor({});
    await expect(exportAuditCsv(actor, {})).rejects.toBeInstanceOf(AuthzError);
  });

  it("H-1: neutralizes Excel formula injection prefix '='", async () => {
    const actor = makeAdminActor();
    vi.mocked(listAuditLogRows).mockResolvedValueOnce({
      items: [
        {
          id: "log-3",
          created_at: "2026-06-01T00:00:00Z",
          actor_user_id: actor.userId,
          action: "=cmd(|' /C calc'!A0)",
          entity_type: "services",
          entity_id: "svc-1",
          org_id: actor.orgId,
          diff: null,
          ip: null,
        },
      ],
      nextCursor: null,
    });

    const csv = await exportAuditCsv(actor, {});
    // The cell must be quoted and must start with a tab prefix (not a raw '=')
    // so spreadsheet parsers do not execute it as a formula.
    const actionCell = csv.split("\n")[1]?.split(",")[3] ?? "";
    expect(actionCell).not.toMatch(/^=/);
    // The tab-prefixed value should be wrapped in quotes
    expect(actionCell.startsWith('"')).toBe(true);
  });

  it("H-1: neutralizes '+', '-', '@', tab prefixes", async () => {
    const actor = makeAdminActor();
    const dangerousActions = ["+malicious", "-drop", "@ref", "\tcmd"];
    for (const action of dangerousActions) {
      vi.mocked(listAuditLogRows).mockResolvedValueOnce({
        items: [
          {
            id: `log-inject-${action[0]}`,
            created_at: "2026-06-01T00:00:00Z",
            actor_user_id: actor.userId,
            action,
            entity_type: "t",
            entity_id: null,
            org_id: actor.orgId,
            diff: null,
            ip: null,
          },
        ],
        nextCursor: null,
      });
      const csv = await exportAuditCsv(actor, {});
      const actionCell = csv.split("\n")[1]?.split(",")[3] ?? "";
      // Must not start with the formula-injection character unquoted
      expect(actionCell.charAt(0)).not.toBe(action[0]);
    }
  });
});
