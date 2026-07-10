/**
 * QStash job: generate-questionnaire (Ola 3)
 *
 * Asynchronous per-case AI generation of a personalized questionnaire (deep,
 * grounded follow-up questions read from the client's I-589 + uploaded documents).
 * Dispatched by ai-engine.startQuestionnaireGeneration().
 *
 * Idempotency / recovery:
 *   - dedupeId = generate-questionnaire:<caseId>:<formId>:<party> (one job per
 *     case/form/party even if a double-open creates two instances)
 *   - the runner resolves the CURRENT instance and reprocesses 'queued' OR a
 *     crash-stuck 'generating'; terminal states (ready/failed) short-circuit
 *
 * Retries: 2 (DOC-26 §5). On exhaustion, the job-failed callback
 * (markQuestionnaireGenerationFailed) marks the current instance 'failed'.
 *
 * Boundary: imports ONLY from module-pub (ai-engine/index.ts), platform/, shared/.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import { executeQuestionnaireGenerationJob } from "@/backend/modules/ai-engine";

const GenerateQuestionnairePayloadSchema = z.object({
  jobKey: z.literal("generate-questionnaire"),
  entityId: z.string().uuid(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
  caseId: z.string().uuid(),
  formDefinitionId: z.string().uuid(),
  partyId: z.string().uuid().nullable().default(null),
});

export async function handleGenerateQuestionnaire(rawPayload: unknown): Promise<void> {
  const parsed = GenerateQuestionnairePayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    logger.error(
      { issues: parsed.error.issues },
      "generate-questionnaire: invalid payload — skipping (non-retryable)",
    );
    return;
  }
  const { caseId, formDefinitionId, partyId, attempt } = parsed.data;

  logger.info({ job: "generate-questionnaire", caseId, formDefinitionId, partyId, attempt }, "generate-questionnaire: start");

  const outcome = await executeQuestionnaireGenerationJob({ caseId, formDefinitionId, partyId });

  logger.info({ job: "generate-questionnaire", caseId, formDefinitionId, outcome }, "generate-questionnaire: done");
}
