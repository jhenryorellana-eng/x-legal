/**
 * demo-assets service — unit tests.
 *
 * Storage is the source of truth (deterministic paths, no table), so the tests
 * pin the contract with platform/storage: exact bucket + path, upsert on
 * upload, 50 MiB cap on confirm, per-slot resilience of getDemoAssetUrls, and
 * the hard admin-only gate on every entry point.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Actor } from "@/backend/platform/authz";

const mocks = vi.hoisted(() => ({
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
  validateUploadedObject: vi.fn(),
  deleteObject: vi.fn(),
  listObjects: vi.fn(),
  writeAudit: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Lightweight authz mock (repo convention): importing the real module pulls
// supabase.ts → env.ts, whose Zod parse fails without a configured env.
vi.mock("@/backend/platform/authz", () => ({
  AuthzError: class AuthzError extends Error {
    reason: string;
    constructor(reason: string) {
      super(reason);
      this.reason = reason;
      this.name = "AuthzError";
    }
  },
}));
vi.mock("@/backend/platform/storage", () => ({
  createSignedUploadUrl: mocks.createSignedUploadUrl,
  createSignedDownloadUrl: mocks.createSignedDownloadUrl,
  validateUploadedObject: mocks.validateUploadedObject,
  deleteObject: mocks.deleteObject,
  listObjects: mocks.listObjects,
}));
vi.mock("@/backend/modules/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/backend/platform/logger", () => ({ logger: mocks.logger }));

import {
  confirmDemoAssetUpload,
  createDemoAssetUploadUrl,
  deleteDemoAsset,
  getDemoAssetUrls,
  listDemoAssetStatus,
} from "../service";

function makeStaffActor(role: Actor["role"]): Actor {
  return {
    userId: "user-001",
    orgId: "org-001",
    kind: "staff",
    role,
    permissions: new Map(),
  };
}

const admin = makeStaffActor("admin");
const SLUG = "asilo-politico";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listObjects.mockResolvedValue([]);
});

describe("admin-only gate", () => {
  it("rejects every non-admin staff role and clients on all entry points", async () => {
    const nonAdmins: Actor[] = [
      makeStaffActor("sales"),
      makeStaffActor("paralegal"),
      makeStaffActor("finance"),
      { userId: "client-1", orgId: "org-001", kind: "client", role: null, permissions: new Map() },
    ];

    for (const actor of nonAdmins) {
      const forbidden = expect.objectContaining({ reason: "forbidden_module" });
      await expect(listDemoAssetStatus(actor, SLUG)).rejects.toEqual(forbidden);
      await expect(createDemoAssetUploadUrl(actor, { slug: SLUG, slotKey: "i589" })).rejects.toEqual(forbidden);
      await expect(confirmDemoAssetUpload(actor, { slug: SLUG, slotKey: "i589" })).rejects.toEqual(forbidden);
      await expect(deleteDemoAsset(actor, { slug: SLUG, slotKey: "i589" })).rejects.toEqual(forbidden);
      await expect(getDemoAssetUrls(actor, SLUG)).rejects.toEqual(forbidden);
    }
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
    expect(mocks.listObjects).not.toHaveBeenCalled();
  });
});

describe("slot validation", () => {
  it("rejects an unknown scenario", async () => {
    await expect(listDemoAssetStatus(admin, "no-such-demo")).rejects.toEqual(
      expect.objectContaining({ code: "unknown_scenario" }),
    );
  });

  it("rejects an unknown slot key", async () => {
    await expect(
      createDemoAssetUploadUrl(admin, { slug: SLUG, slotKey: "nope" }),
    ).rejects.toEqual(expect.objectContaining({ code: "unknown_slot" }));
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe("createDemoAssetUploadUrl", () => {
  it("requests an upsert signed URL at the deterministic path", async () => {
    mocks.createSignedUploadUrl.mockResolvedValue({
      signedUrl: "https://signed/upload",
      path: "demo/asilo-politico/i589.pdf",
    });

    const result = await createDemoAssetUploadUrl(admin, { slug: SLUG, slotKey: "i589" });

    expect(mocks.createSignedUploadUrl).toHaveBeenCalledWith(
      "catalog-assets",
      "demo/asilo-politico/i589.pdf",
      { upsert: true },
    );
    expect(result.signedUrl).toBe("https://signed/upload");
  });
});

describe("confirmDemoAssetUpload", () => {
  it("validates with the catalog-assets context and the 50 MiB cap, then audits", async () => {
    mocks.validateUploadedObject.mockResolvedValue({ ok: true, bytes: Buffer.alloc(1234) });

    const status = await confirmDemoAssetUpload(admin, { slug: SLUG, slotKey: "memo" });

    expect(mocks.validateUploadedObject).toHaveBeenCalledWith(
      "catalog-assets",
      "demo/asilo-politico/memo.pdf",
      "catalog-assets",
      { maxBytes: 50 * 1024 * 1024 },
    );
    expect(status).toMatchObject({ key: "memo", uploaded: true, sizeBytes: 1234 });
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      admin,
      "demo_assets.uploaded",
      "demo_asset",
      "asilo-politico/memo",
      { after: { sizeBytes: 1234 } },
    );
  });

  it("maps a failed validation to invalid_file and does NOT audit", async () => {
    mocks.validateUploadedObject.mockResolvedValue({ ok: false, reason: "spoofed" });

    await expect(
      confirmDemoAssetUpload(admin, { slug: SLUG, slotKey: "memo" }),
    ).rejects.toEqual(expect.objectContaining({ code: "invalid_file" }));
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
});

describe("deleteDemoAsset", () => {
  it("removes the object and audits", async () => {
    await deleteDemoAsset(admin, { slug: SLUG, slotKey: "expediente" });

    expect(mocks.deleteObject).toHaveBeenCalledWith(
      "catalog-assets",
      "demo/asilo-politico/expediente.pdf",
    );
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      admin,
      "demo_assets.deleted",
      "demo_asset",
      "asilo-politico/expediente",
      { after: null },
    );
  });
});

describe("listDemoAssetStatus", () => {
  it("maps one prefix listing onto the declared slots", async () => {
    mocks.listObjects.mockResolvedValue([
      { name: "i589.pdf", updatedAt: "2026-07-02T10:00:00Z", sizeBytes: 999 },
    ]);

    const status = await listDemoAssetStatus(admin, SLUG);

    expect(mocks.listObjects).toHaveBeenCalledWith("catalog-assets", "demo/asilo-politico");
    expect(status).toEqual([
      { key: "i589", uploaded: true, updatedAt: "2026-07-02T10:00:00Z", sizeBytes: 999 },
      { key: "memo", uploaded: false, updatedAt: null, sizeBytes: null },
      { key: "expediente", uploaded: false, updatedAt: null, sizeBytes: null },
    ]);
  });
});

describe("getDemoAssetUrls", () => {
  it("signs only uploaded slots and returns null for empty ones", async () => {
    mocks.listObjects.mockResolvedValue([{ name: "i589.pdf", updatedAt: null, sizeBytes: 1 }]);
    mocks.createSignedDownloadUrl.mockResolvedValue("https://signed/download");

    const urls = await getDemoAssetUrls(admin, SLUG);

    expect(urls).toEqual({ i589: "https://signed/download", memo: null, expediente: null });
    expect(mocks.createSignedDownloadUrl).toHaveBeenCalledTimes(1);
    expect(mocks.createSignedDownloadUrl).toHaveBeenCalledWith(
      "catalog-assets",
      "demo/asilo-politico/i589.pdf",
    );
  });

  it("degrades a slot to null when its signature fails (the live never breaks)", async () => {
    mocks.listObjects.mockResolvedValue([
      { name: "i589.pdf", updatedAt: null, sizeBytes: 1 },
      { name: "memo.pdf", updatedAt: null, sizeBytes: 1 },
    ]);
    mocks.createSignedDownloadUrl
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("https://signed/memo");

    const urls = await getDemoAssetUrls(admin, SLUG);

    expect(urls.i589).toBeNull();
    expect(urls.memo).toBe("https://signed/memo");
    expect(urls.expediente).toBeNull();
    expect(mocks.logger.warn).toHaveBeenCalled();
  });

  it("returns an empty map for a scenario without declared slots", async () => {
    const urls = await getDemoAssetUrls(admin, "sin-slots");
    expect(urls).toEqual({});
    expect(mocks.listObjects).not.toHaveBeenCalled();
  });
});
