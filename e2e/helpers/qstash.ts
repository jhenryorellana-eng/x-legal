/**
 * E2E QStash helper — runs a job handler through the real webhook route.
 *
 * QStash does not deliver to localhost, so specs that need a job to run (e.g.
 * the legal generation T1 after `startGeneration` enqueues it) POST the payload
 * to `/api/webhooks/qstash/[job]` with the `x-e2e-qstash-bypass` header.
 *
 * The route's `verifyQStashSignature` accepts the bypass ONLY when the AI stub
 * is active (`AI_E2E_STUB=1`, impossible in production) AND this header is
 * present — see src/backend/platform/qstash.ts. So the dev server MUST run with
 * `AI_E2E_STUB=1` (npm run dev:e2e) for these helpers to work.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/** POSTs a job payload to the real QStash webhook route (bypassing the signature). */
export async function runQStashJob(
  jobKey: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE_URL}/api/webhooks/qstash/${jobKey}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-e2e-qstash-bypass": "1",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  return { status: res.status, body };
}

/** Runs the run-generation job for a queued run (T1). */
export async function runGenerationJob(runId: string, version: number): Promise<void> {
  await runQStashJob("run-generation", {
    jobKey: "run-generation",
    entityId: runId,
    runId,
    attempt: 1,
    dedupeId: `run-generation:${runId}:v${version}`,
  });
}
