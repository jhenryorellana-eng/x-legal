/**
 * TEMPORARY diagnostic endpoint (remove after debugging the prod push pipeline).
 * Reports the runtime env enqueueJob depends on + the actual enqueue result/error,
 * so we can see WHY deliver-notification jobs are not reaching QStash in prod.
 * Gated by a secret key. Under api/webhooks/** so it may import the platform layer.
 */
import { NextRequest, NextResponse } from "next/server";
import { enqueueJob } from "@/backend/platform/qstash";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== "dbg-9f3a2c-temp") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const out: Record<string, unknown> = {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? null,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    QSTASH_URL: process.env.QSTASH_URL ?? null,
    QSTASH_TOKEN_present: !!process.env.QSTASH_TOKEN,
    QSTASH_TOKEN_len: (process.env.QSTASH_TOKEN ?? "").length,
    QSTASH_CURRENT_SIGNING_KEY_len: (process.env.QSTASH_CURRENT_SIGNING_KEY ?? "").length,
    VAPID_PRIVATE_KEY_len: (process.env.VAPID_PRIVATE_KEY ?? "").length,
  };

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
    out.enqueue = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      name: e instanceof Error ? e.name : undefined,
    };
  }

  return NextResponse.json(out);
}
