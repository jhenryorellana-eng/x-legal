/**
 * Unsubscribe endpoint — /api/unsubscribe?c=&u=&t= (DOC-73 §3.2, CAN-SPAM).
 *
 * The HMAC token (t) is the authentication — no session required. To avoid
 * email security scanners (Proofpoint/Mimecast/Safe Browsing) opting users out
 * by pre-fetching the link, the GET is a confirmation page; the actual opt-out
 * happens on POST (STRONG-1, RFC 8058 one-click compatible).
 */

import { type NextRequest } from "next/server";
import { unsubscribeByToken } from "@/backend/modules/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeAttr(v: string): string {
  return v.replace(/[<>"'&]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function shell(title: string, inner: string): Response {
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f8f9fa;color:#1a1a2e;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="max-width:480px;background:#fff;border-radius:16px;padding:40px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.08)">
<div style="font-size:20px;font-weight:800;color:#003366;margin-bottom:16px">X <span style="color:#2F6BFF">LEGAL</span></div>
${inner}
</div></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function message(title: string, body: string): Response {
  return shell(title, `<h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0">${body}</p>`);
}

/** GET → confirmation page (no side effect; safe for link scanners). */
export async function GET(request: NextRequest): Promise<Response> {
  const sp = request.nextUrl.searchParams;
  const c = sp.get("c") ?? "";
  const u = sp.get("u") ?? "";
  const t = sp.get("t") ?? "";

  if (!c || !u || !t) {
    return message("Enlace inválido", "Este enlace de baja no es válido. Si quieres dejar de recibir novedades, contáctanos.");
  }

  return shell(
    "Darse de baja",
    `<h1 style="font-size:20px;margin:0 0 8px">¿Dejar de recibir novedades?</h1>
<p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 20px">Seguirás recibiendo notificaciones importantes sobre tu caso.</p>
<form method="POST" action="/api/unsubscribe">
<input type="hidden" name="c" value="${escapeAttr(c)}">
<input type="hidden" name="u" value="${escapeAttr(u)}">
<input type="hidden" name="t" value="${escapeAttr(t)}">
<button type="submit" style="background:#2F6BFF;color:#fff;border:none;border-radius:999px;padding:12px 28px;font-size:15px;font-weight:700;cursor:pointer">Confirmar baja</button>
</form>`,
  );
}

/** POST → performs the opt-out (RFC 8058 one-click compatible). */
export async function POST(request: NextRequest): Promise<Response> {
  let c = "";
  let u = "";
  let t = "";
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    c = String(form.get("c") ?? "");
    u = String(form.get("u") ?? "");
    t = String(form.get("t") ?? "");
  } else {
    const sp = request.nextUrl.searchParams;
    c = sp.get("c") ?? "";
    u = sp.get("u") ?? "";
    t = sp.get("t") ?? "";
  }

  if (!c || !u || !t) {
    return message("Enlace inválido", "No pudimos verificar tu solicitud de baja.");
  }

  const result = await unsubscribeByToken(c, u, t);
  if (!result.ok) {
    return message("Enlace inválido", "No pudimos verificar tu solicitud de baja. Si quieres dejar de recibir novedades, contáctanos.");
  }

  return message(
    "Te diste de baja",
    "Ya no recibirás correos de novedades de UsaLatinoPrime. Seguirás recibiendo notificaciones importantes sobre tu caso.",
  );
}
