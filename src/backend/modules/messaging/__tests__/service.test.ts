/**
 * Messaging service — unit tests.
 *
 * Covers ensureCaseConversation idempotency, postSystemMessage (no event),
 * sendMessage guards + emit, markRead, removeParticipant guards, translateMessage cache.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRepo = vi.hoisted(() => ({
  findCaseConversation: vi.fn(),
  findConversationById: vi.fn(),
  insertConversation: vi.fn(),
  touchLastMessageAt: vi.fn().mockResolvedValue(undefined),
  listParticipantIds: vi.fn(),
  listParticipantsWithKind: vi.fn(),
  isParticipant: vi.fn(),
  getParticipant: vi.fn(),
  addParticipants: vi.fn().mockResolvedValue(undefined),
  removeParticipant: vi.fn().mockResolvedValue(undefined),
  markReadMonotonic: vi.fn().mockResolvedValue(undefined),
  insertMessage: vi.fn(),
  findMessageById: vi.fn(),
  setMessageTranslation: vi.fn().mockResolvedValue(undefined),
  listMessages: vi.fn(),
  countUnreadAggregate: vi.fn(),
  loadCaseParticipantSources: vi.fn(),
  getUserLocale: vi.fn(),
  findCaseOrgId: vi.fn(),
  loadParticipantProfiles: vi.fn().mockResolvedValue([]),
  listConversationsForUser: vi.fn().mockResolvedValue([]),
  findConversationByTitle: vi.fn(),
  listActiveStaffIds: vi.fn(),
  listActiveStaffProfiles: vi.fn().mockResolvedValue([]),
}));

const mockEvents = vi.hoisted(() => {
  // emit + emitAndWait share one spy so assertions on `.emit` still observe the
  // converted (awaited) emit path for message.sent.
  const emit = vi.fn();
  return { appEvents: { emit, emitAndWait: emit } };
});
const mockAudit = vi.hoisted(() => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));
const mockAi = vi.hoisted(() => ({ translateText: vi.fn() }));

vi.mock("../repository.js", () => mockRepo);
vi.mock("@/backend/platform/events", () => mockEvents);
vi.mock("@/backend/modules/audit", () => mockAudit);
vi.mock("@/backend/modules/ai-engine", () => mockAi);
vi.mock("@/backend/platform/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/backend/platform/storage", () => ({
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
  validateUploadedObject: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/backend/platform/ratelimit", () => ({
  limitMessagingUploadUrl: vi.fn().mockResolvedValue({ allowed: true }),
}));
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

import {
  ensureCaseConversation,
  postSystemMessage,
  sendMessage,
  markRead,
  removeParticipant,
  translateMessage,
  getCaseThread,
  getThread,
  listConversations,
  listStaffDirectory,
  ensureTeamConversation,
  ensureStaffDirectConversation,
} from "../service";
import { AuthzError } from "@/backend/platform/authz";
import { senderColor } from "../domain";

const ORG = "org-1";
const CASE = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const CLIENT = { userId: "client-1", orgId: ORG, kind: "client", role: null, permissions: new Map() } as import("@/backend/platform/authz").Actor;
const STAFF = { userId: "staff-1", orgId: ORG, kind: "staff", role: "paralegal", permissions: new Map([["messaging", { view: true, edit: true }]]) } as import("@/backend/platform/authz").Actor;

const conv = { id: CONV, org_id: ORG, scope: "case", case_id: CASE, title: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureCaseConversation", () => {
  it("returns the existing conversation", async () => {
    mockRepo.findCaseConversation.mockResolvedValue(conv);
    const r = await ensureCaseConversation(CASE);
    expect(r.id).toBe(CONV);
    expect(mockRepo.insertConversation).not.toHaveBeenCalled();
  });
  it("creates + adds participants when absent", async () => {
    mockRepo.findCaseConversation.mockResolvedValueOnce(null);
    mockRepo.loadCaseParticipantSources.mockResolvedValue({ orgId: ORG, caseMemberIds: ["client-1"], paralegalId: "staff-1", salesId: null, adminIds: [] });
    mockRepo.insertConversation.mockResolvedValue({ row: conv, conflict: false });
    await ensureCaseConversation(CASE);
    expect(mockRepo.addParticipants).toHaveBeenCalledWith(CONV, expect.arrayContaining(["client-1", "staff-1"]));
  });
  it("is idempotent on unique conflict (re-reads the winner)", async () => {
    mockRepo.findCaseConversation.mockResolvedValueOnce(null).mockResolvedValueOnce(conv);
    mockRepo.loadCaseParticipantSources.mockResolvedValue({ orgId: ORG, caseMemberIds: [], paralegalId: null, salesId: null, adminIds: [] });
    mockRepo.insertConversation.mockResolvedValue({ row: null, conflict: true });
    const r = await ensureCaseConversation(CASE);
    expect(r.id).toBe(CONV);
  });
});

describe("postSystemMessage", () => {
  it("inserts kind=system and NEVER emits message.sent", async () => {
    mockRepo.findCaseConversation.mockResolvedValue(conv);
    mockRepo.insertMessage.mockResolvedValue({ id: "m1", created_at: "2026-06-16T10:00:00Z" });
    await postSystemMessage(CASE, "sys.downpayment_confirmed");
    expect(mockRepo.insertMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "system", senderUserId: null }));
    expect(mockEvents.appEvents.emit).not.toHaveBeenCalled();
  });
});

describe("sendMessage", () => {
  beforeEach(() => {
    mockRepo.findConversationById.mockResolvedValue(conv);
    mockRepo.isParticipant.mockResolvedValue(true);
    mockRepo.insertMessage.mockResolvedValue({ id: "m1", kind: "text", created_at: "2026-06-16T10:00:00Z" });
    mockRepo.listParticipantIds.mockResolvedValue(["client-1", "staff-1"]);
  });
  it("sends a text message and emits message.sent once", async () => {
    await sendMessage(CLIENT, { conversationId: CONV, body: "Hola" });
    expect(mockRepo.insertMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "text", body: "Hola", senderUserId: "client-1" }));
    expect(mockEvents.appEvents.emit).toHaveBeenCalledTimes(1);
    expect(mockEvents.appEvents.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "message.sent" }));
  });
  it("rejects non-participant (NOT_PARTICIPANT)", async () => {
    mockRepo.isParticipant.mockResolvedValue(false);
    await expect(sendMessage(CLIENT, { conversationId: CONV, body: "x" })).rejects.toMatchObject({ code: "NOT_PARTICIPANT" });
  });
  it("rejects cross-org", async () => {
    mockRepo.findConversationById.mockResolvedValue({ ...conv, org_id: "other-org" });
    await expect(sendMessage(CLIENT, { conversationId: CONV, body: "x" })).rejects.toBeInstanceOf(AuthzError);
  });
  it("rejects empty (no body, no attachments)", async () => {
    await expect(sendMessage(CLIENT, { conversationId: CONV, body: "   " })).rejects.toMatchObject({ code: "EMPTY_MESSAGE" });
  });
});

describe("markRead", () => {
  it("advances last_read_at via service-role", async () => {
    mockRepo.findConversationById.mockResolvedValue(conv);
    mockRepo.isParticipant.mockResolvedValue(true);
    await markRead(CLIENT, CONV);
    expect(mockRepo.markReadMonotonic).toHaveBeenCalledWith(CONV, "client-1", expect.any(String));
  });
});

describe("removeParticipant guards", () => {
  beforeEach(() => {
    mockRepo.findConversationById.mockResolvedValue(conv);
    mockRepo.isParticipant.mockResolvedValue(true);
  });
  it("CLIENT_CANNOT_LEAVE for a case client", async () => {
    mockRepo.listParticipantsWithKind.mockResolvedValue([
      { userId: "client-1", kind: "client" },
      { userId: "staff-1", kind: "staff" },
      { userId: "staff-2", kind: "staff" },
    ]);
    await expect(removeParticipant(STAFF, CONV, "client-1")).rejects.toMatchObject({ code: "CLIENT_CANNOT_LEAVE" });
  });
  it("LAST_STAFF_CANNOT_LEAVE when removing the only staff", async () => {
    mockRepo.listParticipantsWithKind.mockResolvedValue([
      { userId: "client-1", kind: "client" },
      { userId: "staff-1", kind: "staff" },
    ]);
    await expect(removeParticipant(STAFF, CONV, "staff-1")).rejects.toMatchObject({ code: "LAST_STAFF_CANNOT_LEAVE" });
  });
  it("removes an extra staff", async () => {
    mockRepo.listParticipantsWithKind.mockResolvedValue([
      { userId: "client-1", kind: "client" },
      { userId: "staff-1", kind: "staff" },
      { userId: "staff-2", kind: "staff" },
    ]);
    await removeParticipant(STAFF, CONV, "staff-2");
    expect(mockRepo.removeParticipant).toHaveBeenCalledWith(CONV, "staff-2");
  });
});

describe("getCaseThread viewerCanPost", () => {
  beforeEach(() => {
    mockRepo.findCaseConversation.mockResolvedValue(conv);
    mockRepo.listMessages.mockResolvedValue({ items: [], nextCursor: null });
    mockRepo.listParticipantIds.mockResolvedValue(["client-1", "staff-1"]);
    mockRepo.getParticipant.mockResolvedValue({ last_read_at: null });
  });
  it("true for a participant", async () => {
    const r = await getCaseThread(CLIENT, CASE); // client-1 is a participant
    expect(r.viewerCanPost).toBe(true);
  });
  it("false for staff with case access but no participation (read-only)", async () => {
    const FINANCE = { userId: "staff-9", orgId: ORG, kind: "staff", role: "finance", permissions: new Map() } as import("@/backend/platform/authz").Actor;
    const r = await getCaseThread(FINANCE, CASE);
    expect(r.viewerCanPost).toBe(false);
  });
  it("true for a staff admin via the override (even when not a participant)", async () => {
    const ADMIN = { userId: "admin-1", orgId: ORG, kind: "staff", role: "admin", permissions: new Map() } as import("@/backend/platform/authz").Actor;
    const r = await getCaseThread(ADMIN, CASE);
    expect(r.viewerCanPost).toBe(true);
  });
});

describe("translateMessage", () => {
  beforeEach(() => {
    mockRepo.findConversationById.mockResolvedValue(conv);
    mockRepo.isParticipant.mockResolvedValue(true);
    mockRepo.getUserLocale.mockResolvedValue("en");
  });
  it("returns cached translation without calling AI", async () => {
    mockRepo.findMessageById.mockResolvedValue({ id: "m1", conversation_id: CONV, body: "Hola", body_translated: { lang: "en", text: "Hello" } });
    const r = await translateMessage(CLIENT, "m1");
    expect(r).toEqual({ lang: "en", text: "Hello" });
    expect(mockAi.translateText).not.toHaveBeenCalled();
  });
  it("translates + caches on miss (never overwrites body)", async () => {
    mockRepo.findMessageById.mockResolvedValue({ id: "m1", conversation_id: CONV, body: "Hola", body_translated: null });
    mockAi.translateText.mockResolvedValue({ text: "Hello", model: "g" });
    const r = await translateMessage(CLIENT, "m1");
    expect(r.text).toBe("Hello");
    expect(mockRepo.setMessageTranslation).toHaveBeenCalledWith("m1", { lang: "en", text: "Hello" });
  });
});

describe("getThread participants (group header / sender colors)", () => {
  beforeEach(() => {
    mockRepo.findConversationById.mockResolvedValue(conv);
    mockRepo.isParticipant.mockResolvedValue(true);
    mockRepo.listMessages.mockResolvedValue({ items: [], nextCursor: null });
    mockRepo.listParticipantIds.mockResolvedValue(["client-1", "staff-1"]);
    mockRepo.getParticipant.mockResolvedValue({ last_read_at: null });
  });
  it("enriches each participant with initials + a stable color", async () => {
    mockRepo.loadParticipantProfiles.mockResolvedValue([
      { userId: "staff-1", name: "Diana Pérez", roleLabel: "Preparación del expediente", kind: "staff" },
      { userId: "client-1", name: "María González", roleLabel: null, kind: "client" },
    ]);
    const r = await getThread(STAFF, CONV);
    expect(r.participants).toHaveLength(2);
    expect(r.participants[0]).toMatchObject({ userId: "staff-1", initials: "DP", color: senderColor("staff-1") });
    expect(r.participants[1]).toMatchObject({ userId: "client-1", initials: "MG" });
  });
});

describe("listConversations (staff inbox: Clientes vs Equipo)", () => {
  it("groups by scope and enriches snippet/initials/color", async () => {
    mockRepo.listConversationsForUser.mockResolvedValue([
      {
        conversationId: "c-case", scope: "case", title: null, caseId: CASE, caseNumber: "ULP-2026-0002", serviceChip: "Visa Juvenil",
        peerName: "Sofía Cabrera", lastMessageAt: "2026-06-16T09:41:00Z", unread: 2,
        lastMessage: { kind: "text", body: "Recibido", senderUserId: "staff-9", senderName: "Diana Ruiz", attachmentName: null },
      },
      {
        conversationId: "c-team", scope: "support", title: "__team__", caseId: null, caseNumber: null, serviceChip: null,
        peerName: "Equipo UsaLatinoPrime", lastMessageAt: "2026-06-15T11:00:00Z", unread: 0,
        lastMessage: { kind: "text", body: "Reunión el viernes", senderUserId: "staff-2", senderName: "Andrium Vega", attachmentName: null },
      },
    ]);
    const r = await listConversations(STAFF);
    expect(r.clients).toHaveLength(1);
    expect(r.team).toHaveLength(1);
    expect(r.clients[0]).toMatchObject({
      name: "Sofía Cabrera", initials: "SC", serviceChip: "Visa Juvenil", caseNumber: "ULP-2026-0002", unread: 2, snippet: "Diana: Recibido",
    });
    expect(r.team[0]).toMatchObject({ name: "Equipo UsaLatinoPrime", snippet: "Andrium: Reunión el viernes" });
  });
});

describe("listStaffDirectory (Equipo tab — start a DM)", () => {
  it("returns active staff (excluding self) with initials + stable color", async () => {
    mockRepo.listActiveStaffProfiles.mockResolvedValue([
      { userId: "staff-2", name: "Diana Pérez", roleLabel: "Paralegal" },
      { userId: "staff-3", name: "Andrium Vega", roleLabel: "Coordinación" },
    ]);
    const r = await listStaffDirectory(STAFF);
    expect(mockRepo.listActiveStaffProfiles).toHaveBeenCalledWith(ORG, "staff-1");
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ userId: "staff-2", initials: "DP", color: senderColor("staff-2") });
  });
});

describe("ensureTeamConversation (internal all-staff group)", () => {
  it("returns the existing team group without inserting", async () => {
    const team = { id: "team-1", org_id: ORG, scope: "support", case_id: null, title: "__team__" };
    mockRepo.findConversationByTitle.mockResolvedValue(team);
    const r = await ensureTeamConversation(STAFF);
    expect(r.id).toBe("team-1");
    expect(mockRepo.insertConversation).not.toHaveBeenCalled();
  });
  it("creates the group and adds every active staff member", async () => {
    const team = { id: "team-1", org_id: ORG, scope: "support", case_id: null, title: "__team__" };
    mockRepo.findConversationByTitle.mockResolvedValue(null);
    mockRepo.listActiveStaffIds.mockResolvedValue(["staff-1", "staff-2", "staff-3"]);
    mockRepo.insertConversation.mockResolvedValue({ row: team, conflict: false });
    await ensureTeamConversation(STAFF);
    expect(mockRepo.addParticipants).toHaveBeenCalledWith("team-1", ["staff-1", "staff-2", "staff-3"]);
  });
});

describe("ensureStaffDirectConversation (1:1 staff DM)", () => {
  it("creates a deterministic DM thread with both staff as participants", async () => {
    const dm = { id: "dm-1", org_id: ORG, scope: "support", case_id: null, title: "__dm__:staff-1|staff-2" };
    mockRepo.findConversationByTitle.mockResolvedValue(null);
    mockRepo.listActiveStaffIds.mockResolvedValue(["staff-1", "staff-2"]);
    mockRepo.insertConversation.mockResolvedValue({ row: dm, conflict: false });
    const r = await ensureStaffDirectConversation(STAFF, "staff-2");
    expect(r.id).toBe("dm-1");
    expect(mockRepo.findConversationByTitle).toHaveBeenCalledWith(ORG, "support", "__dm__:staff-1|staff-2");
    expect(mockRepo.addParticipants).toHaveBeenCalledWith("dm-1", expect.arrayContaining(["staff-1", "staff-2"]));
  });
  it("rejects a target that is not active staff in the org (no DM with a client/cross-org)", async () => {
    mockRepo.listActiveStaffIds.mockResolvedValue(["staff-1", "staff-2"]);
    await expect(ensureStaffDirectConversation(STAFF, "client-99")).rejects.toBeInstanceOf(AuthzError);
    expect(mockRepo.insertConversation).not.toHaveBeenCalled();
  });
});
