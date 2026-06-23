/**
 * Messaging module — pure domain (DOC-46). NO I/O; testable with zero mocks.
 *
 * @module messaging/domain
 */

export type ConversationScope = "case" | "lead" | "support";
export type MessageKind = "text" | "system" | "attachment" | "call_summary";

/** Closed registry of system message keys (DOC-46 §2.4) — bilingual, NO AI. */
export type SystemMessageKey =
  | "sys.downpayment_confirmed"
  | "sys.installment_paid"
  | "sys.appointment_booked"
  | "sys.document_approved"
  | "sys.phase_advanced";

export interface AttachmentRef {
  path: string;
  name: string;
  mime: string;
  size: number;
}

// ---------------------------------------------------------------------------
// Unread predicate (RF-TRX-017)
// ---------------------------------------------------------------------------

/**
 * A message counts as unread for a reader iff it is not a system message, was
 * not sent by the reader, and is newer than the reader's last_read_at.
 * Pure mirror of the SQL predicate used by countUnreadAggregate (for tests).
 */
export function isUnread(
  msg: { kind: MessageKind; senderUserId: string | null; createdAt: string },
  readerUserId: string,
  lastReadAt: string | null,
): boolean {
  if (msg.kind === "system") return false;
  if (msg.senderUserId === readerUserId) return false;
  const threshold = lastReadAt ?? "1970-01-01T00:00:00.000Z";
  return msg.createdAt > threshold;
}

// ---------------------------------------------------------------------------
// System messages (DOC-46 §2.4) — bilingual from a closed template, no AI
// ---------------------------------------------------------------------------

type Bilingual = { es: string; en: string };

export const SYSTEM_MESSAGE_TEMPLATES: Record<
  SystemMessageKey,
  (vars?: Record<string, string | number>) => Bilingual
> = {
  "sys.downpayment_confirmed": () => ({
    es: "Tu pago inicial fue confirmado. ¡Bienvenido! Tu caso ya está activo.",
    en: "Your down payment was confirmed. Welcome! Your case is now active.",
  }),
  "sys.installment_paid": (v) => ({
    es: `Recibimos tu pago de la cuota ${v?.number ?? ""}. ¡Gracias!`.trim(),
    en: `We received your payment for installment ${v?.number ?? ""}. Thank you!`.trim(),
  }),
  "sys.appointment_booked": () => ({
    es: "Tu cita quedó agendada. La verás en tu calendario.",
    en: "Your appointment is booked. You'll see it in your calendar.",
  }),
  "sys.document_approved": () => ({
    es: "Tu documento fue revisado y aprobado.",
    en: "Your document was reviewed and approved.",
  }),
  "sys.phase_advanced": (v) => ({
    es: `Tu caso avanzó a la fase: ${v?.phase ?? ""}`.trim(),
    en: `Your case advanced to phase: ${v?.phase ?? ""}`.trim(),
  }),
};

/**
 * Renders a system message: `body` in Spanish (primary), `body_translated` the
 * English mirror. Deterministic, no AI.
 */
export function renderSystemMessage(
  key: SystemMessageKey,
  vars?: Record<string, string | number>,
): { body: string; bodyTranslated: { lang: "en"; text: string } } {
  const t = SYSTEM_MESSAGE_TEMPLATES[key](vars);
  return { body: t.es, bodyTranslated: { lang: "en", text: t.en } };
}

// ---------------------------------------------------------------------------
// Participant set for a case conversation (DOC-46 §2.1)
// ---------------------------------------------------------------------------

/**
 * case participants = case client members ∪ assigned paralegal ∪ assigned sales
 * ∪ org admins. Deduplicated; nulls dropped.
 */
export function computeCaseParticipantIds(input: {
  caseMemberIds: string[];
  paralegalId: string | null;
  salesId: string | null;
  adminIds: string[];
}): string[] {
  const set = new Set<string>();
  for (const id of input.caseMemberIds) set.add(id);
  if (input.paralegalId) set.add(input.paralegalId);
  if (input.salesId) set.add(input.salesId);
  for (const id of input.adminIds) set.add(id);
  return [...set];
}

// ---------------------------------------------------------------------------
// Presentation helpers (DOC-46 §6 / PROMPT-VAN-07, PROMPT-CLI-27)
// Pure + deterministic so the same person always renders the same color/initials
// on the client overlay AND the staff panel (no drift between surfaces).
// ---------------------------------------------------------------------------

/**
 * Brand-aligned palette for sender-name coloring in group bubbles. Mirrors the
 * prototype's violet/cyan/amber accents (Diana/Andrium/Giuseppe) and extends
 * with brand blue/green/red so larger teams stay distinguishable.
 */
export const SENDER_PALETTE = [
  "#8B5CF6", // violet
  "#06B6D4", // cyan
  "#F59E0B", // amber
  "#2F6BFF", // brand blue (accent)
  "#1BB673", // brand green
  "#E4002B", // brand red
  "#7C3AED", // deep violet
  "#0EA5E9", // sky
] as const;

/**
 * Deterministic color for a sender, keyed by a stable seed (the user id). Same
 * person → same color across every conversation and surface; scales past the 3
 * hardcoded prototype names without collisions for small teams.
 */
export function senderColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return SENDER_PALETTE[h % SENDER_PALETTE.length];
}

/**
 * Avatar initials: first+last initial for multi-word names ("Sofía Cabrera" →
 * "SC"), first two letters for a single word ("Diana" → "DI"), "?" when empty.
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Last message preview for a conversation row in the inbox list. */
export interface SnippetSource {
  kind: MessageKind;
  body: string | null;
  senderUserId: string | null;
  senderName: string | null;
  attachmentName: string | null;
}

/**
 * Inbox snippet (PROMPT-VAN-07): text messages are prefixed with "Tú: " (own)
 * or the sender's first name ("Diana: …"); attachments show "📎 {file}" with no
 * prefix; system messages show their raw body. Empty when there is no message.
 */
export function conversationSnippet(last: SnippetSource | null, meUserId: string): string {
  if (!last) return "";
  if (last.kind === "attachment") return `📎 ${last.attachmentName ?? "Adjunto"}`;
  if (last.kind === "system") return last.body ?? "";
  const who = last.senderUserId === meUserId ? "Tú" : last.senderName?.trim().split(/\s+/)[0] ?? null;
  const prefix = who ? `${who}: ` : "";
  return `${prefix}${last.body ?? ""}`;
}

// ---------------------------------------------------------------------------
// Attachment ref validation (shape only; storage validates bytes/MIME)
// ---------------------------------------------------------------------------

export function validateAttachmentRefs(refs: unknown): AttachmentRef[] {
  if (!Array.isArray(refs)) return [];
  const out: AttachmentRef[] = [];
  for (const r of refs) {
    if (
      r &&
      typeof r === "object" &&
      typeof (r as AttachmentRef).path === "string" &&
      typeof (r as AttachmentRef).name === "string" &&
      typeof (r as AttachmentRef).mime === "string" &&
      typeof (r as AttachmentRef).size === "number"
    ) {
      const ref = r as AttachmentRef;
      out.push({ path: ref.path, name: ref.name, mime: ref.mime, size: ref.size });
    }
  }
  return out;
}
