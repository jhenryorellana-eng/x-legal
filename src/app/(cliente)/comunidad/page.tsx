/**
 * Comunidad — `/comunidad` · nivel CUENTA (DOC-51, RF-CLI-055..058).
 *
 * Server component: free + clients-only community feed. Loads the first page +
 * the live banner and injects the toggle/loadMore server actions into the
 * client CommunityFeed.
 */

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getFeed } from "@/backend/modules/community";
import {
  getCommunityFeedAction,
  toggleReactionAction,
} from "@/backend/modules/community/actions";
import { CommunityFeed } from "@/frontend/features/community/community-feed";

export default async function ComunidadPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as "es" | "en";
  const feed = await getFeed(actor, { limit: 20 });

  return (
    <CommunityFeed
      locale={locale}
      initial={feed}
      actions={{
        toggleReaction: toggleReactionAction,
        loadMore: getCommunityFeedAction,
      }}
    />
  );
}
