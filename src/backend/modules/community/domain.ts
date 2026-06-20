/**
 * Community module — pure domain rules (no IO). DOC-30 §12, RF-CLI-055..058.
 */

export type PostKind = "text" | "video" | "live";
export type ReactionKind = "heart" | "fire" | "clap";

export const REACTION_KINDS: readonly ReactionKind[] = ["heart", "fire", "clap"] as const;

export function isReactionKind(v: unknown): v is ReactionKind {
  return v === "heart" || v === "fire" || v === "clap";
}

/**
 * A live post's banner is shown only while the session is near: from LIVE_LEAD_MS
 * before its start until LIVE_TAIL_MS after (RF-CLI-057: "EN VIVO HOY 7:00 PM" —
 * an imminent/ongoing session, not one scheduled weeks out, and it disappears
 * once it is over). No explicit end time → 24 h lead, 2 h tail.
 */
export const LIVE_TAIL_MS = 2 * 60 * 60 * 1000;
export const LIVE_LEAD_MS = 24 * 60 * 60 * 1000;

export function isLivePostActive(
  liveStartsAt: string | null,
  nowMs: number,
): boolean {
  if (!liveStartsAt) return false;
  const t = new Date(liveStartsAt).getTime();
  if (Number.isNaN(t)) return false;
  // Visible within [start - lead, start + tail].
  return nowMs >= t - LIVE_LEAD_MS && nowMs <= t + LIVE_TAIL_MS;
}

export interface ReactionCounts {
  heart: number;
  fire: number;
  clap: number;
}

export interface ReactionRow {
  post_id: string;
  user_id: string;
  kind: string;
}

/**
 * Aggregates reaction rows into per-post counts + the viewer's own reactions.
 * Returns a map keyed by post_id.
 */
export function aggregateReactions(
  rows: ReactionRow[],
  viewerUserId: string,
): Map<string, { counts: ReactionCounts; mine: Set<ReactionKind> }> {
  const out = new Map<string, { counts: ReactionCounts; mine: Set<ReactionKind> }>();
  for (const r of rows) {
    if (!isReactionKind(r.kind)) continue;
    let entry = out.get(r.post_id);
    if (!entry) {
      entry = { counts: { heart: 0, fire: 0, clap: 0 }, mine: new Set() };
      out.set(r.post_id, entry);
    }
    entry.counts[r.kind] += 1;
    if (r.user_id === viewerUserId) entry.mine.add(r.kind);
  }
  return out;
}
