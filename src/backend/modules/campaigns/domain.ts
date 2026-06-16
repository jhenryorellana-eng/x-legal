/**
 * Campaigns module — pure domain (state machine, audience, suppression).
 *
 * NO I/O. Deterministic, testable with zero mocks. DOC-47 Part B §5, DOC-55 §4.
 *
 * @module campaigns/domain
 */

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export type AudienceSpec =
  | { kind: "all_clients" }
  | { kind: "by_service"; serviceIds: string[] }
  | { kind: "custom"; userIds: string[] };

// ---------------------------------------------------------------------------
// State machine (DOC-47 §5.4)
// ---------------------------------------------------------------------------

const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["scheduled", "sending", "cancelled"],
  scheduled: ["sending", "cancelled"],
  sending: ["sent", "failed", "cancelled"],
  sent: [],
  failed: [],
  cancelled: [],
};

export function canTransitionCampaign(from: CampaignStatus, to: CampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Only drafts are editable (subject/body/audience). */
export function isEditable(status: CampaignStatus): boolean {
  return status === "draft";
}

/** Scheduled or sending campaigns can be cancelled (sending = best-effort). */
export function isCancellable(status: CampaignStatus): boolean {
  return status === "scheduled" || status === "sending";
}

// ---------------------------------------------------------------------------
// Audience parsing (jsonb stores snake_case; domain uses camelCase)
// ---------------------------------------------------------------------------

export function parseAudience(raw: unknown): AudienceSpec {
  const a = (raw ?? {}) as Record<string, unknown>;
  if (a.kind === "by_service") {
    const ids = (a.service_ids ?? a.serviceIds ?? []) as string[];
    return { kind: "by_service", serviceIds: Array.isArray(ids) ? ids : [] };
  }
  if (a.kind === "custom") {
    const ids = (a.user_ids ?? a.userIds ?? []) as string[];
    return { kind: "custom", userIds: Array.isArray(ids) ? ids : [] };
  }
  return { kind: "all_clients" };
}

export function audienceToJson(a: AudienceSpec): Record<string, unknown> {
  if (a.kind === "by_service") return { kind: "by_service", service_ids: a.serviceIds };
  if (a.kind === "custom") return { kind: "custom", user_ids: a.userIds };
  return { kind: "all_clients" };
}

// ---------------------------------------------------------------------------
// Suppression (DOC-73 §4.2)
// ---------------------------------------------------------------------------

/**
 * Returns the reason a candidate must be suppressed, or null if mailable.
 *   - no email            → "no_email"
 *   - hard bounce on file  → "bounced"
 *   - opted out of marketing → "opted_out"
 */
export function suppressionReason(u: {
  email: string | null;
  marketingOptIn: boolean;
  emailBouncedAt: string | null;
}): "no_email" | "opted_out" | "bounced" | null {
  if (!u.email) return "no_email";
  if (u.emailBouncedAt) return "bounced";
  if (!u.marketingOptIn) return "opted_out";
  return null;
}
