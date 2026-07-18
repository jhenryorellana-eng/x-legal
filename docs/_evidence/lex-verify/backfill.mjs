// docs/_evidence/lex-verify/backfill.mjs
//
// One-time backfill of the Lex case-knowledge index for cases that predate the
// feature (no document/form event will ever fire for them, so the event-driven
// reindex never runs; the lazy bootstrap in getLexThread covers them too, but
// this warms every case up-front so the first staff question is never blind).
//
// Run from the repo root (needs .env.local with Supabase service role + GEMINI):
//   npx tsx docs/_evidence/lex-verify/backfill.mjs            # all cases
//   npx tsx docs/_evidence/lex-verify/backfill.mjs <caseId>…  # specific cases
//
// ALWAYS real embeddings: AI_E2E_STUB is force-cleared — stub vectors must
// never be persisted (a real query embedding against stub chunk vectors would
// retrieve nonsense).

import { readFileSync } from "node:fs";
import path from "node:path";

const envFile = readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
for (const line of envFile.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !line.trimStart().startsWith("#") && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
delete process.env.AI_E2E_STUB;

const { createServiceClient } = await import("../../../src/backend/platform/supabase.ts");
const { reindexCaseKnowledge } = await import(
  "../../../src/backend/modules/ai-engine/lex-service.ts"
);

let caseIds = process.argv.slice(2);
const client = createServiceClient();

if (caseIds.length === 0) {
  const { data, error } = await client
    .from("cases")
    .select("id, case_number, status")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listing cases failed: ${error.message}`);
  caseIds = (data ?? []).map((c) => c.id);
  console.log(`Backfilling Lex index for ${caseIds.length} case(s)…`);
}

let failures = 0;
for (const caseId of caseIds) {
  const t0 = Date.now();
  try {
    const r = await reindexCaseKnowledge(caseId);
    console.log(
      `  ${caseId}: indexed=${r.indexed} skipped=${r.skipped} removed=${r.removed} (${Date.now() - t0}ms)`,
    );
  } catch (err) {
    failures += 1;
    console.error(`  ${caseId}: FAILED — ${err instanceof Error ? err.message : err}`);
  }
}

if (failures > 0) {
  console.error(`Done with ${failures} failure(s).`);
  process.exit(1);
}
console.log("Done.");
