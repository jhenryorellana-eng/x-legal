/**
 * Community module — service layer (DOC-30 §12, RF-CLI-055..058).
 *
 * Free + clients-only feed (RF-CLI-055): read for clients of the org; posts are
 * written only by staff with the `community` module. Reactions (heart/fire/clap)
 * toggle per (post, user, kind). Live banner from a published kind='live' post.
 */

import { can, AuthzError, type Actor } from "@/backend/platform/authz";
import { writeAudit } from "@/backend/modules/audit";
import {
  aggregateReactions,
  isLivePostActive,
  isReactionKind,
  LIVE_TAIL_MS,
  type ReactionCounts,
  type ReactionKind,
} from "./domain";
import {
  listPublishedPosts,
  listAllPosts,
  setPostPublished as repoSetPostPublished,
  findActiveLivePost,
  listReactionsForPosts,
  findReaction,
  insertReaction,
  deleteReaction,
  findPostById,
  insertPost,
  type CommunityPostRow,
} from "./repository";

export class CommunityError extends Error {
  constructor(public readonly code: string, public readonly details?: Record<string, unknown>) {
    super(code);
    this.name = "CommunityError";
  }
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Feed read: any client of the org, or staff with the `community` module. */
function canViewCommunity(actor: Actor): boolean {
  if (actor.kind === "client") return true;
  if (actor.kind === "staff") {
    if (actor.role === "admin") return true;
    return Boolean(actor.permissions.get("community")?.view);
  }
  return false;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface FeedPostDto {
  id: string;
  kind: string;
  body: string | null;
  videoUrl: string | null;
  authorStaffId: string | null;
  authorDisplay: string | null;
  createdAt: string;
  reactions: ReactionCounts;
  mine: ReactionKind[];
}

export interface LiveBannerDto {
  id: string;
  body: string | null;
  authorDisplay: string | null;
  liveStartsAt: string | null;
  liveJoinUrl: string | null;
}

export interface CommunityFeedDto {
  meUserId: string;
  live: LiveBannerDto | null;
  posts: FeedPostDto[];
  nextCursor: string | null;
}

function toFeedPostDto(
  row: CommunityPostRow,
  agg: Map<string, { counts: ReactionCounts; mine: Set<ReactionKind> }>,
): FeedPostDto {
  const entry = agg.get(row.id);
  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    videoUrl: row.video_url,
    authorStaffId: row.author_staff_id,
    authorDisplay: row.author_display,
    createdAt: row.created_at,
    reactions: entry?.counts ?? { heart: 0, fire: 0, clap: 0 },
    mine: entry ? [...entry.mine] : [],
  };
}

// ---------------------------------------------------------------------------
// getFeed
// ---------------------------------------------------------------------------

export async function getFeed(
  actor: Actor,
  opts: { cursor?: string; limit?: number },
): Promise<CommunityFeedDto> {
  if (!canViewCommunity(actor)) throw new AuthzError("forbidden_module");

  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50); // cap client-supplied page size
  const page = await listPublishedPosts(actor.orgId, { cursor: opts.cursor, limit });
  const sinceIso = new Date(Date.now() - LIVE_TAIL_MS).toISOString();
  const liveRow = await findActiveLivePost(actor.orgId, sinceIso);
  const live = liveRow && isLivePostActive(liveRow.live_starts_at, Date.now()) ? liveRow : null;

  // The live banner post is shown separately — exclude it from the feed list.
  const feedRows = page.items.filter((p) => p.id !== live?.id);

  const reactionRows = await listReactionsForPosts(feedRows.map((p) => p.id));
  const agg = aggregateReactions(reactionRows, actor.userId);

  return {
    meUserId: actor.userId,
    live: live
      ? {
          id: live.id,
          body: live.body,
          authorDisplay: live.author_display,
          liveStartsAt: live.live_starts_at,
          liveJoinUrl: live.live_join_url,
        }
      : null,
    posts: feedRows.map((p) => toFeedPostDto(p, agg)),
    nextCursor: page.nextCursor,
  };
}

// ---------------------------------------------------------------------------
// toggleReaction (RF-CLI-058)
// ---------------------------------------------------------------------------

export async function toggleReaction(
  actor: Actor,
  input: { postId: string; kind: string },
): Promise<{ counts: ReactionCounts; mine: ReactionKind[] }> {
  if (!canViewCommunity(actor)) throw new AuthzError("forbidden_module");
  if (!isReactionKind(input.kind)) throw new CommunityError("INVALID_REACTION");

  const post = await findPostById(input.postId);
  if (!post || !post.is_published || post.org_id !== actor.orgId) {
    throw new CommunityError("POST_NOT_FOUND");
  }

  const existing = await findReaction(input.postId, actor.userId, input.kind);
  if (existing) {
    await deleteReaction(input.postId, actor.userId, input.kind);
  } else {
    await insertReaction(input.postId, actor.userId, input.kind);
  }

  // Recompute the post's aggregate + the viewer's current reactions.
  const rows = await listReactionsForPosts([input.postId]);
  const agg = aggregateReactions(rows, actor.userId);
  const entry = agg.get(input.postId);
  return {
    counts: entry?.counts ?? { heart: 0, fire: 0, clap: 0 },
    mine: entry ? [...entry.mine] : [],
  };
}

// ---------------------------------------------------------------------------
// createPost (staff with `community` module)
// ---------------------------------------------------------------------------

export async function createPost(
  actor: Actor,
  input: {
    kind: string;
    body?: string | null;
    videoUrl?: string | null;
    authorDisplay?: string | null;
    liveStartsAt?: string | null;
    liveJoinUrl?: string | null;
    isPublished?: boolean;
    /** When true the post is a client testimonial (author_staff_id = null). */
    asTestimonial?: boolean;
  },
): Promise<CommunityPostRow> {
  can(actor, "community", "edit");
  if (input.kind !== "text" && input.kind !== "video" && input.kind !== "live") {
    throw new CommunityError("INVALID_KIND");
  }
  // URL hardening: video_url is rendered in an <iframe src> and live_join_url in
  // an <a href>. Reject anything that isn't http(s) so a `javascript:`/`data:`
  // value can never reach the client (React does not sanitize href/src).
  const HTTP_URL = /^https?:\/\//i;
  if (input.videoUrl && !HTTP_URL.test(input.videoUrl)) throw new CommunityError("INVALID_URL");
  if (input.liveJoinUrl && !HTTP_URL.test(input.liveJoinUrl)) throw new CommunityError("INVALID_URL");

  const row = await insertPost({
    orgId: actor.orgId,
    authorStaffId: input.asTestimonial ? null : actor.userId,
    authorDisplay: input.authorDisplay ?? null,
    kind: input.kind,
    body: input.body ?? null,
    videoUrl: input.videoUrl ?? null,
    liveStartsAt: input.liveStartsAt ?? null,
    liveJoinUrl: input.liveJoinUrl ?? null,
    isPublished: input.isPublished ?? true,
  });

  await writeAudit(actor, "community.post.created", "community_posts", row.id, {
    kind: input.kind,
    published: row.is_published,
  });
  return row;
}

// ---------------------------------------------------------------------------
// Staff moderation (list all + publish/unpublish)
// ---------------------------------------------------------------------------

export interface ModerationPostDto {
  id: string;
  kind: string;
  body: string | null;
  authorDisplay: string | null;
  authorStaffId: string | null;
  isPublished: boolean;
  liveStartsAt: string | null;
  createdAt: string;
}

export interface ModerationFeedDto {
  posts: ModerationPostDto[];
  nextCursor: string | null;
}

export async function listPostsForModeration(
  actor: Actor,
  opts: { cursor?: string; limit?: number },
): Promise<ModerationFeedDto> {
  can(actor, "community", "view");
  const page = await listAllPosts(actor.orgId, opts);
  return {
    posts: page.items.map((p) => ({
      id: p.id,
      kind: p.kind,
      body: p.body,
      authorDisplay: p.author_display,
      authorStaffId: p.author_staff_id,
      isPublished: p.is_published,
      liveStartsAt: p.live_starts_at,
      createdAt: p.created_at,
    })),
    nextCursor: page.nextCursor,
  };
}

export async function setPostPublished(
  actor: Actor,
  postId: string,
  published: boolean,
): Promise<void> {
  can(actor, "community", "edit");
  const post = await findPostById(postId);
  if (!post || post.org_id !== actor.orgId) throw new CommunityError("POST_NOT_FOUND");
  await repoSetPostPublished(postId, published);
  await writeAudit(actor, published ? "community.post.published" : "community.post.unpublished", "community_posts", postId, {});
}
