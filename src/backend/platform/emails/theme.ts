/**
 * Brand tokens for transactional + campaign emails (DOC-73 §3.2).
 *
 * Email-safe values only: hex colors and a web-font-with-fallback stack.
 * Used by BrandLayout and the templates; never imported outside platform/emails.
 */

export const COLORS = {
  navy: "#003366",
  accent: "#2F6BFF",
  gold: "#FFC629",
  text: "#1a1a2e",
  muted: "#6b7280",
  body: "#4b5563",
  bg: "#f8f9fa",
  border: "#e5e7eb",
  white: "#ffffff",
} as const;

export const FONT_STACK =
  "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Max content width for single-column email layout (DOC-73 §3.2). */
export const MAX_WIDTH = 600;
