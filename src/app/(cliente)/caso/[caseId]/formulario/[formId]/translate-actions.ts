"use server";

/**
 * Server-side answer translation fallback (Feature: client answer translation).
 *
 * The client first tries the on-device Chrome Translator API via
 * getBridge().translator. When that's unavailable (non-Chrome, model not
 * downloaded) the wizard calls this action, which delegates to the existing
 * Gemini translator (ai-engine). Best-effort: a failed item is simply omitted —
 * generateFilledPdf translates any remaining gaps on-demand at PDF time.
 *
 * Boundary R1: app → module-pub (identity, ai-engine) only.
 */

import { requireActor } from "@/backend/modules/identity";
import { translateAnswerText } from "@/backend/modules/ai-engine";

export interface TranslateAnswersResult {
  ok: boolean;
  translations?: Record<string, string>;
  error?: { code: string };
}

export async function translateAnswersAction(input: {
  items: Array<{ id: string; text: string }>;
  from: "en" | "es";
  to: "en" | "es";
}): Promise<TranslateAnswersResult> {
  try {
    await requireActor();
    if (input.from === input.to) {
      return { ok: true, translations: Object.fromEntries(input.items.map((i) => [i.id, i.text])) };
    }
    const direction = `${input.from}-${input.to}` as "es-en" | "en-es";
    const translations: Record<string, string> = {};
    for (const item of input.items) {
      if (!item.text.trim()) continue;
      try {
        const r = await translateAnswerText({ text: item.text, direction });
        if (r.text.trim()) translations[item.id] = r.text;
      } catch {
        // skip this item — best-effort
      }
    }
    return { ok: true, translations };
  } catch {
    return { ok: false, error: { code: "TRANSLATE_FAILED" } };
  }
}
