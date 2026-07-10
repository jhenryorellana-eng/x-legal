/* Ola 1 — excerpt REAL del memo de Miedo Creíble para Karelis.
 * Usa las funciones de dominio de producción + el contexto REAL del caso
 * (resolveGenerationInputs → loadResolvedInputs) para demostrar que la
 * Declaración jurada + Evidencias de Karelis producen un memo coherente.
 * Bounded (análisis + 2 secciones, sin web_search) para ser rápido/robusto.
 *
 * Run:  npx -y tsx docs/_evidence/f-karelis/generate-excerpt.ts
 * Cost: ~$0.5-1 (1 Opus analysis + 2 Sonnet sections).
 */
import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";

const envPath = path.resolve(__dirname, "../../../.env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const CASE_ID = "559220ae-796b-4110-ab45-bfc7eea6a564";
const OPUS = "claude-opus-4-7";
const SONNET = "claude-sonnet-4-6";
const SYSTEM_PROMPT =
  "You are a Senior Federal Immigration Attorney drafting a Credible Fear legal memorandum for a USCIS asylum application (Form I-589), to the standard of an elite firm. Write in ENGLISH, clinical, authoritative and persuasive. The factual record is the client's uploaded sworn declaration and supporting evidence ONLY - never invent client facts.";

async function main() {
  const repo = await import("../../../src/backend/modules/ai-engine/repository");
  const domain = await import("../../../src/backend/modules/ai-engine/domain");
  const client = new Anthropic();

  async function call(model: string, system: string, user: string, maxTokens: number) {
    const stream = client.messages.stream({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
    const msg = await stream.finalMessage();
    const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    return { text, usage: msg.usage, stop: msg.stop_reason };
  }

  // 1) REAL case context (same production path the memo uses)
  const resolved = await repo.resolveGenerationInputs(CASE_ID, null, ["memorandum-de-miedo-creible-cuestionario"], ["declaracion-jurada", "evidencias-sustentatorias"]);
  const loaded = await repo.loadResolvedInputs({ resolved_inputs: resolved } as never);
  const mask = (s: string) => domain.maskPii(s);
  const ctxParts: string[] = ["## DATOS EXTRAIDOS DE DOCUMENTOS"];
  for (const d of loaded.documents) ctxParts.push(`### ${d.slug}\n${mask(JSON.stringify(d.extractionPayload))}`);
  ctxParts.push("\n## TEXTO COMPLETO DE DOCUMENTOS");
  for (const d of loaded.documents) ctxParts.push(`### ${d.slug}\n${mask(d.rawText)}`);
  const caseContext = ctxParts.join("\n\n");
  console.log(`case context built: ${caseContext.length} chars from ${loaded.documents.length} documents`);

  // 2) Analysis (Opus) — reads HER real record
  const ap = domain.buildAnalysisPrompt({ systemPrompt: SYSTEM_PROMPT, caseContext });
  const ar = await call(OPUS, ap.system, ap.user, 3000);
  const analysis = domain.parseResearchAnalysis(ar.text);
  console.log(`analysis: nationality=${analysis?.nationality} | theory=${analysis?.principal_theory} | chronology=${analysis?.chronology.length}`);

  // 3) Draft two representative sections (Sonnet)
  const sections: import("../../../src/backend/modules/ai-engine/domain").GenerationSectionSpec[] = [
    { key: "i5", heading: "I.5 Chronological Narrative of Persecution", min_words: 0, max_tokens: 2200, guidance: "Narrate, in chronological order and with dates, the persecution the applicant suffered as documented in the sworn declaration and the consolidated evidence packet. Ground every fact in the record.", type: "narrative" },
    { key: "i11", heading: "I.11 Nexus and Application of the Protected Grounds", min_words: 0, max_tokens: 2000, guidance: "Argue the 'on account of' nexus for political opinion and membership in a particular social group (investigative journalists), applying the facts of the record.", type: "analysis" },
  ];
  const bodies: string[] = [];
  for (const s of sections) {
    const msg = domain.buildSectionUserMessage(caseContext, s, "", "Cite ONLY facts present in the record.");
    const r = await call(SONNET, SYSTEM_PROMPT, msg, s.max_tokens);
    bodies.push(`## ${s.heading}\n\n${domain.stripLeadingHeading(r.text.trim())}`);
    console.log(`section ${s.key}: ${domain.countWords(r.text)} words | stop=${r.stop}`);
  }

  // 4) Assemble (cover + sections + chronology + closing)
  const cover = domain.buildCoverPage(null, { applicant_name: "Karelis Andreina Perez", nationality: analysis?.nationality ?? "Venezuela", principal_theory: analysis?.principal_theory ?? "" });
  const chrono = analysis && analysis.chronology.length ? domain.buildChronologyTable(analysis.chronology) : undefined;
  const doc = domain.assembleDocument(sections, bodies, { cover: true, toc: true, chronology: true, closing: "I declare under penalty of perjury that the foregoing is true and correct." }, { cover, chronology: chrono });
  const outPath = path.resolve(__dirname, "karelis-memo-excerpt.md");
  fs.writeFileSync(outPath, doc, "utf8");
  console.log(`\nassembled excerpt: ${domain.countWords(doc)} words -> ${outPath}`);
  console.log("\n--- HEAD (first 1200 chars) ---\n" + doc.slice(0, 1200));
}

main().catch((e) => { console.error("EXCERPT FAILED:", e); process.exit(1); });
