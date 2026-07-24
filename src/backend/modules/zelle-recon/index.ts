/**
 * Zelle reconciliation module — public API (module-pub boundary).
 *
 * Automatic reconciliation of Chase "You received money with Zelle" alerts:
 * IMAP ingest (Migadu) → authenticity → parse → two-tier matching →
 * atomic tier-A settlement via billing, or the finance review inbox.
 *
 * Jobs: ingest-zelle-emails (cron 2 min), zelle-ingest-heartbeat (hourly),
 * match-zelle-notification (fan-out). Server actions: ./actions.ts.
 */

// Job entry points
export {
  runZelleIngestSweep,
  checkIngestHeartbeat,
  matchZelleNotification,
} from "./service";

// Config (finance-owned circuit breakers)
export { getReconConfig, updateReconConfig } from "./service";

// Inbox (page-initial read + Andrium's manual decisions)
export {
  getReconInbox,
  confirmZelleMatch,
  reassignZelleNotification,
  dismissZelleNotification,
  getZelleEvidenceUrl,
  listReconTargets,
  ZelleReconError,
} from "./service";

export type {
  ReconInboxVM,
  ReconNotificationVM,
  ReconMatchVM,
  ReconAutoAppliedVM,
  ReconTargetVM,
} from "./service";

// Domain (pure — safe to import widely)
export {
  KNOWN_TEMPLATE_IDS,
  SCORER_VERSION,
  normalizePayerName,
  extractRefCode,
} from "./domain";

export type {
  ReconConfig,
  MatchCandidate,
  MatchDecision,
  NotificationFacts,
} from "./domain";

// Event types
export type { ZelleReconEvent, ZelleMatchSuggestedEvent } from "./events";
