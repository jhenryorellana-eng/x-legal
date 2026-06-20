"use client";

import * as React from "react";
import {
  buildNotificationActions,
  type RawNotificationActions,
} from "@/frontend/features/notifications/build-notification-actions";
import { NotificationCenter } from "@/frontend/features/notifications/notification-center";
import type { NotificationVM } from "@/frontend/features/notifications/types";

export interface AvisosClientProps {
  userId: string;
  locale: "es" | "en";
  initial: NotificationVM[];
  initialCursor: string | null;
  raw: RawNotificationActions;
}

export function AvisosClient({ userId, locale, initial, initialCursor, raw }: AvisosClientProps) {
  const actions = React.useMemo(() => buildNotificationActions(raw, locale), [raw, locale]);
  return (
    <div style={{ padding: "20px 16px var(--screen-pb)", minHeight: "100dvh" }}>
      <NotificationCenter
        userId={userId}
        locale={locale}
        initial={initial}
        initialCursor={initialCursor}
        actions={actions}
        variant="page"
      />
    </div>
  );
}
