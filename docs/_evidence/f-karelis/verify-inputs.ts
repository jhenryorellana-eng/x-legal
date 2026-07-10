/* Ola 1 — prueba de cableado: ejecuta la MISMA función de producción que usa el memo
 * (resolveGenerationInputs + loadResolvedInputs) contra el caso real de Karelis, para
 * demostrar que la Declaración jurada y el paquete de Evidencias resuelven a extracciones
 * concretas y que su texto entra al contexto del prompt.
 *
 * Run:  npx -y tsx docs/_evidence/f-karelis/verify-inputs.ts
 */
import * as fs from "fs";
import * as path from "path";

// Load .env.local into process.env BEFORE importing modules that validate env at import.
const envPath = path.resolve(__dirname, "../../../.env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const CASE_ID = "559220ae-796b-4110-ab45-bfc7eea6a564";
const FORM_SLUGS = ["memorandum-de-miedo-creible-cuestionario"];
const DOC_SLUGS = ["declaracion-jurada", "evidencias-sustentatorias"];

async function main() {
  const repo = await import("../../../src/backend/modules/ai-engine/repository");

  const resolved = await repo.resolveGenerationInputs(CASE_ID, null, FORM_SLUGS, DOC_SLUGS);
  console.log("=== resolveGenerationInputs (lo que el memo congela) ===");
  console.log("documents:", JSON.stringify(resolved.documents, null, 2));
  console.log("forms:", JSON.stringify(resolved.forms, null, 2));

  // loadResolvedInputs takes a ConfigSnapshot; only .resolved_inputs is read.
  const loaded = await repo.loadResolvedInputs({ resolved_inputs: resolved } as never);
  console.log("\n=== loadResolvedInputs (contexto real que se inyecta) ===");
  for (const d of loaded.documents ?? []) {
    const raw = (d.rawText ?? "").replace(/\s+/g, " ").trim();
    console.log(`\n[doc ${d.slug}] payload=${JSON.stringify(d.extractionPayload)}`);
    console.log(`  rawText (${raw.length} chars): ${raw.slice(0, 240)}...`);
  }
  console.log("\nforms loaded:", (loaded.forms ?? []).length);
}

main().catch((e) => { console.error("VERIFY FAILED:", e); process.exit(1); });
