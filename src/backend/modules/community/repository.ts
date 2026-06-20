/**
 * Community module — repository (data access). createServiceClient bypasses
 * RLS; the service enforces actor guards + org scoping (DOC-21 R-pattern).
 */

import { createServiceClient } from "@/backend/platform/supabase";
import type { Tables } from "@/shared/database.types";

export type CommunityPostRow = Tables<"community_posts">;
export type CommunityReactionRow = Tables<"community_reactions">;

export interface PostsPage {
  items: CommunityPostRow[];
  nextCursor: string | null;
}

/** Published posts of an org, newest first, keyset on created_at. */
export async function listPublishedPosts(
  orgId: string,
  opts: { cursor?: string; limit?: number },
): Promise<PostsPage> {
  const limit = opts.limit ?? 20;
  const supabase = createServiceClient();
  let query = supabase
    .from("community_posts")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_published", true)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (opts.cursor) query = query.lt("created_at", opts.cursor);

  const { data, error } = await query;
  if (error) throw new Error(`community.repository: listPublishedPosts failed — ${error.message}`);

  const items = data ?? [];
  const hasMore = items.length > limit;
  if (hasMore) items.pop();
  return { items, nextCursor: hasMore && items.length > 0 ? items[items.length - 1].created_at : null };
}

/** The most recent published live post still within its visible window. */
export async function findActiveLivePost(
  orgId: string,
  sinceIso: string,
): Promise<CommunityPostRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("community_posts")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_published", true)
    .eq("kind", "live")
    .gte("live_starts_at", sinceIso)
    .order("live_starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/** All reactions for a set of posts (for aggregation + the viewer's own state). */
export async function listReactionsForPosts(
  postIds: string[],
): Promise<Pick<CommunityReactionRow, "post_id" | "user_id" | "kind">[]> {
  if (postIds.length === 0) return [];
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("community_reactions")
    .select("post_id, user_id, kind")
    .in("post_id", postIds);
  return data ?? [];
}

export async function findReaction(
  postId: string,
  userId: string,
  kind: string,
): Promise<{ id: string } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("community_reactions")
    .select("id")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .eq("kind", kind)
    .maybeSingle();
  return data ?? null;
}

export async function insertReaction(postId: string, userId: string, kind: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("community_reactions")
    .insert({ post_id: postId, user_id: userId, kind });
  // 23505 (unique) = already reacted (double-tap race) → treat as success.
  if (error && (error as { code?: string }).code !== "23505") {
    throw new Error(`community.repository: insertReaction failed — ${error.message}`);
  }
}

export async function deleteReaction(postId: string, userId: string, kind: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("community_reactions")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", userId)
    .eq("kind", kind);
  if (error) throw new Error(`community.repository: deleteReaction failed — ${error.message}`);
}

/** All posts of an org (published + drafts), newest first — staff moderation. */
export async function listAllPosts(
  orgId: string,
  opts: { cursor?: string; limit?: number },
): Promise<PostsPage> {
  const limit = opts.limit ?? 30;
  const supabase = createServiceClient();
  let query = supabase
    .from("community_posts")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (opts.cursor) query = query.lt("created_at", opts.cursor);

  const { data, error } = await query;
  if (error) throw new Error(`community.repository: listAllPosts failed — ${error.message}`);

  const items = data ?? [];
  const hasMore = items.length > limit;
  if (hasMore) items.pop();
  return { items, nextCursor: hasMore && items.length > 0 ? items[items.length - 1].created_at : null };
}

export async function setPostPublished(postId: string, published: boolean): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("community_posts")
    .update({ is_published: published, updated_at: new Date().toISOString() })
    .eq("id", postId);
  if (error) throw new Error(`community.repository: setPostPublished failed — ${error.message}`);
}

export async function findPostById(postId: string): Promise<CommunityPostRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("community_posts").select("*").eq("id", postId).maybeSingle();
  return data ?? null;
}

export async function insertPost(input: {
  orgId: string;
  authorStaffId: string | null;
  authorDisplay: string | null;
  kind: string;
  body: string | null;
  videoUrl: string | null;
  liveStartsAt: string | null;
  liveJoinUrl: string | null;
  isPublished: boolean;
}): Promise<CommunityPostRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("community_posts")
    .insert({
      org_id: input.orgId,
      author_staff_id: input.authorStaffId,
      author_display: input.authorDisplay,
      kind: input.kind,
      body: input.body,
      video_url: input.videoUrl,
      live_starts_at: input.liveStartsAt,
      live_join_url: input.liveJoinUrl,
      is_published: input.isPublished,
    })
    .select()
    .single();
  if (error || !data) throw new Error(`community.repository: insertPost failed — ${error?.message}`);
  return data;
}
