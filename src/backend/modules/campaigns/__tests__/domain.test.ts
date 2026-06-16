/**
 * Campaigns domain — pure unit tests (zero mocks).
 */

import { describe, it, expect } from "vitest";
import {
  canTransitionCampaign,
  isEditable,
  isCancellable,
  parseAudience,
  audienceToJson,
  suppressionReason,
} from "../domain";

describe("campaigns.domain: canTransitionCampaign", () => {
  it("allows draft → scheduled/sending/cancelled", () => {
    expect(canTransitionCampaign("draft", "scheduled")).toBe(true);
    expect(canTransitionCampaign("draft", "sending")).toBe(true);
    expect(canTransitionCampaign("draft", "cancelled")).toBe(true);
  });
  it("allows scheduled → sending/cancelled, sending → sent/failed/cancelled", () => {
    expect(canTransitionCampaign("scheduled", "sending")).toBe(true);
    expect(canTransitionCampaign("scheduled", "cancelled")).toBe(true);
    expect(canTransitionCampaign("sending", "sent")).toBe(true);
    expect(canTransitionCampaign("sending", "failed")).toBe(true);
    expect(canTransitionCampaign("sending", "cancelled")).toBe(true);
  });
  it("rejects terminal and illegal transitions", () => {
    expect(canTransitionCampaign("sent", "sending")).toBe(false);
    expect(canTransitionCampaign("cancelled", "sending")).toBe(false);
    expect(canTransitionCampaign("failed", "sending")).toBe(false);
    expect(canTransitionCampaign("sending", "draft")).toBe(false);
    expect(canTransitionCampaign("draft", "sent")).toBe(false);
  });
});

describe("campaigns.domain: editability", () => {
  it("only drafts are editable", () => {
    expect(isEditable("draft")).toBe(true);
    expect(isEditable("scheduled")).toBe(false);
    expect(isEditable("sent")).toBe(false);
  });
  it("scheduled and sending are cancellable", () => {
    expect(isCancellable("scheduled")).toBe(true);
    expect(isCancellable("sending")).toBe(true);
    expect(isCancellable("draft")).toBe(false);
    expect(isCancellable("sent")).toBe(false);
  });
});

describe("campaigns.domain: audience parse/serialize", () => {
  it("round-trips by_service (snake ↔ camel)", () => {
    expect(parseAudience({ kind: "by_service", service_ids: ["a", "b"] })).toEqual({ kind: "by_service", serviceIds: ["a", "b"] });
    expect(audienceToJson({ kind: "by_service", serviceIds: ["a"] })).toEqual({ kind: "by_service", service_ids: ["a"] });
  });
  it("round-trips custom", () => {
    expect(parseAudience({ kind: "custom", user_ids: ["u1"] })).toEqual({ kind: "custom", userIds: ["u1"] });
    expect(audienceToJson({ kind: "custom", userIds: ["u1"] })).toEqual({ kind: "custom", user_ids: ["u1"] });
  });
  it("defaults to all_clients for unknown/empty", () => {
    expect(parseAudience(null)).toEqual({ kind: "all_clients" });
    expect(parseAudience({ kind: "whatever" })).toEqual({ kind: "all_clients" });
  });
});

describe("campaigns.domain: suppressionReason", () => {
  it("returns null for a mailable client", () => {
    expect(suppressionReason({ email: "a@x.com", marketingOptIn: true, emailBouncedAt: null })).toBeNull();
  });
  it("flags no_email, bounced, opted_out (in priority order)", () => {
    expect(suppressionReason({ email: null, marketingOptIn: true, emailBouncedAt: null })).toBe("no_email");
    expect(suppressionReason({ email: "a@x.com", marketingOptIn: true, emailBouncedAt: "2026-01-01" })).toBe("bounced");
    expect(suppressionReason({ email: "a@x.com", marketingOptIn: false, emailBouncedAt: null })).toBe("opted_out");
  });
});
