/**
 * Compose a serialisable `LexBubbleVM` from a `LexInsight` + translators.
 *
 * Kept free of next-intl: the server page passes already-bound translator
 * functions (built from `getTranslations("staff.lex")`), so this stays a pure
 * mapping and the engine/types module never imports i18n. The `<b>` markup tag
 * renders insight emphasis in the accent colour.
 */
import { escapeHtml } from "@/shared/html";
import type { LexBubbleVM, LexInsight } from "./types";

export interface LexTranslators {
  /** Plain translation: `t(key, values?)`. */
  t: (key: string, values?: Record<string, unknown>) => string;
  /** Rich translation with markup tags: `t.markup(key, values)`. */
  markup: (key: string, values: Record<string, unknown>) => string;
}

/**
 * Adapt a next-intl translator scoped to `staff.lex` into `LexTranslators`.
 * Kept free of next-intl imports: it only relies on the call + `.markup` shape,
 * so the page passes `await getTranslations("staff.lex")` and this stays pure.
 */
export function lexTranslators(tRaw: unknown): LexTranslators {
  const t = tRaw as {
    (key: string, values?: Record<string, unknown>): string;
    markup: (key: string, values: Record<string, unknown>) => string;
  };
  return {
    t: (key, values) => t(key, values),
    markup: (key, values) => t.markup(key, values),
  };
}

export function composeLexBubble(
  tr: LexTranslators,
  insight: LexInsight | null,
): LexBubbleVM | null {
  if (!insight) return null;
  // The composed string is rendered via dangerouslySetInnerHTML, so the ONLY
  // raw markup allowed is the `b` tag we introduce here. Interpolated string
  // params can be staff-editable free text (e.g. a lead's name) — escape them
  // (next-intl does NOT escape plain arg values). Numbers pass through (needed
  // as-is for ICU plural selection and can't carry markup).
  const safeParams: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(insight.params)) {
    safeParams[key] = typeof value === "string" ? escapeHtml(value) : value;
  }
  return {
    dismissKey: insight.id,
    html: tr.markup(insight.messageKey, {
      b: (chunks: string) => `<b>${chunks}</b>`,
      ...safeParams,
    }),
    actions: insight.actions.map((a) => ({
      id: a.id,
      label: tr.t(a.labelKey, a.labelParams),
      href: a.href,
      ghost: a.ghost,
      icon: a.icon,
    })),
  };
}
