/**
 * Live verification of the Etapa A research path: jurisprudence FROM THE CURATED
 * DATASET (with per-case analogy generation) + country conditions via web_search,
 * using the DEPLOYED config + dataset (meta column from migration 0051). Mirrors the
 * engine's research phase. Prints the assembled annexes + a verification summary.
 */
import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { CASE_CONTEXT } from "./asylum-full-pipeline";
import {
  buildAnalysisPrompt, parseResearchAnalysis,
  datasetToJurisprudence, datasetToCountry, buildJurisprudenceAnalogyPrompt, parseAnalogies,
  buildCountryConditionsPrompt, parseCountryConditions, buildWebSearchTool, buildAnnexesSection,
  type DatasetItem, type ResearchBundle, type CountryConditionSource,
} from "../../src/backend/modules/ai-engine/domain";
import { keepReachable, checkUrlReachable } from "../../src/backend/platform/url-utils";

for (const line of fs.readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const anthropic = new Anthropic();
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function call(model: string, system: string, user: string, maxTokens: number, tools?: unknown[], abortMs = 290_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), abortMs);
  try {
    const s = anthropic.messages.stream({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }], ...(tools ? { tools: tools as never } : {}) }, { signal: ctrl.signal, maxRetries: 0 });
    const msg = await s.finalMessage();
    return msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  } finally { clearTimeout(timer); }
}

async function main() {
  const { data: cfgRow } = await supa.from("ai_generation_configs").select("*, form_definitions!inner(slug)").eq("form_definitions.slug", "memorandum-de-miedo-creible").single();
  const cfg = cfgRow as { research_model?: string; model?: string; dataset_id?: string; web_search_max_uses?: number; research_instructions?: string; system_prompt: string };
  const researchModel = cfg.research_model || "claude-opus-4-7";
  const draftModel = cfg.model || "claude-sonnet-4-6";
  const { data: dsRows } = await supa.from("ai_dataset_items").select("id,title,content,tags,outcome,token_count,created_at,jurisdiction,meta").eq("dataset_id", cfg.dataset_id!).not("token_count", "is", null);
  const items: DatasetItem[] = (dsRows ?? []).map((r: Record<string, unknown>) => ({ id: r.id as string, title: r.title as string, content: r.content as string, tags: (r.tags as string[]) ?? [], outcome: r.outcome as string, token_count: r.token_count as number, created_at: r.created_at as string, jurisdiction: r.jurisdiction as string, meta: (r.meta ?? {}) as DatasetItem["meta"] }));
  log(`config: research=${researchModel}, draft=${draftModel}, dataset items=${items.length} (precedents=${items.filter((i) => i.meta?.kind === "precedent").length})`);

  // 1) analysis (opus, tool-free)
  log("analysis…");
  const ap = buildAnalysisPrompt({ systemPrompt: cfg.system_prompt, caseContext: CASE_CONTEXT });
  const analysis = parseResearchAnalysis(await call(researchModel, ap.system, ap.user, 8000, undefined, 120_000));
  log(`analysis parsed=${!!analysis}, nationality=${analysis?.nationality}`);

  // 2) jurisprudence FROM DATASET + analogies (draft model, tool-free)
  let jurisprudence = datasetToJurisprudence(items, analysis, 6);
  log(`jurisprudence from dataset: ${jurisprudence.length} precedents (${jurisprudence.map((c) => c.name).join("; ")})`);
  if (jurisprudence.length) {
    const anp = buildJurisprudenceAnalogyPrompt({ analysis, cases: jurisprudence });
    const analogies = parseAnalogies(await call(draftModel, anp.system, anp.user, 6000, undefined, 120_000), jurisprudence.length);
    jurisprudence = jurisprudence.map((c, i) => ({ ...c, factual_analogy: analogies[i] || c.factual_analogy }));
    log(`analogies generated: ${analogies.filter(Boolean).length}/${jurisprudence.length}`);
  }
  jurisprudence = await Promise.all(jurisprudence.map(async (c) => (c.url && !(await checkUrlReachable(c.url)).reachable ? { ...c, url: "" } : c)));

  // 3) country via web_search (draft model, capped to 4 searches)
  log("country web_search…");
  let country: CountryConditionSource[] = [];
  try {
    const cp = buildCountryConditionsPrompt({ instructions: cfg.research_instructions ?? null, analysis });
    const txt = await call(draftModel, cp.system, cp.user, 12000, [buildWebSearchTool(Math.min(cfg.web_search_max_uses ?? 4, 4), draftModel)], 280_000);
    country = await keepReachable(parseCountryConditions(txt));
  } catch (e) { log(`country web_search failed (${e instanceof Error ? e.message : e}); using dataset fallback`); }
  if (country.length === 0) country = await keepReachable(datasetToCountry(items));
  log(`country: ${country.length} sources`);

  const bundle: ResearchBundle = { analysis, jurisprudence, country_conditions: country };
  const annexes = buildAnnexesSection(bundle);
  fs.writeFileSync(path.resolve(__dirname, "research-verify-annexes.md"), annexes, "utf8");

  console.log("\n=== VERIFICATION ===");
  console.log(`jurisprudence_exhibits=${jurisprudence.length} (urls=${jurisprudence.filter((c) => c.url).length}, analogies=${jurisprudence.filter((c) => c.factual_analogy).length})`);
  console.log(`country_sources=${country.length}`);
  console.log(`annexes has Exhibit A=${annexes.includes("Exhibit A")} Exhibit B=${annexes.includes("Exhibit B")}, chars=${annexes.length}`);
  console.log(`\n--- ANNEXES HEAD ---\n${annexes.slice(0, 1400)}`);
}
main().catch((e) => { console.error("VERIFY FAILED:", e); process.exit(1); });
