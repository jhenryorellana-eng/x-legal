/**
 * Client-side answer translation (Feature: client answer translation).
 *
 * When the official PDF is in one language and the client filled the form in
 * another, the textual answers must be translated to the PDF's source language
 * before the AcroForm is filled. This runs best-effort at submit time:
 *
 *   1. On-device Chrome Translator API (via the platform-bridge) — free, private.
 *   2. Server fallback (Gemini) for anything the on-device path couldn't handle.
 *
 * Whatever isn't covered here is translated server-side at PDF-generation time,
 * so this is purely an optimization — it never blocks the submit, and the final
 * PDF is always correct (see generateFilledPdf).
 */

import { getBridge } from "@/frontend/platform-bridge";
import type { WizardGroup, Locale, TranslateAnswersFn } from "./types";

/** Only free-text fields are translated (dates/numbers/selects map to codes). */
const TEXTUAL_FIELDS = new Set(["text", "textarea"]);

export interface AnswerTranslationResult {
  translated: Record<string, string>;
  status: "none" | "partial" | "pending_server" | "done";
}

export async function translateClientAnswers(args: {
  groups: WizardGroup[];
  answers: Record<string, unknown>;
  from: Locale;
  to: Locale;
  serverFallback?: TranslateAnswersFn;
}): Promise<AnswerTranslationResult> {
  const { groups, answers, from, to, serverFallback } = args;

  // No translation needed when the form language matches the client locale.
  if (from === to) return { translated: {}, status: "none" };

  // Collect the textual answers that actually need translating.
  const targets: Array<{ id: string; text: string }> = [];
  for (const g of groups) {
    for (const q of g.questions) {
      if (!TEXTUAL_FIELDS.has(q.fieldType)) continue;
      const v = answers[q.id];
      if (typeof v === "string" && v.trim()) targets.push({ id: q.id, text: v });
    }
  }
  if (targets.length === 0) return { translated: {}, status: "none" };

  const translated: Record<string, string> = {};
  const misses: Array<{ id: string; text: string }> = [];

  // 1) On-device Chrome Translator (best-effort).
  const translator = getBridge().translator;
  const supported = await translator.isSupported().catch(() => false);
  if (supported) {
    for (const t of targets) {
      try {
        const out = await translator.translate(t.text, { from, to });
        if (out != null) translated[t.id] = out;
        else misses.push(t);
      } catch {
        misses.push(t);
      }
    }
  } else {
    misses.push(...targets);
  }

  // 2) Server fallback (Gemini) for whatever the on-device path missed.
  if (misses.length > 0 && serverFallback) {
    try {
      const r = await serverFallback({ items: misses, from, to });
      if (r.ok && r.translations) {
        for (const [id, text] of Object.entries(r.translations)) {
          if (text.trim()) translated[id] = text;
        }
      }
    } catch {
      /* leave the rest for the server-side PDF fill */
    }
  }

  const covered = Object.keys(translated).length;
  // 'pending_server' is also returned when no on-device support AND no
  // serverFallback was provided — the server then translates on-demand at PDF time.
  const status: AnswerTranslationResult["status"] =
    covered >= targets.length ? "done" : covered === 0 ? "pending_server" : "partial";
  return { translated, status };
}
