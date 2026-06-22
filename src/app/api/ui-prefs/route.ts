import { NextResponse } from "next/server";
import { getActor, setUserUiPrefs } from "@/backend/modules/identity";

/**
 * Persists the current user's appearance (theme / text scale) to their own
 * `users` row (DOC-01 §4/§8.5). Called fire-and-forget by applyTheme /
 * applyTextScale, so every appearance control persists per-user with no prop
 * threading. Anonymous → 401; any error → 200 ok:false (the client ignores it).
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
    const body = (await req.json().catch(() => ({}))) as {
      theme?: string;
      textScale?: string;
    };
    await setUserUiPrefs(actor, { theme: body.theme, textScale: body.textScale });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
