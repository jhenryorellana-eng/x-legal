/**
 * TDD tests for platform/authz.ts — DOC-22 §5.2 (can() unit tests).
 *
 * Tests cover:
 * - admin role bypasses all module checks
 * - edit action implies view (RF-ADM-045)
 * - module not in permissions map throws AuthzError('forbidden_module')
 * - client kind throws AuthzError('wrong_kind')
 * - can_view=true allows view action
 * - can_view=false, can_edit=false → forbidden_module
 * - can_edit=false → forbidden for edit even when can_view=true
 */

import { describe, it, expect } from "vitest";

// Set up minimal env before importing
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.NEXT_PUBLIC_APP_URL = "https://test.example.com";
process.env.ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const { can, AuthzError, systemActor } = await import("../authz.js");

import type { Actor } from "../authz";
import type { ModuleKey } from "@/shared/constants/modules";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStaffActor(
  role: Actor["role"],
  permissions: Partial<Record<ModuleKey, { view: boolean; edit: boolean }>>,
): Actor {
  return {
    userId: "user-001",
    orgId: "org-001",
    kind: "staff",
    role,
    permissions: new Map(
      Object.entries(permissions) as [ModuleKey, { view: boolean; edit: boolean }][],
    ),
  };
}

function makeClientActor(): Actor {
  return {
    userId: "user-client-001",
    orgId: "org-001",
    kind: "client",
    role: null,
    permissions: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("can() — admin bypass", () => {
  it("admin can view any module regardless of permissions map", () => {
    const actor = makeStaffActor("admin", {});
    expect(() => can(actor, "billing", "view")).not.toThrow();
  });

  it("admin can edit any module regardless of permissions map", () => {
    const actor = makeStaffActor("admin", {});
    expect(() => can(actor, "audit", "edit")).not.toThrow();
  });

  it("admin bypasses even modules not in the map", () => {
    const actor = makeStaffActor("admin", {});
    expect(() => can(actor, "employees", "edit")).not.toThrow();
    expect(() => can(actor, "dashboard", "view")).not.toThrow();
  });
});

describe("can() — wrong kind (client actors)", () => {
  it("throws wrong_kind for a client trying to use can()", () => {
    const actor = makeClientActor();
    expect(() => can(actor, "cases", "view")).toThrowError(
      expect.objectContaining({ reason: "wrong_kind" }),
    );
  });

  it("throws wrong_kind regardless of module for clients", () => {
    const actor = makeClientActor();
    expect(() => can(actor, "billing", "edit")).toThrowError(
      expect.objectContaining({ reason: "wrong_kind" }),
    );
  });
});

describe("can() — non-admin staff with permissions", () => {
  it("view action succeeds when can_view=true", () => {
    const actor = makeStaffActor("paralegal", {
      cases: { view: true, edit: false },
    });
    expect(() => can(actor, "cases", "view")).not.toThrow();
  });

  it("view action succeeds when can_edit=true (edit implies view — RF-ADM-045)", () => {
    const actor = makeStaffActor("paralegal", {
      cases: { view: false, edit: true },
    });
    expect(() => can(actor, "cases", "view")).not.toThrow();
  });

  it("edit action succeeds when can_edit=true", () => {
    const actor = makeStaffActor("paralegal", {
      cases: { view: true, edit: true },
    });
    expect(() => can(actor, "cases", "edit")).not.toThrow();
  });

  it("edit action fails when can_edit=false, even with can_view=true", () => {
    const actor = makeStaffActor("sales", {
      cases: { view: true, edit: false },
    });
    expect(() => can(actor, "cases", "edit")).toThrowError(
      expect.objectContaining({ reason: "forbidden_module" }),
    );
  });

  it("throws forbidden_module when module not in permissions map", () => {
    const actor = makeStaffActor("finance", {
      billing: { view: true, edit: true },
    });
    expect(() => can(actor, "catalog", "view")).toThrowError(
      expect.objectContaining({ reason: "forbidden_module" }),
    );
  });

  it("throws forbidden_module when can_view=false and can_edit=false", () => {
    const actor = makeStaffActor("sales", {
      leads: { view: false, edit: false },
    });
    expect(() => can(actor, "leads", "view")).toThrowError(
      expect.objectContaining({ reason: "forbidden_module" }),
    );
  });
});

describe("can() — never returns false (always void or throws)", () => {
  it("returns undefined (void) on success", () => {
    const actor = makeStaffActor("admin", {});
    const result = can(actor, "dashboard", "view");
    expect(result).toBeUndefined();
  });
});

describe("AuthzError", () => {
  it("is an instance of Error", () => {
    const err = new AuthzError("forbidden_module");
    expect(err).toBeInstanceOf(Error);
  });

  it("exposes reason as a property", () => {
    const err = new AuthzError("unauthenticated");
    expect(err.reason).toBe("unauthenticated");
  });

  it("message equals the reason string", () => {
    const err = new AuthzError("inactive");
    expect(err.message).toBe("inactive");
  });
});

describe("systemActor()", () => {
  it("returns a staff actor with admin role", () => {
    const actor = systemActor();
    expect(actor.kind).toBe("staff");
    expect(actor.role).toBe("admin");
  });

  it("system actor passes can() for any module", () => {
    const actor = systemActor();
    expect(() => can(actor, "audit", "edit")).not.toThrow();
    expect(() => can(actor, "employees", "view")).not.toThrow();
  });
});
