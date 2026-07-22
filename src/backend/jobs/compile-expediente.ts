/**
 * QStash job: compile-expediente
 *
 * Re-compiles an expediente into its single filing PDF (merge of the current
 * item PDFs + index of exhibits + Bates). Use to refresh `compiled_pdf_path`
 * after the underlying item PDFs were regenerated (form fills, letter re-renders)
 * without a human clicking "Compilar" — depends on those item PDFs already
 * existing (resolveItemBytes reads filled_pdf_path / output_path).
 *
 * Runs as an org-scoped system actor scoped to a REAL staff user: compile stamps
 * `expedientes.built_by = actor.userId` (FK → staff_profiles), so the actor must
 * carry a real user_id (`requestedBy`) — the generic systemActor's all-zero id
 * would violate the FK. The org still comes from the signed envelope.
 *
 * Boundary: imports ONLY from module-pub (expediente/index.ts), platform/, shared/.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import { systemActor } from "@/backend/platform/authz";
import { compileExpediente } from "@/backend/modules/expediente";

const CompileExpedientePayloadSchema = z.object({
  jobKey: z.literal("compile-expediente"),
  entityId: z.string().uuid(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
  orgId: z.string().uuid(),
  expedienteId: z.string().uuid(),
  // Lax UUID: seeded/demo staff ids (e.g. 00000000-…-0001) are not RFC v4, so
  // z.string().uuid() would reject them and silently drop the job. built_by's FK
  // (staff_profiles) is the real integrity check.
  requestedBy: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
});

export async function handleCompileExpediente(rawPayload: unknown): Promise<void> {
  const parseResult = CompileExpedientePayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "compile-expediente: invalid payload — skipping (non-retryable)",
    );
    return;
  }

  const { expedienteId, orgId, requestedBy } = parseResult.data;
  const actor = { ...systemActor(), orgId, userId: requestedBy };

  logger.info({ job: "compile-expediente", expedienteId }, "compile-expediente: start");

  const result = await compileExpediente(actor, expedienteId);

  logger.info(
    { job: "compile-expediente", expedienteId, pageCount: result.pageCount },
    "compile-expediente: done",
  );
}
