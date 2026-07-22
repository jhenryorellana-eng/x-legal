/**
 * Deterministic value resolution for the USPS mailing cover sheet ("Carátula de
 * Envío"), config-as-data via `ai_generation_configs.mailing_cover`.
 *
 * The document is 100% fixed text except two values — the client's mailing name
 * and the OPLA/OCC address — which come from CONFIRMED companion-questionnaire
 * answers (populated via `field_copy` from the EOIR-26). This module maps the
 * config + resolved answers into the platform renderer's `MailingCoverRenderData`.
 *
 * Pure and side-effect-free (the caller hydrates `inputs` via loadResolvedInputs),
 * so it is unit-testable without a database — mirrors letter-fill.ts.
 */
import type { MailingCoverRenderData } from "@/backend/platform/pdf";
import type { LetterFillInputs } from "./letter-fill";
import type { MailingCoverAnswerRef, MailingCoverConfig } from "./domain";

/** Reads a confirmed answer by form slug + question wording (answers are re-keyed
 *  by wording in loadResolvedInputs). Empty/missing → "". */
function readAnswer(inputs: Pick<LetterFillInputs, "forms">, ref?: MailingCoverAnswerRef | null): string {
  if (!ref) return "";
  const form = inputs.forms.find((f) => f.slug === ref.form_slug);
  const v = form?.answers?.[ref.question];
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v.trim() : String(v);
}

/** Splits a stored address answer (the buscador IA returns a 2-line "street\ncity,
 *  ST ZIP"; field_copy carries the same) into clean, non-empty lines. */
export function splitAddressLines(value: string): string[] {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

const cleanLines = (lines: string[] | undefined): string[] =>
  (lines ?? []).map((l) => l.trim()).filter((l) => l.length > 0);

/** Maps a mailing-cover config + resolved answers into the renderer's data shape. */
export function resolveMailingCoverValues(
  cfg: MailingCoverConfig,
  inputs: Pick<LetterFillInputs, "forms">,
): MailingCoverRenderData {
  const s = cfg.spacing ?? {};
  return {
    senderName: readAnswer(inputs, cfg.sender_name),
    returnAddress: cleanLines(cfg.return_address),
    envelopes: (cfg.envelopes ?? []).map((e) => ({
      recipientLines: cleanLines(e.recipient_lines),
      addressLines: splitAddressLines(readAnswer(inputs, e.address_from)),
    })),
    spacing: {
      blockGapPt: s.block_gap_pt ?? 120,
      lineHeight: s.line_height ?? 1.5,
      fontSizePt: s.font_size_pt ?? 13,
      marginPt: s.margin_pt ?? 96,
    },
  };
}
