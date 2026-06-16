/**
 * Email HTML sanitizer (DOC-73 §6, BLOCKER-3).
 *
 * Campaign body HTML is authored by staff (campaigns:edit) but is then sent —
 * under the UsaLatinoPrime brand — to real client inboxes via Resend. A
 * compromised or careless staff account could otherwise embed phishing,
 * tracking pixels, or scripts. We sanitize ONCE at write time with an
 * email-safe allowlist (blocks <script>/<iframe>/<form>, on* handlers, and
 * javascript:/data: URIs).
 */

import sanitizeHtml from "sanitize-html";

export function sanitizeCampaignHtml(dirty: string): string {
  return sanitizeHtml(dirty, {
    allowedTags: [
      "p", "br", "strong", "b", "em", "i", "u", "s",
      "a", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "blockquote",
      "img", "span", "div", "hr", "table", "tr", "td", "th", "tbody", "thead",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      span: ["style"],
      div: ["style"],
      p: ["style"],
      td: ["style", "colspan", "rowspan"],
      th: ["style", "colspan", "rowspan"],
      table: ["style", "width"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"] },
    // Force safe link rels; drop everything not allow-listed (incl. on* handlers).
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true),
    },
    disallowedTagsMode: "discard",
    allowedStyles: {
      "*": {
        color: [/^#(0x)?[0-9a-fA-F]+$/, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/],
        "text-align": [/^left$|^right$|^center$|^justify$/],
        "font-weight": [/^bold$|^normal$|^\d{3}$/],
        "font-size": [/^\d{1,2}px$/],
      },
    },
  });
}
