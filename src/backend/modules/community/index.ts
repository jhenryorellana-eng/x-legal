/**
 * Community module — public API (module-pub boundary).
 */

export {
  getFeed,
  toggleReaction,
  createPost,
  listPostsForModeration,
  setPostPublished,
  CommunityError,
} from "./service";
export type {
  CommunityFeedDto,
  FeedPostDto,
  LiveBannerDto,
  ModerationFeedDto,
  ModerationPostDto,
} from "./service";
export type { ReactionKind, ReactionCounts, PostKind } from "./domain";
