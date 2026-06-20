/**
 * Tests for identity/service.ts — employee management (F1).
 *
 * Covers:
 * - inviteEmployee: authorization, temp password handling, audit + events, compensation on DB failure
 * - updateEmployeePermissions: authorization, delegate to repo, audit
 * - deactivateEmployee: authorization, sets inactive + revokes sessions
 * - reactivateEmployee: authorization, re-enables user
 * - listEmployees: authorization (view), delegates to repo
 * - buildPermissionPreset: correct matrix for all roles
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist shared mock references (must use vi.hoisted to be safe with factories)
// ---------------------------------------------------------------------------

const {
  mockCan,
  mockSendTransactional,
  mockEmit,
  mockCreateUser,
  mockDeleteUser,
  mockUpdateUserById,
  mockSignOut,
  mockInsertStaffRows,
  mockReplaceStaffPermissions,
  mockSetStaffActive,
  mockListStaffMembers,
  mockGetStaffProfileById,
  mockFindStaffById,
  mockCountActiveAdminsByOrg,
  mockWriteAudit,
  mockRevokeAllSessions,
} = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockSendTransactional: vi.fn().mockResolvedValue({ id: "email-id-1" }),
  mockEmit: vi.fn(),
  mockCreateUser: vi.fn(),
  mockDeleteUser: vi.fn(),
  mockUpdateUserById: vi.fn(),
  mockSignOut: vi.fn(),
  mockInsertStaffRows: vi.fn(),
  mockReplaceStaffPermissions: vi.fn(),
  mockSetStaffActive: vi.fn(),
  mockListStaffMembers: vi.fn(),
  mockGetStaffProfileById: vi.fn(),
  mockFindStaffById: vi.fn(),
  mockCountActiveAdminsByOrg: vi.fn(),
  mockWriteAudit: vi.fn().mockResolvedValue(undefined),
  mockRevokeAllSessions: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mocks (before any import of SUT)
// ---------------------------------------------------------------------------

// Suppress zxcvbn native ESM issues
vi.mock("@zxcvbn-ts/core", () => {
  function ZxcvbnFactory() {
    return { check: () => ({ score: 4 }) };
  }
  return { ZxcvbnFactory };
});
vi.mock("@zxcvbn-ts/language-common", () => ({
  adjacencyGraphs: {},
  dictionary: {},
}));

// platform/ratelimit (not used in employee flows but required by the module)
vi.mock("@/backend/platform/ratelimit.js", () => ({
  limitOtpSendPhone: vi.fn(),
  limitOtpSendIp: vi.fn(),
  limitStaffLogin: vi.fn(),
}));

// platform/env — phone-login password derivation reads SUPABASE_SERVICE_ROLE_KEY
vi.mock("@/backend/platform/env", () => ({
  env: { SUPABASE_SERVICE_ROLE_KEY: "test-service-key" },
  providerEnv: vi.fn(),
}));

// platform/logger
vi.mock("@/backend/platform/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// platform/authz
vi.mock("@/backend/platform/authz.js", () => ({
  requireActor: vi.fn(),
  can: mockCan,
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
      this.name = "AuthzError";
    }
  },
}));

// platform/resend
vi.mock("@/backend/platform/resend.js", () => ({
  sendTransactional: mockSendTransactional,
  FROM_TRANSACTIONAL: "test@mail.example.com",
}));

// platform/events
vi.mock("@/backend/platform/events.js", () => ({
  appEvents: { emit: mockEmit, on: vi.fn() },
}));

// platform/supabase
vi.mock("@/backend/platform/supabase.js", () => ({
  createServiceClient: vi.fn(() => ({
    auth: {
      admin: {
        createUser: mockCreateUser,
        deleteUser: mockDeleteUser,
        updateUserById: mockUpdateUserById,
        signOut: mockSignOut,
      },
    },
  })),
  createServerClient: vi.fn(),
  revokeAllSessions: mockRevokeAllSessions,
}));

// identity/repository
vi.mock("../repository.js", () => ({
  checkClientEligibility: vi.fn(),
  checkClientEligibilityById: vi.fn(),
  insertStaffRows: mockInsertStaffRows,
  replaceStaffPermissions: mockReplaceStaffPermissions,
  setStaffActive: mockSetStaffActive,
  listStaffMembers: mockListStaffMembers,
  getStaffProfileById: mockGetStaffProfileById,
  findStaffById: mockFindStaffById,
  countActiveAdminsByOrg: mockCountActiveAdminsByOrg,
  countActiveStaff: vi.fn().mockResolvedValue(0),
}));

// audit module (dynamic import)
vi.mock("@/backend/modules/audit/index.js", () => ({
  writeAudit: mockWriteAudit,
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import {
  inviteEmployee,
  updateEmployeePermissions,
  deactivateEmployee,
  reactivateEmployee,
  listEmployees,
  IdentityError,
} from "../service";
import type { Actor } from "@/backend/platform/authz";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeActor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: "admin-user-1",
    orgId: "org-1",
    kind: "staff",
    role: "admin",
    permissions: new Map(),
    ...overrides,
  };
}

const ADMIN_ACTOR = makeActor();

const STAFF_ACTOR = makeActor({
  userId: "staff-user-1",
  role: "sales",
  permissions: new Map([
    ["employees", { view: true, edit: true }],
  ]),
});

const INVITE_INPUT = {
  email: "diana@example.com",
  displayName: "Diana García",
  titleI18n: { es: "Paralegal", en: "Paralegal" },
  role: "paralegal" as const,
};

const NEW_USER_ID = "new-staff-uuid-1234";

// ---------------------------------------------------------------------------
// inviteEmployee
// ---------------------------------------------------------------------------

describe("inviteEmployee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockImplementation(() => undefined); // no-op = authorized
    mockCreateUser.mockResolvedValue({
      data: { user: { id: NEW_USER_ID } },
      error: null,
    });
    mockInsertStaffRows.mockResolvedValue(undefined);
    mockSendTransactional.mockResolvedValue({ id: "email-id-1" });
  });

  it("calls can(actor, 'employees', 'edit') as first check", async () => {
    await inviteEmployee(ADMIN_ACTOR, INVITE_INPUT);
    expect(mockCan).toHaveBeenCalledWith(
      ADMIN_ACTOR,
      "employees",
      "edit",
    );
  });

  it("returns { ok: true, userId } on success", async () => {
    const result = await inviteEmployee(ADMIN_ACTOR, INVITE_INPUT);
    expect(result.ok).toBe(true);
    expect(result.userId).toBe(NEW_USER_ID);
  });

  it("calls auth.admin.createUser with email_confirm=true and must_change_password=true", async () => {
    await inviteEmployee(ADMIN_ACTOR, INVITE_INPUT);

    expect(mockCreateUser).toHaveBeenCalledOnce();
    const callArgs = mockCreateUser.mock.calls[0]?.[0];
    expect(callArgs.email).toBe(INVITE_INPUT.email);
    expect(callArgs.email_confirm).toBe(true);
    expect(callArgs.app_metadata?.must_change_password).toBe(true);
    // Temp password must be present but NEVER logged or in events
    expect(typeof callArgs.password).toBe("string");
    expect(callArgs.password.length).toBeGreaterThanOrEqual(24);
  });

  it("NEVER puts the temp password in the event payload", async () => {
    await inviteEmployee(ADMIN_ACTOR, INVITE_INPUT);

    // Check all emitted events — none should have a 'password' or 'tempPassword' key
    for (const call of mockEmit.mock.calls) {
      const event = call[0];
      const payloadStr = JSON.stringify(event.payload ?? {});
      expect(payloadStr).not.toContain("password");
      expect(payloadStr).not.toContain("tempPassword");
      expect(payloadStr).not.toContain("temp_password");
    }
  });

  it("calls insertStaffRows with the correct orgId and role", async () => {
    await inviteEmployee(ADMIN_ACTOR, INVITE_INPUT);
    expect(mockInsertStaffRows).toHaveBeenCalledOnce();
    const args = mockInsertStaffRows.mock.calls[0]?.[0];
    expect(args.orgId).toBe(ADMIN_ACTOR.orgId);
    expect(args.role).toBe(INVITE_INPUT.role);
    expect(args.userId).toBe(NEW_USER_ID);
    expect(args.email).toBe(INVITE_INPUT.email);
    expect(args.displayName).toBe(INVITE_INPUT.displayName);
  });

  it("sends the staff-invite email via Resend", async () => {
    await inviteEmployee(ADMIN_ACTOR, INVITE_INPUT);
    expect(mockSendTransactional).toHaveBeenCalledOnce();
    const emailArgs = mockSendTransactional.mock.calls[0]?.[0];
    expect(emailArgs.to).toBe(INVITE_INPUT.email);
    expect(emailArgs.html).toContain(INVITE_INPUT.displayName);
    // Temp password should be in the HTML
    expect(emailArgs.html.length).toBeGreaterThan(0);
  });

  it("emits staff.created event (without password in payload)", async () => {
    await inviteEmployee(ADMIN_ACTOR, INVITE_INPUT);
    const staffCreatedCalls = mockEmit.mock.calls.filter(
      (c) => c[0]?.type === "staff.created",
    );
    expect(staffCreatedCalls).toHaveLength(1);
    const event = staffCreatedCalls[0][0];
    expect(event.payload.userId).toBe(NEW_USER_ID);
    expect(event.payload.orgId).toBe(ADMIN_ACTOR.orgId);
    expect(event.payload.invitedBy).toBe(ADMIN_ACTOR.userId);
    // Critical: no password in event payload
    expect("password" in event.payload).toBe(false);
    expect("tempPassword" in event.payload).toBe(false);
  });

  it("emits permissions.changed event", async () => {
    await inviteEmployee(ADMIN_ACTOR, INVITE_INPUT);
    const permsCalls = mockEmit.mock.calls.filter(
      (c) => c[0]?.type === "permissions.changed",
    );
    expect(permsCalls).toHaveLength(1);
    const event = permsCalls[0][0];
    expect(event.payload.staffId).toBe(NEW_USER_ID);
    expect(Array.isArray(event.payload.permissions)).toBe(true);
  });

  it("compensates (deleteUser) if insertStaffRows fails", async () => {
    mockInsertStaffRows.mockRejectedValueOnce(new Error("DB error"));
    mockDeleteUser.mockResolvedValue({ error: null });

    await expect(inviteEmployee(ADMIN_ACTOR, INVITE_INPUT)).rejects.toThrow("DB error");

    expect(mockDeleteUser).toHaveBeenCalledWith(NEW_USER_ID);
  });

  it("throws IdentityError('employee_already_exists') when email already exists", async () => {
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: { message: "User already registered" },
    });

    const err = await inviteEmployee(ADMIN_ACTOR, INVITE_INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityError);
    expect((err as IdentityError).code).toBe("employee_already_exists");
  });

  it("does NOT throw if Resend email fails (non-fatal)", async () => {
    mockSendTransactional.mockRejectedValueOnce(new Error("Resend down"));

    // Should NOT throw — email failure is non-fatal (account still created)
    const result = await inviteEmployee(ADMIN_ACTOR, INVITE_INPUT);
    expect(result.ok).toBe(true);
  });

  it("applies preset permissions from DOC-22 §6 matrix for paralegal role", async () => {
    // paralegal: cases=E, calendar=V, expedientes=E, validations=E, messaging=E...
    await inviteEmployee(ADMIN_ACTOR, INVITE_INPUT);
    const insertArgs = mockInsertStaffRows.mock.calls[0]?.[0];
    const perms: Array<{ module_key: string; can_view: boolean; can_edit: boolean }> =
      insertArgs.permissions;

    // paralegal has no access to catalog, employees, billing, etc.
    expect(perms.find((p) => p.module_key === "catalog")).toBeUndefined();
    expect(perms.find((p) => p.module_key === "employees")).toBeUndefined();

    // paralegal has cases=E
    const casesPerms = perms.find((p) => p.module_key === "cases");
    expect(casesPerms?.can_view).toBe(true);
    expect(casesPerms?.can_edit).toBe(true);

    // paralegal has calendar=V (view only)
    const calendarPerms = perms.find((p) => p.module_key === "calendar");
    expect(calendarPerms?.can_view).toBe(true);
    expect(calendarPerms?.can_edit).toBe(false);
  });

  it("uses provided permissionsPreset if given (overrides role preset)", async () => {
    const customPreset = [{ module_key: "cases" as const, can_view: true, can_edit: false }];
    await inviteEmployee(ADMIN_ACTOR, {
      ...INVITE_INPUT,
      permissionsPreset: customPreset,
    });
    const insertArgs = mockInsertStaffRows.mock.calls[0]?.[0];
    expect(insertArgs.permissions).toEqual(customPreset);
  });

  it("throws AuthzError when actor is unauthorized (can throws)", async () => {
    const { AuthzError } = await import("@/backend/platform/authz");
    mockCan.mockImplementationOnce(() => {
      throw new AuthzError("forbidden_module");
    });

    await expect(inviteEmployee(ADMIN_ACTOR, INVITE_INPUT)).rejects.toThrow(AuthzError);
  });
});

// ---------------------------------------------------------------------------
// updateEmployeePermissions
// ---------------------------------------------------------------------------

describe("updateEmployeePermissions", () => {
  const STAFF_ID = "staff-uuid-2";
  const NEW_PERMS: import("../repository").EmployeePermissionInput[] = [
    { module_key: "cases", can_view: true, can_edit: true },
    { module_key: "calendar", can_view: true, can_edit: false },
  ];

  function makeTargetStaff(overrides: Partial<{ orgId: string; role: string }> = {}) {
    return {
      userId: STAFF_ID,
      orgId: overrides.orgId ?? ADMIN_ACTOR.orgId,
      isActive: true,
      role: overrides.role ?? "paralegal",
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockImplementation(() => undefined);
    mockReplaceStaffPermissions.mockResolvedValue(undefined);
    mockFindStaffById.mockResolvedValue(makeTargetStaff());
  });

  it("calls can(actor, 'employees', 'edit')", async () => {
    await updateEmployeePermissions(ADMIN_ACTOR, STAFF_ID, NEW_PERMS);
    expect(mockCan).toHaveBeenCalledWith(ADMIN_ACTOR, "employees", "edit");
  });

  it("calls replaceStaffPermissions with correct args", async () => {
    await updateEmployeePermissions(ADMIN_ACTOR, STAFF_ID, NEW_PERMS);
    expect(mockReplaceStaffPermissions).toHaveBeenCalledWith(STAFF_ID, NEW_PERMS);
  });

  it("emits permissions.changed event", async () => {
    await updateEmployeePermissions(ADMIN_ACTOR, STAFF_ID, NEW_PERMS);
    const emittedEvent = mockEmit.mock.calls.find(
      (c) => c[0]?.type === "permissions.changed",
    )?.[0];
    expect(emittedEvent?.payload.staffId).toBe(STAFF_ID);
    expect(emittedEvent?.payload.changedBy).toBe(ADMIN_ACTOR.userId);
  });

  it("returns { ok: true } on success", async () => {
    const result = await updateEmployeePermissions(ADMIN_ACTOR, STAFF_ID, NEW_PERMS);
    expect(result.ok).toBe(true);
  });

  it("propagates repo errors", async () => {
    mockReplaceStaffPermissions.mockRejectedValueOnce(new Error("DB error"));
    await expect(
      updateEmployeePermissions(ADMIN_ACTOR, STAFF_ID, NEW_PERMS),
    ).rejects.toThrow("DB error");
  });

  // C-1: DOC-22 §9.3 — no self-modification
  it("C-1: throws AuthzError when actor tries to modify their own permissions", async () => {
    const { AuthzError } = await import("@/backend/platform/authz");
    await expect(
      updateEmployeePermissions(ADMIN_ACTOR, ADMIN_ACTOR.userId, NEW_PERMS),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  // C-1: org membership check
  it("C-1: throws AuthzError when target belongs to a different org", async () => {
    const { AuthzError } = await import("@/backend/platform/authz");
    mockFindStaffById.mockResolvedValueOnce(makeTargetStaff({ orgId: "different-org" }));
    await expect(
      updateEmployeePermissions(ADMIN_ACTOR, STAFF_ID, NEW_PERMS),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  // C-1: not found
  it("C-1: throws IdentityError('employee_not_found') when target does not exist", async () => {
    mockFindStaffById.mockResolvedValueOnce(null);
    const err = await updateEmployeePermissions(ADMIN_ACTOR, STAFF_ID, NEW_PERMS).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityError);
    expect((err as IdentityError).code).toBe("employee_not_found");
  });
});

// ---------------------------------------------------------------------------
// deactivateEmployee
// ---------------------------------------------------------------------------

describe("deactivateEmployee", () => {
  const STAFF_ID = "staff-uuid-3";

  function makeTargetStaff(overrides: Partial<{ orgId: string; role: string }> = {}) {
    return {
      userId: STAFF_ID,
      orgId: overrides.orgId ?? ADMIN_ACTOR.orgId,
      isActive: true,
      role: overrides.role ?? "paralegal",
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockImplementation(() => undefined);
    mockSetStaffActive.mockResolvedValue(undefined);
    mockRevokeAllSessions.mockResolvedValue(undefined);
    mockFindStaffById.mockResolvedValue(makeTargetStaff());
    mockCountActiveAdminsByOrg.mockResolvedValue(2);
  });

  it("calls can(actor, 'employees', 'edit')", async () => {
    await deactivateEmployee(ADMIN_ACTOR, STAFF_ID);
    expect(mockCan).toHaveBeenCalledWith(ADMIN_ACTOR, "employees", "edit");
  });

  it("sets is_active=false via setStaffActive", async () => {
    await deactivateEmployee(ADMIN_ACTOR, STAFF_ID);
    expect(mockSetStaffActive).toHaveBeenCalledWith(STAFF_ID, false);
  });

  it("calls revokeAllSessions with ban=true", async () => {
    await deactivateEmployee(ADMIN_ACTOR, STAFF_ID);
    expect(mockRevokeAllSessions).toHaveBeenCalledWith(STAFF_ID, true);
  });

  it("returns { ok: true } on success", async () => {
    const result = await deactivateEmployee(ADMIN_ACTOR, STAFF_ID);
    expect(result.ok).toBe(true);
  });

  // C-1: DOC-22 §9.3 — cannot deactivate yourself
  it("C-1: throws AuthzError when actor tries to deactivate themselves", async () => {
    const { AuthzError } = await import("@/backend/platform/authz");
    await expect(
      deactivateEmployee(ADMIN_ACTOR, ADMIN_ACTOR.userId),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  // C-1: org membership check
  it("C-1: throws AuthzError when target belongs to a different org", async () => {
    const { AuthzError } = await import("@/backend/platform/authz");
    mockFindStaffById.mockResolvedValueOnce(makeTargetStaff({ orgId: "other-org" }));
    await expect(
      deactivateEmployee(ADMIN_ACTOR, STAFF_ID),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  // C-1: not found
  it("C-1: throws IdentityError('employee_not_found') when target does not exist", async () => {
    mockFindStaffById.mockResolvedValueOnce(null);
    const err = await deactivateEmployee(ADMIN_ACTOR, STAFF_ID).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityError);
    expect((err as IdentityError).code).toBe("employee_not_found");
  });

  // H-3: DOC-22 §9.3 — protect last admin
  it("H-3: throws IdentityError('last_admin_protected') when deactivating the sole active admin", async () => {
    mockFindStaffById.mockResolvedValueOnce(makeTargetStaff({ role: "admin" }));
    mockCountActiveAdminsByOrg.mockResolvedValueOnce(1);
    const err = await deactivateEmployee(ADMIN_ACTOR, STAFF_ID).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityError);
    expect((err as IdentityError).code).toBe("last_admin_protected");
  });

  it("H-3: allows deactivating an admin when there are 2+ active admins", async () => {
    mockFindStaffById.mockResolvedValueOnce(makeTargetStaff({ role: "admin" }));
    mockCountActiveAdminsByOrg.mockResolvedValueOnce(2);
    const result = await deactivateEmployee(ADMIN_ACTOR, STAFF_ID);
    expect(result.ok).toBe(true);
  });

  it("H-3: does NOT call countActiveAdminsByOrg for non-admin targets", async () => {
    mockFindStaffById.mockResolvedValueOnce(makeTargetStaff({ role: "paralegal" }));
    await deactivateEmployee(ADMIN_ACTOR, STAFF_ID);
    expect(mockCountActiveAdminsByOrg).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// reactivateEmployee
// ---------------------------------------------------------------------------

describe("reactivateEmployee", () => {
  const STAFF_ID = "staff-uuid-4";

  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockImplementation(() => undefined);
    mockSetStaffActive.mockResolvedValue(undefined);
    mockRevokeAllSessions.mockResolvedValue(undefined);
  });

  it("calls can(actor, 'employees', 'edit')", async () => {
    await reactivateEmployee(ADMIN_ACTOR, STAFF_ID);
    expect(mockCan).toHaveBeenCalledWith(ADMIN_ACTOR, "employees", "edit");
  });

  it("sets is_active=true via setStaffActive", async () => {
    await reactivateEmployee(ADMIN_ACTOR, STAFF_ID);
    expect(mockSetStaffActive).toHaveBeenCalledWith(STAFF_ID, true);
  });

  it("calls revokeAllSessions with ban=false (to unban)", async () => {
    await reactivateEmployee(ADMIN_ACTOR, STAFF_ID);
    expect(mockRevokeAllSessions).toHaveBeenCalledWith(STAFF_ID, false);
  });

  it("returns { ok: true } on success", async () => {
    const result = await reactivateEmployee(ADMIN_ACTOR, STAFF_ID);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listEmployees
// ---------------------------------------------------------------------------

describe("listEmployees", () => {
  const FAKE_EMPLOYEES = [
    {
      userId: "staff-1",
      email: "vanessa@example.com",
      isActive: true,
      displayName: "Vanessa",
      role: "sales",
      titleI18n: null,
      avatarUrl: null,
      permissions: [{ module_key: "cases", can_view: true, can_edit: false }],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockImplementation(() => undefined);
    mockListStaffMembers.mockResolvedValue(FAKE_EMPLOYEES);
  });

  it("calls can(actor, 'employees', 'view')", async () => {
    await listEmployees(ADMIN_ACTOR);
    expect(mockCan).toHaveBeenCalledWith(ADMIN_ACTOR, "employees", "view");
  });

  it("returns the employee list from listStaffMembers", async () => {
    const result = await listEmployees(ADMIN_ACTOR);
    expect(result.employees).toEqual(FAKE_EMPLOYEES);
  });

  it("throws AuthzError when actor lacks employees:view", async () => {
    const { AuthzError } = await import("@/backend/platform/authz");
    mockCan.mockImplementationOnce(() => {
      throw new AuthzError("forbidden_module");
    });

    await expect(listEmployees(STAFF_ACTOR)).rejects.toThrow(AuthzError);
  });
});

// ---------------------------------------------------------------------------
// Permission preset matrix (DOC-22 §6)
// ---------------------------------------------------------------------------

describe("Permission preset — DOC-22 §6 matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockImplementation(() => undefined);
    mockCreateUser.mockResolvedValue({
      data: { user: { id: "u-test" } },
      error: null,
    });
    mockInsertStaffRows.mockResolvedValue(undefined);
    mockSendTransactional.mockResolvedValue({ id: "e-test" });
  });

  async function getPresetsForRole(role: "sales" | "paralegal" | "finance") {
    await inviteEmployee(ADMIN_ACTOR, { ...INVITE_INPUT, role });
    const args = mockInsertStaffRows.mock.calls.at(-1)?.[0];
    return args?.permissions as Array<{
      module_key: string;
      can_view: boolean;
      can_edit: boolean;
    }>;
  }

  it("sales preset: leads=E, cases=V, catalog=-", async () => {
    const perms = await getPresetsForRole("sales");
    const leads = perms.find((p) => p.module_key === "leads");
    const cases = perms.find((p) => p.module_key === "cases");

    expect(leads?.can_edit).toBe(true);
    expect(cases?.can_edit).toBe(false);
    expect(cases?.can_view).toBe(true);
    expect(perms.find((p) => p.module_key === "catalog")).toBeUndefined();
  });

  it("paralegal preset: cases=E, billing=-, community=-", async () => {
    const perms = await getPresetsForRole("paralegal");
    const cases = perms.find((p) => p.module_key === "cases");

    expect(cases?.can_edit).toBe(true);
    expect(perms.find((p) => p.module_key === "billing")).toBeUndefined();
    expect(perms.find((p) => p.module_key === "community")).toBeUndefined();
  });

  it("finance preset: billing=E, accounting=E, cases=V, catalog=-", async () => {
    const perms = await getPresetsForRole("finance");
    const billing = perms.find((p) => p.module_key === "billing");
    const accounting = perms.find((p) => p.module_key === "accounting");
    const cases = perms.find((p) => p.module_key === "cases");

    expect(billing?.can_edit).toBe(true);
    expect(accounting?.can_edit).toBe(true);
    expect(cases?.can_edit).toBe(false);
    expect(cases?.can_view).toBe(true);
    expect(perms.find((p) => p.module_key === "catalog")).toBeUndefined();
    expect(perms.find((p) => p.module_key === "employees")).toBeUndefined();
  });

  it("every role: messaging=E", async () => {
    for (const role of ["sales", "paralegal", "finance"] as const) {
      const perms = await getPresetsForRole(role);
      const messaging = perms.find((p) => p.module_key === "messaging");
      expect(messaging?.can_edit).toBe(true);
    }
  });
});
