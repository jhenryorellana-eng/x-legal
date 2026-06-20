/**
 * Browser Supabase client singleton (anon key) — used ONLY for Realtime
 * subscriptions on the client (DOC-25). All data mutations go through server
 * actions; this client never performs privileged reads/writes.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/shared/database.types";

let _client: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function getBrowserSupabase() {
  return (_client ??= createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  ));
}
