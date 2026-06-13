/**
 * In-process domain event dispatcher — DOC-20 §5.
 *
 * Synchronous fan-out: all consumers for a given event type are called in
 * registration order.  Fault isolation: a consumer that throws is logged and
 * skipped; the remaining consumers still execute.
 *
 * Heavy side-effects (emails, push, AI jobs) must be delegated to QStash
 * inside the consumer — never executed inline (DOC-20 §5, DOC-26 §1).
 *
 * Usage (in modules/{name}/events.ts wiring file):
 *   import { appEvents } from '@/backend/platform/events';
 *   appEvents.on('case.created', async (event) => { ... });
 *
 * Usage (in service.ts):
 *   appEvents.emit({ type: 'case.created', payload: { caseId }, occurredAt: new Date() });
 *
 * Test isolation: use `createEventBus()` to get a fresh instance per test.
 */

import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DomainEvent<TPayload = unknown> {
  /** e.g. 'case.created', 'downpayment.confirmed' */
  type: string;
  payload: TPayload;
  occurredAt: Date;
}

export type EventConsumer<TPayload = unknown> = (
  event: DomainEvent<TPayload>,
) => void | Promise<void>;

// ---------------------------------------------------------------------------
// EventBus implementation
// ---------------------------------------------------------------------------

export interface EventBus {
  on(eventType: string, consumer: EventConsumer): void;
  emit(event: DomainEvent): void;
}

export function createEventBus(): EventBus {
  const consumers = new Map<string, EventConsumer[]>();

  return {
    on(eventType: string, consumer: EventConsumer): void {
      const existing = consumers.get(eventType) ?? [];
      consumers.set(eventType, [...existing, consumer]);
    },

    emit(event: DomainEvent): void {
      const handlers = consumers.get(event.type) ?? [];
      for (const handler of handlers) {
        try {
          // Synchronous call (consumers may be async but we don't await here).
          // Heavy work must be enqueued to QStash; async consumers are fire-and-forget.
          const result = handler(event);
          // Post-await rejections are NOT caught by the try/catch — attach a
          // handler so an async consumer failure never becomes an unhandled
          // promise rejection (and never kills the other consumers).
          if (result instanceof Promise) {
            result.catch((err) =>
              logger.error(
                {
                  err,
                  eventType: event.type,
                  handler: handler.name || "(anonymous)",
                },
                "EventBus: async consumer rejected — continuing",
              ),
            );
          }
        } catch (err) {
          logger.error(
            {
              err,
              eventType: event.type,
              handler: handler.name || "(anonymous)",
            },
            "EventBus: consumer threw — continuing with remaining consumers",
          );
        }
      }
    },
  };
}

/**
 * Singleton event bus for the application.
 *
 * Backed by globalThis so ALL module instances in the same Node process share
 * ONE bus. This is mandatory under Next.js: `instrumentation.ts` is compiled
 * into a SEPARATE bundle from route handlers / server actions, so a plain
 * `export const appEvents = createEventBus()` yields a different instance per
 * bundle — consumers registered at startup (instrumentation) would never see
 * events emitted from an action. The globalThis pin closes that gap (same
 * pattern used for the Prisma/Supabase client singletons in Next.js).
 *
 * Modules wire their consumers at startup via register-consumers.ts.
 */
const globalForEvents = globalThis as unknown as { __ulpEventBus?: EventBus };
export const appEvents: EventBus =
  globalForEvents.__ulpEventBus ?? (globalForEvents.__ulpEventBus = createEventBus());
