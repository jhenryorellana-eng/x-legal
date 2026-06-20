/**
 * Admin · Comunidad — staff surface to publish + moderate community posts
 * (RF-CLI-055, 7d "moderación staff"). Requires the `community` module (admin
 * bypasses). Injects the create/setPublished/reload actions into the client.
 */

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { listPostsForModeration } from "@/backend/modules/community";
import {
  createCommunityPostAction,
  setPostPublishedAction,
  listPostsForModerationAction,
} from "@/backend/modules/community/actions";
import { CommunityAdmin } from "@/frontend/features/community/community-admin";

export default async function AdminComunidadPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as "es" | "en";

  // Gate by the community module (admin bypasses). No access → back to dashboard.
  let posts;
  try {
    const r = await listPostsForModeration(actor, { limit: 30 });
    posts = r.posts;
  } catch {
    redirect("/admin");
  }

  return (
    <CommunityAdmin
      locale={locale}
      initialPosts={posts}
      actions={{
        create: createCommunityPostAction,
        setPublished: setPostPublishedAction,
        reload: listPostsForModerationAction,
      }}
    />
  );
}
