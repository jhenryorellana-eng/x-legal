/**
 * Avisos — `/avisos` · nivel CUENTA (DOC-51 + DOC-47 §5.3).
 *
 * Server component: loads the first page of the client's notifications and
 * injects the notifications server actions into the client NotificationCenter
 * (realtime user:{id} + markRead/markAll + load more).
 */

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getNotifications } from "@/backend/modules/notifications";
import {
  listNotificationsAction,
  markNotificationReadAction,
  markAllNotificationsReadAction,
  getUnreadCountAction,
} from "@/backend/modules/notifications/actions";
import { mapNotificationRow } from "@/frontend/features/notifications/types";
import { AvisosClient } from "./avisos-client";

export default async function AvisosPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as "es" | "en";
  const page = await getNotifications(actor, { limit: 20 });
  const initial = page.items.map((r) => mapNotificationRow(r as unknown as Record<string, unknown>, locale));

  return (
    <AvisosClient
      userId={actor.userId}
      locale={locale}
      initial={initial}
      initialCursor={page.nextCursor}
      raw={{
        list: listNotificationsAction,
        markRead: markNotificationReadAction,
        markAllRead: markAllNotificationsReadAction,
        getUnreadCount: getUnreadCountAction,
      }}
    />
  );
}
