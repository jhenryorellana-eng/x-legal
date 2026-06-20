/**
 * Community domain — unit tests (RF-CLI-057 live window, RF-CLI-058 reactions).
 */

import { describe, it, expect } from "vitest";
import {
  isLivePostActive,
  aggregateReactions,
  isReactionKind,
  LIVE_TAIL_MS,
} from "../domain";

describe("isLivePostActive", () => {
  const now = new Date("2026-06-17T19:00:00Z").getTime();

  it("false when no live_starts_at", () => {
    expect(isLivePostActive(null, now)).toBe(false);
  });
  it("true for an upcoming session", () => {
    const inOneHour = new Date(now + 60 * 60 * 1000).toISOString();
    expect(isLivePostActive(inOneHour, now)).toBe(true);
  });
  it("true within the tail window after the start", () => {
    const startedRecently = new Date(now - (LIVE_TAIL_MS - 1000)).toISOString();
    expect(isLivePostActive(startedRecently, now)).toBe(true);
  });
  it("false once the tail window has passed", () => {
    const longOver = new Date(now - (LIVE_TAIL_MS + 1000)).toISOString();
    expect(isLivePostActive(longOver, now)).toBe(false);
  });
  it("false for a session scheduled well beyond the lead window (weeks out)", () => {
    const weeksOut = new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString();
    expect(isLivePostActive(weeksOut, now)).toBe(false);
  });
  it("false for a malformed timestamp", () => {
    expect(isLivePostActive("not-a-date", now)).toBe(false);
  });
});

describe("isReactionKind", () => {
  it("accepts the three canonical kinds", () => {
    expect(isReactionKind("heart")).toBe(true);
    expect(isReactionKind("fire")).toBe(true);
    expect(isReactionKind("clap")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isReactionKind("like")).toBe(false);
    expect(isReactionKind(null)).toBe(false);
  });
});

describe("aggregateReactions", () => {
  it("counts per post + flags the viewer's own reactions, ignoring unknown kinds", () => {
    const rows = [
      { post_id: "p1", user_id: "me", kind: "heart" },
      { post_id: "p1", user_id: "other", kind: "heart" },
      { post_id: "p1", user_id: "other", kind: "fire" },
      { post_id: "p1", user_id: "x", kind: "bogus" }, // ignored
      { post_id: "p2", user_id: "me", kind: "clap" },
    ];
    const agg = aggregateReactions(rows, "me");

    const p1 = agg.get("p1")!;
    expect(p1.counts).toEqual({ heart: 2, fire: 1, clap: 0 });
    expect([...p1.mine].sort()).toEqual(["heart"]);

    const p2 = agg.get("p2")!;
    expect(p2.counts).toEqual({ heart: 0, fire: 0, clap: 1 });
    expect([...p2.mine]).toEqual(["clap"]);
  });

  it("returns an empty map for no rows", () => {
    expect(aggregateReactions([], "me").size).toBe(0);
  });
});
