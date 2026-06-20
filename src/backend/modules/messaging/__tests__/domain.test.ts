/**
 * Messaging domain — pure unit tests (zero mocks).
 */

import { describe, it, expect } from "vitest";
import {
  isUnread,
  renderSystemMessage,
  computeCaseParticipantIds,
  validateAttachmentRefs,
} from "../domain";

describe("messaging.domain: isUnread (RF-TRX-017)", () => {
  const reader = "u-reader";
  it("system messages are never unread", () => {
    expect(isUnread({ kind: "system", senderUserId: null, createdAt: "2026-06-16T10:00:00Z" }, reader, null)).toBe(false);
  });
  it("own messages are never unread", () => {
    expect(isUnread({ kind: "text", senderUserId: reader, createdAt: "2026-06-16T10:00:00Z" }, reader, null)).toBe(false);
  });
  it("null last_read_at ⇒ everything newer than epoch is unread", () => {
    expect(isUnread({ kind: "text", senderUserId: "other", createdAt: "2026-06-16T10:00:00Z" }, reader, null)).toBe(true);
  });
  it("messages at/older than last_read_at are read", () => {
    expect(isUnread({ kind: "text", senderUserId: "other", createdAt: "2026-06-16T09:00:00Z" }, reader, "2026-06-16T10:00:00Z")).toBe(false);
    expect(isUnread({ kind: "text", senderUserId: "other", createdAt: "2026-06-16T11:00:00Z" }, reader, "2026-06-16T10:00:00Z")).toBe(true);
  });
});

describe("messaging.domain: renderSystemMessage", () => {
  it("renders all 5 keys bilingual (body es + body_translated en)", () => {
    const keys = ["sys.downpayment_confirmed", "sys.installment_paid", "sys.appointment_booked", "sys.document_approved", "sys.phase_advanced"] as const;
    for (const k of keys) {
      const r = renderSystemMessage(k, { number: 2, phase: "Documentación" });
      expect(r.body.length).toBeGreaterThan(0);
      expect(r.bodyTranslated.lang).toBe("en");
      expect(r.bodyTranslated.text.length).toBeGreaterThan(0);
    }
  });
});

describe("messaging.domain: computeCaseParticipantIds", () => {
  it("unions members + paralegal + sales + admins and dedupes", () => {
    const ids = computeCaseParticipantIds({
      caseMemberIds: ["c1", "c2"],
      paralegalId: "p1",
      salesId: "s1",
      adminIds: ["a1", "p1"], // p1 duplicate
    });
    expect(new Set(ids)).toEqual(new Set(["c1", "c2", "p1", "s1", "a1"]));
    expect(ids.length).toBe(5);
  });
  it("drops null staff", () => {
    expect(computeCaseParticipantIds({ caseMemberIds: ["c1"], paralegalId: null, salesId: null, adminIds: [] })).toEqual(["c1"]);
  });
});

describe("messaging.domain: validateAttachmentRefs", () => {
  it("keeps valid refs and drops malformed", () => {
    const out = validateAttachmentRefs([
      { path: "a/1.pdf", name: "1.pdf", mime: "application/pdf", size: 10 },
      { path: "x", name: "y" }, // missing mime/size
      "nope",
    ]);
    expect(out).toEqual([{ path: "a/1.pdf", name: "1.pdf", mime: "application/pdf", size: 10 }]);
  });
  it("returns [] for non-arrays", () => {
    expect(validateAttachmentRefs(null)).toEqual([]);
  });
});
