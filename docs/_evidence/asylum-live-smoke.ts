/**
 * asylum-live-smoke.ts — REAL end-to-end smoke test of the v1-grade asylum letter
 * pipeline against the live Anthropic API. Does NOT touch the production DB/Storage
 * (those are covered by the 1715 mocked unit tests); it exercises the parts the
 * mocks can't: that the real prompts produce parseable JSON, that web_search
 * returns verified precedents, and that the section drafting + court assembly
 * produce a coherent document.
 *
 * Run:  npx -y tsx docs/_evidence/asylum-live-smoke.ts
 * Cost: ~$1 (1 Opus analysis + 1 Opus jurisprudence w/ web_search + 1 Sonnet section).
 */
import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildAnalysisPrompt,
  parseResearchAnalysis,
  buildJurisprudencePrompt,
  parseJurisprudence,
  buildCountryConditionsPrompt,
  parseCountryConditions,
  buildResearchContextBlock,
  buildSectionUserMessage,
  buildWebSearchTool,
  stripLeadingHeading,
  buildCoverPage,
  buildChronologyTable,
  assembleDocument,
  countWords,
  type ResearchBundle,
  type GenerationSectionSpec,
} from "../../src/backend/modules/ai-engine/domain";

// --- load ANTHROPIC_API_KEY from .env.local (tsx doesn't auto-load it) ---
const envPath = path.resolve(__dirname, "../../.env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const OPUS = "claude-opus-4-7";
const SONNET = "claude-sonnet-4-6";
const SYSTEM_PROMPT =
  "You are a Senior Federal Immigration Attorney drafting a Credible Fear legal memorandum for a USCIS asylum application (Form I-589), to the standard of an elite firm. The factual record is the client's questionnaire answers ONLY — never invent client facts.";

// Synthetic (fictional) case context — no real PII.
const CASE_CONTEXT = `## CLIENT QUESTIONNAIRE
- full_name: Juan Carlos Méndez (fictional test subject)
- nationality: Venezuela
- protected_ground (claimed): political opinion (opposition organizer)
- M4 facts: Organized opposition rallies in Caracas 2021–2023. GNB agents detained him twice (May 2022, 72h; Nov 2022), beat him, threatened to kill him. Home raided Jan 2023. Fled to the U.S. March 2023.
- M6 (sought protection): Filed a police report once; police took no action and warned him to stop.
- M8 (future fear): Believes GNB will kill or imprison him if returned; family still receives threats.`;

const client = new Anthropic();

async function call(model: string, system: string, user: string, maxTokens: number, useSearch: boolean) {
  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    ...(useSearch ? { tools: [buildWebSearchTool(5, model)] as never } : {}),
  });
  const msg = await stream.finalMessage();
  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  return { text, usage: msg.usage, stop: msg.stop_reason };
}

async function main() {
  console.log("=== 1) ANALYSIS (Opus) ===");
  const ap = buildAnalysisPrompt({ systemPrompt: SYSTEM_PROMPT, caseContext: CASE_CONTEXT });
  const ar = await call(OPUS, ap.system, ap.user, 3000, false);
  const analysis = parseResearchAnalysis(ar.text);
  console.log("parsed:", !!analysis, "| nationality:", analysis?.nationality, "| chronology events:", analysis?.chronology.length);

  console.log("\n=== 2) JURISPRUDENCE (Opus + web_search) ===");
  let jurisprudence: ReturnType<typeof parseJurisprudence> = [];
  try {
    const jp = buildJurisprudencePrompt({ instructions: "Find favorable federal asylum precedents for a Venezuelan opposition activist persecuted by state agents.", analysis });
    const jr = await call(OPUS, jp.system, jp.user, 4000, true);
    jurisprudence = parseJurisprudence(jr.text);
    console.log("verified cases:", jurisprudence.length);
    if (jurisprudence[0]) console.log("  e.g.", jurisprudence[0].name, "—", jurisprudence[0].citation, "| url:", jurisprudence[0].url || "(none)");
  } catch (e) {
    console.log("web_search phase error (non-fatal in engine):", (e as Error).message);
  }

  console.log("\n=== 3) COUNTRY CONDITIONS (Opus + web_search) ===");
  let country: ReturnType<typeof parseCountryConditions> = [];
  try {
    const cp = buildCountryConditionsPrompt({ instructions: "Find recent verified reporting on persecution of opposition figures in Venezuela.", analysis });
    const cr = await call(OPUS, cp.system, cp.user, 4000, true);
    country = parseCountryConditions(cr.text);
    console.log("verified sources:", country.length, country[0] ? `| e.g. ${country[0].source_name}` : "");
  } catch (e) {
    console.log("country-conditions phase error (non-fatal):", (e as Error).message);
  }

  const bundle: ResearchBundle = { analysis, jurisprudence, country_conditions: country };

  console.log("\n=== 4) DRAFT ONE SECTION (Sonnet) ===");
  const section: GenerationSectionSpec = {
    key: "i11",
    heading: "I.11 Nexus & Application of Controlling Federal Precedent",
    min_words: 0,
    max_tokens: 2500,
    guidance: "Argue the 'on account of' nexus and apply each verified precedent with a direct factual analogy to the applicant.",
    type: "analysis",
  };
  const researchBlock = buildResearchContextBlock(bundle);
  const draftBase = researchBlock ? `${CASE_CONTEXT}\n\n${researchBlock}` : CASE_CONTEXT;
  const secMsg = buildSectionUserMessage(draftBase, section, "", "Cite ONLY verified material.");
  const sr = await call(SONNET, SYSTEM_PROMPT, secMsg, 2500, false);
  console.log("section words:", countWords(sr.text), "| stop:", sr.stop);

  console.log("\n=== 5) ASSEMBLE (cover + section + chronology + closing) ===");
  const cover = buildCoverPage(null, { applicant_name: "Juan Carlos Méndez", nationality: analysis?.nationality ?? "", principal_theory: analysis?.principal_theory ?? "" });
  const chrono = analysis && analysis.chronology.length ? buildChronologyTable(analysis.chronology) : undefined;
  const doc = assembleDocument([section], [`## ${section.heading}\n\n${stripLeadingHeading(sr.text.trim())}`], { cover: true, toc: true, chronology: true, closing: "I declare under penalty of perjury that the foregoing is true and correct." }, { cover, chronology: chrono });
  const outPath = path.resolve(__dirname, "asylum-live-smoke-output.md");
  fs.writeFileSync(outPath, doc, "utf8");
  console.log("assembled doc words:", countWords(doc), "| written:", outPath);
  console.log("\n--- DOC HEAD (first 900 chars) ---\n", doc.slice(0, 900));
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(1);
});
