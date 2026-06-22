/**
 * TEMPORARY diagnostic endpoint (remove after debugging the prod push pipeline).
 * `?key=...`            → reports runtime env + enqueueJob result.
 * `?key=...&mode=send`  → calls the prod sendPush (webpush.ts) directly against the
 *                         test client's real subscriptions, returning FCM status —
 *                         this isolates the job's actual push send from QStash.
 * Under api/webhooks/** so it may import the platform layer.
 */
import { NextRequest, NextResponse } from "next/server";
import { enqueueJob } from "@/backend/platform/qstash";
import { sendPush } from "@/backend/platform/webpush";
import { createServiceClient } from "@/backend/platform/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== "dbg-9f3a2c-temp") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const out: Record<string, unknown> = {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? null,
    QSTASH_URL: process.env.QSTASH_URL ?? null,
    VAPID_PRIVATE_KEY_len: (process.env.VAPID_PRIVATE_KEY ?? "").length,
    VAPID_PUBLIC_KEY_len: (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").length,
  };

  if (req.nextUrl.searchParams.get("mode") === "send") {
    // Test the EXACT prod sendPush against the client's real subscriptions.
    try {
      const sb = createServiceClient();
      const { data: user } = await sb
        .from("users")
        .select("id")
        .eq("email", "carlos.mendoza.test@example.com")
        .single();
      const { data: subs } = await sb
        .from("push_subscriptions")
        .select("endpoint, keys")
        .eq("user_id", user!.id);
      const results: unknown[] = [];
      for (const s of subs ?? []) {
        const keys = s.keys as { p256dh: string; auth: string };
        try {
          const r = await sendPush(
            { endpoint: s.endpoint, keys },
            {
              title: "🔔 Debug sendPush (prod)",
              body: "Enviado por sendPush() de prod directo.",
              url: "/home",
              tag: "message.received",
              icon: "/icons/icon-192.png",
            },
          );
          results.push({ ep: s.endpoint.slice(34, 52), stale: r.stale });
        } catch (e) {
          results.push({
            ep: s.endpoint.slice(34, 52),
            error: e instanceof Error ? e.message : String(e),
            status: (e as { statusCode?: number })?.statusCode ?? null,
          });
        }
      }
      out.sendPush = results;
    } catch (e) {
      out.sendPushError = e instanceof Error ? e.message : String(e);
    }
    return NextResponse.json(out);
  }

  try {
    const r = await enqueueJob({
      jobKey: "deliver-notification",
      entityId: "debug",
      attempt: 1,
      dedupeId: "debug-" + Date.now(),
      channel: "push",
      notificationId: "debug",
    });
    out.enqueue = { ok: true, messageId: r.messageId };
  } catch (e) {
    out.enqueue = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return NextResponse.json(out);
}
