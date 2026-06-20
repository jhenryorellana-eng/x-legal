"use client";

/**
 * useConversationRealtime — subscribes to `conv:{id}` via Realtime
 * postgres_changes on `messages` (DOC-25). Private channel: setAuth(token) +
 * {private:true} so the `realtime.messages` RLS policies apply.
 *
 * Degradation: if not SUBSCRIBED within 30 s, fall back to polling loadSince()
 * every 10 s; on a later SUBSCRIBED, stop polling and run one catch-up.
 */

import * as React from "react";
import { getBrowserSupabase } from "@/frontend/lib/supabase-browser";
import { mapMessageRow, type ChatMessageVM } from "./types";

export interface UseConversationRealtimeArgs {
  conversationId: string;
  /** Newest message createdAt seen by the component (for catch-up + polling). */
  getLastSeenIso: () => string | null;
  /** De-dupe by id in the component. */
  onNewMessage: (m: ChatMessageVM) => void;
  /** Fetch messages strictly newer than `afterIso` (server action). */
  loadSince: (afterIso: string) => Promise<ChatMessageVM[]>;
}

export function useConversationRealtime(args: UseConversationRealtimeArgs): {
  connected: boolean;
  degraded: boolean;
} {
  const [connected, setConnected] = React.useState(false);
  const [degraded, setDegraded] = React.useState(false);

  // Keep latest callbacks in a ref so the effect only re-runs on conversationId change.
  const argsRef = React.useRef(args);
  argsRef.current = args;

  React.useEffect(() => {
    const supabase = getBrowserSupabase();
    let cancelled = false;
    let isSubscribed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let subscribeTimeout: ReturnType<typeof setTimeout> | null = null;

    async function pump() {
      const since = argsRef.current.getLastSeenIso();
      if (!since) return;
      try {
        const msgs = await argsRef.current.loadSince(since);
        for (const m of msgs) argsRef.current.onNewMessage(m);
      } catch {
        /* transient; next tick retries */
      }
    }

    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(pump, 10_000);
    }
    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function armDegradeTimer() {
      if (subscribeTimeout) clearTimeout(subscribeTimeout);
      subscribeTimeout = setTimeout(() => {
        if (!isSubscribed && !cancelled) {
          setDegraded(true);
          startPolling();
        }
      }, 30_000);
    }

    async function setup() {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);
      if (cancelled) return;

      channel = supabase
        .channel(`conv:${args.conversationId}`, { config: { private: true } })
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${args.conversationId}`,
          },
          (payload) => {
            if (!cancelled) argsRef.current.onNewMessage(mapMessageRow(payload.new as Record<string, unknown>));
          },
        )
        .subscribe((status: string) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            isSubscribed = true;
            setConnected(true);
            setDegraded(false);
            if (subscribeTimeout) {
              clearTimeout(subscribeTimeout);
              subscribeTimeout = null;
            }
            stopPolling();
            void pump(); // catch-up any gap
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setConnected(false);
            // Transient drop after a successful subscribe: re-arm the degrade
            // window so we fall back to polling if it doesn't recover (STRONG-1).
            if (isSubscribed) {
              isSubscribed = false;
              armDegradeTimer();
            }
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
  }, [args.conversationId]);

  return { connected, degraded };
}
