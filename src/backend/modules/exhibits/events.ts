/**
 * Exhibits module — domain events.
 *
 * Emits:
 *   exhibits.run_settled — when every exhibit of a generation run reached a
 *     terminal-for-assembly state (ready | failed | manual). Consumers: expediente
 *     (attach ready exhibits after the memo), notifications (Diana panel refresh).
 *
 * @module exhibits/events
 */

import { appEvents, type DomainEvent } from "@/backend/platform/events";

export interface ExhibitsRunSettledPayload {
  runId: string;
  caseId: string;
  orgId: string;
  ready: number;
  failed: number;
}

export function emitExhibitsRunSettled(payload: ExhibitsRunSettledPayload): void {
  appEvents.emit({
    type: "exhibits.run_settled",
    payload,
    occurredAt: new Date(),
  } satisfies DomainEvent<ExhibitsRunSettledPayload>);
}
