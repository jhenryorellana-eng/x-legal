"use server";

/**
 * Community module — server actions ("use server"; importable by client UI).
 * Each action: requireActor() → service → typed ActionResult.
 */

import { requireActor, AuthzError } from "@/backend/platform/authz";
import { logger } from "@/backend/platform/logger";
import { CommunityError } from "./service";
import * as svc from "./service";
import type { CommunityFeedDto, ModerationFeedDto } from "./service";
import type { ReactionCounts, ReactionKind } from "./domain";

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}

function fail(err: unknown): ActionResult<never> {
  if (err instanceof CommunityError) {
    return { success: false, error: { code: err.code, message: err.code } };
  }
  if (err instanceof AuthzError) {
    return { success: false, error: { code: err.reason ?? "UNAUTHORIZED", message: "Unauthorized" } };
  }
  logger.error({ err }, "community action: unexpected error");
  return { success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } };
}

export async function getCommunityFeedAction(
  opts: { cursor?: string; limit?: number },
): Promise<ActionResult<CommunityFeedDto>> {
  try {
    const actor = await requireActor();
    return ok(await svc.getFeed(actor, opts));
  } catch (err) {
    return fail(err);
  }
}

export async function toggleReactionAction(input: {
  postId: string;
  kind: string;
}): Promise<ActionResult<{ counts: ReactionCounts; mine: ReactionKind[] }>> {
  try {
    const actor = await requireActor();
    return ok(await svc.toggleReaction(actor, input));
  } catch (err) {
    return fail(err);
  }
}

export async function createCommunityPostAction(input: {
  kind: string;
  body?: string | null;
  videoUrl?: string | null;
  authorDisplay?: string | null;
  liveStartsAt?: string | null;
  liveJoinUrl?: string | null;
  isPublished?: boolean;
  asTestimonial?: boolean;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const row = await svc.createPost(actor, input);
    return ok({ id: row.id });
  } catch (err) {
    return fail(err);
  }
}

export async function listPostsForModerationAction(
  opts: { cursor?: string; limit?: number },
): Promise<ActionResult<ModerationFeedDto>> {
  try {
    const actor = await requireActor();
    return ok(await svc.listPostsForModeration(actor, opts));
  } catch (err) {
    return fail(err);
  }
}

export async function setPostPublishedAction(
  postId: string,
  published: boolean,
): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.setPostPublished(actor, postId, published);
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}
