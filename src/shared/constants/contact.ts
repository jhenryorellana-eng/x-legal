/**
 * Canonical support contact.
 *
 * The single source of truth for the office phone number that every "need
 * help" affordance in the app routes to (WhatsApp + call). The 404 page, the
 * no-access screen, and any future help link import from here so they can
 * never drift apart.
 *
 * To change the number, edit BOTH `SUPPORT_PHONE_E164` (the machine form, used
 * to build the wa.me / tel: links) and `SUPPORT_PHONE_DISPLAY` (the human form
 * shown on screen) — keep them in sync.
 */

/** E.164 machine form: leading `+`, country code, digits only. */
export const SUPPORT_PHONE_E164 = "+14028248171";

/** Human-facing form shown to users. Must represent the same number as above. */
export const SUPPORT_PHONE_DISPLAY = "+1 (402) 824-8171";

/** wa.me expects the international number with no `+`, spaces, or separators. */
export const SUPPORT_WHATSAPP_URL = `https://wa.me/${SUPPORT_PHONE_E164.replace(/[^\d]/g, "")}`;

/** `tel:` dial link for the native phone app. */
export const SUPPORT_TEL_URL = `tel:${SUPPORT_PHONE_E164}`;
