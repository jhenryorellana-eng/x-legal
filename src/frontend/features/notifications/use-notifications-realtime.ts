"use client";

/**
 * useNotificationsRealtime — subscribes to `user:{userId}` (DOC-25 §1.1) and
 * fires onNew for each INSERT into `notifications` for this user. Private channel
 * ({private:true} + setAuth) so the `realtime.messages` RLS ("rt user select")
 * authorizes it. Degrades to 60 s polling if SUBSCRIBED is not reached (§1.6).
 */

import * as React from "react";
import { getBrowserSupabase } from "@/frontend/lib/supabase-browser";
import { mapNotificationRow, type NotificationVM } from "./types";

export interface UseNotificationsRealtimeArgs {
  userId: string;
  locale: "es" | "en";
  onNew: (n: NotificationVM) => void;
  /** Poll fallback: refetch unread badge + latest when realtime is degraded. */
  onPollTick: () => void;
}

export function useNotificationsRealtime(args: UseNotificationsRealtimeArgs): {
  connected: boolean;
  degraded: boolean;
} {
  const [connected, setConnected] = React.useState(false);
  const [degraded, setDegraded] = React.useState(false);
  const argsRef = React.useRef(args);
  argsRef.current = args;

  React.useEffect(() => {
    const supabase = getBrowserSupabase();
    let cancelled = false;
    let isSubscribed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let subscribeTimeout: ReturnType<typeof setTimeout> | null = null;

    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(() => argsRef.current.onPollTick(), 60_000);
    }
    function stopPolling() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
    function armDegradeTimer() {
      if (subscribeTimeout) clearTimeout(subscribeTimeout);
      subscribeTimeout = setTimeout(() => {
        if (!isSubscribed && !cancelled) { setDegraded(true); startPolling(); }
      }, 30_000);
    }

    async function setup() {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);
      if (cancelled) return;

      channel = supabase
        .channel(`user:${args.userId}`, { config: { private: true } })
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${args.userId}` },
          (payload) => {
            if (!cancelled) argsRef.current.onNew(mapNotificationRow(payload.new as Record<string, unknown>, argsRef.current.locale));
          },
        )
        .subscribe((status: string) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            isSubscribed = true;
            setConnected(true);
            setDegraded(false);
            if (subscribeTimeout) { clearTimeout(subscribeTimeout); subscribeTimeout = null; }
            stopPolling();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setConnected(false);
            if (isSubscribed) { isSubscribed = false; armDegradeTimer(); }
          }
        });

      armDegradeTimer();
    }

    void setup();

    return () => {
      cancelled = true;
      if (subscribeTimeout) clearTimeout(subscribeTimeout);
      stopPolling();
      if (channel) supabase.removeChannel(channel);
    };
  }, [args.userId]);

  return { connected, degraded };
}
