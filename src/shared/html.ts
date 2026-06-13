/**
 * Minimal HTML escaping utility (M-2 fix).
 *
 * Used by: backend/jobs/deliver-notification.ts (email body)
 *          backend/modules/identity/service.ts (staff invite email)
 *
 * Only the five characters that can create XSS vectors in HTML attribute
 * values or text nodes are replaced. This is intentionally narrow — a
 * full sanitiser belongs to a rendering layer, not here.
 */
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
