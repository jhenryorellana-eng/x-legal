/**
 * Kanban module — domain event types.
 *
 * Events defined here (DOC-47 §7.1, DOC-48 §5):
 *  - card.moved    (EV-36 — broadcast + audit)
 *  - lead.created  (EV-05 → notifications matrix)
 *  - lead.won      (EV-06 → audit; Lex offers case in UI)
 *  - lead.lost     (EV-07 → audit; metrics)
 *
 * Payloads are minimal: IDs + routing data; zero PII.
 *
 * @module kanban/events
 */

import type { DomainEvent } from "@/backend/platform/events";
import type { BoardKind } from "./domain";

// ---------------------------------------------------------------------------
// card.moved (EV-36)
// ---------------------------------------------------------------------------

export interface CardMovedPayload {
  boardId: string;
  boardKind: BoardKind;
  cardId: string;
  refType: "lead" | "case";
  refId: string;
  fromColumnId: string;
  toColumnId: string;
  position: number;
  actorUserId: string;
}

export type CardMovedEvent = DomainEvent<CardMovedPayload>;

// ---------------------------------------------------------------------------
// lead.created (EV-05)
// ---------------------------------------------------------------------------

export interface LeadCreatedPayload {
  leadId: string;
  orgId: string;
  assignedTo: string | null;
  source: string;
}

export type LeadCreatedEvent = DomainEvent<LeadCreatedPayload>;

// ---------------------------------------------------------------------------
// lead.won (EV-06)
// ---------------------------------------------------------------------------

export interface LeadWonPayload {
  leadId: string;
  orgId: string;
  assignedTo: string | null;
}

export type LeadWonEvent = DomainEvent<LeadWonPayload>;

// ---------------------------------------------------------------------------
// lead.lost (EV-07)
// ---------------------------------------------------------------------------

export interface LeadLostPayload {
  leadId: string;
  orgId: string;
  lostReason: string;
}

export type LeadLostEvent = DomainEvent<LeadLostPayload>;

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type KanbanEvent =
  | CardMovedEvent
  | LeadCreatedEvent
  | LeadWonEvent
  | LeadLostEvent;
