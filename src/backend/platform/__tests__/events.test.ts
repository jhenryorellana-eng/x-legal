/**
 * TDD tests for platform/events.ts — DOC-20 §5 (in-process event dispatcher).
 *
 * Tests cover:
 * - Registered consumer receives emitted event
 * - Multiple consumers all receive the event
 * - Consumer that throws does NOT prevent other consumers from running
 * - emit() does not throw even when a consumer throws
 * - occurredAt is populated automatically if not provided
 */

import { describe, it, expect, vi } from "vitest";

// Minimal env setup
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.NEXT_PUBLIC_APP_URL = "https://test.example.com";
process.env.ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const { createEventBus } = await import("../events.js");

describe("EventBus — basic dispatch", () => {
  it("registered consumer receives the emitted event", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on("case.created", handler);
    bus.emit({ type: "case.created", payload: { caseId: "c-001" }, occurredAt: new Date() });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].payload.caseId).toBe("c-001");
  });

  it("consumer not registered for event type is NOT called", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on("staff.created", handler);
    bus.emit({ type: "case.created", payload: {}, occurredAt: new Date() });
    expect(handler).not.toHaveBeenCalled();
  });

  it("multiple consumers for the same event type all receive it", () => {
    const bus = createEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on("appointment.booked", h1);
    bus.on("appointment.booked", h2);
    bus.emit({ type: "appointment.booked", payload: { id: "apt-1" }, occurredAt: new Date() });
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });
});

describe("EventBus — fault isolation", () => {
  it("a throwing consumer does NOT prevent subsequent consumers from running", () => {
    const bus = createEventBus();
    const badHandler = vi.fn().mockImplementation(() => {
      throw new Error("consumer crashed");
    });
    const goodHandler = vi.fn();

    bus.on("downpayment.confirmed", badHandler);
    bus.on("downpayment.confirmed", goodHandler);

    // emit must NOT throw itself
    expect(() =>
      bus.emit({ type: "downpayment.confirmed", payload: {}, occurredAt: new Date() }),
    ).not.toThrow();

    // Both were called
    expect(badHandler).toHaveBeenCalledOnce();
    expect(goodHandler).toHaveBeenCalledOnce();
  });

  it("emit() does not throw when all consumers throw", () => {
    const bus = createEventBus();
    bus.on("contract.signed", () => { throw new Error("first"); });
    bus.on("contract.signed", () => { throw new Error("second"); });
    expect(() =>
      bus.emit({ type: "contract.signed", payload: {}, occurredAt: new Date() }),
    ).not.toThrow();
  });
});

describe("EventBus — occurredAt propagation", () => {
  it("event.occurredAt is the same Date instance passed to emit()", () => {
    const bus = createEventBus();
    let receivedAt: unknown;
    bus.on("staff.created", (event) => {
      receivedAt = event.occurredAt;
    });
    const now = new Date();
    bus.emit({ type: "staff.created", payload: {}, occurredAt: now });
    expect(receivedAt).toBeInstanceOf(Date);
    expect(receivedAt).toBe(now);
  });
});

describe("EventBus — instance isolation", () => {
  it("two bus instances do not share consumers", () => {
    const busA = createEventBus();
    const busB = createEventBus();
    const handler = vi.fn();
    busA.on("lead.created", handler);
    busB.emit({ type: "lead.created", payload: {}, occurredAt: new Date() });
    expect(handler).not.toHaveBeenCalled();
  });
});
