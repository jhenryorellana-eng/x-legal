/**
 * QStash job: regenerate-form-pdf
 *
 * Re-fills and re-stamps a form response's official PDF from its CURRENT answers
 * (deterministic AcroForm fill + signature stamp; may run one ES→EN translation
 * for free-text). Use to refresh `filled_pdf_path` after a source input changed
 * (e.g. a document-extraction field corrected) without a human clicking
 * "Actualizar PDF".
 *
 * Runs as an org-scoped system actor: the generic systemActor() carries an
 * all-zero orgId, but requireCaseAccess demands the actor's org match the case's,
 * so we scope it to the case's org (carried in the signed job envelope).
 *
 * Boundary: imports ONLY from module-pub (cases/index.ts), platform/, shared/.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import { systemActor } from "@/backend/platform/authz";
import { generateFilledPdf } from "@/backend/modules/cases";

const RegenerateFormPdfPayloadSchema = z.object({
  jobKey: z.literal("regenerate-form-pdf"),
  entityId: z.string().uuid(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
  orgId: z.string().uuid(),
  responseId: z.string().uuid(),
});

export async function handleRegenerateFormPdf(rawPayload: unknown): Promise<void> {
  const parseResult = RegenerateFormPdfPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "regenerate-form-pdf: invalid payload — skipping (non-retryable)",
    );
    return;
  }

  const { responseId, orgId } = parseResult.data;
  const actor = { ...systemActor(), orgId };

  logger.info({ job: "regenerate-form-pdf", responseId }, "regenerate-form-pdf: start");

  const path = await generateFilledPdf(actor, { responseId });

  logger.info({ job: "regenerate-form-pdf", responseId, path }, "regenerate-form-pdf: done");
}
