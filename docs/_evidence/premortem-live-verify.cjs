/**
 * Etapa D — live proof of the Pre-Mortem pipeline against REAL data.
 * Reproduces assessPreMortemRisk end-to-end: download the real generated memo
 * PDF, transcribe it (Gemini), embed + retrieve similar dataset items (RPC),
 * then run the Anthropic critic and print the structured denial-reason report.
 * Read-only (no DB writes). Run: node docs/_evidence/premortem-live-verify.cjs
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenAI } = require("@google/genai");
const Anthropic = require("@anthropic-ai/sdk");

for (const line of fs.readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RUN_ID = "04e0f1a9-4eb8-4ccd-b672-b2ed302df867"; // ULP-2026-0011 memorandum-de-miedo-creible

const TAXONOMY = [
  ["NEXUS_FAIL", "persecution not 'on account of' a protected ground"],
  ["IMPUTED_WEAK", "imputed political opinion/membership not established"],
  ["CREDIBILITY", "inconsistencies/omissions undermine testimony"],
  ["CORROBORATION", "missing reasonably available corroborating evidence"],
  ["NOT_PERSECUTION", "harm below the persecution threshold"],
  ["WFF_OBJECTIVE", "fear not objectively well-founded vs country conditions"],
  ["RELOCATION", "safe internal relocation possible"],
  ["STATE_ACTION", "private persecutor; gov't not unable/unwilling shown"],
  ["ONE_YEAR_BAR", "filed >1yr after entry without exception"],
  ["ACA_BAR", "safe-third-country / cooperative agreement bar"],
  ["MANDATORY_BAR", "persecutor/serious crime/firm resettlement/terrorism bar"],
];

async function transcribePdf(bucket, p) {
  const { data } = await supa.storage.from(bucket).download(p);
  const b64 = Buffer.from(new Uint8Array(await data.arrayBuffer())).toString("base64");
  const res = await genai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [
      { inlineData: { mimeType: "application/pdf", data: b64 } },
      { text: "Transcribe ALL text from this document verbatim as plain text. Preserve structure. Do NOT summarize." },
    ] }],
  });
  return res.text ?? res.candidates?.[0]?.content?.parts?.map((x) => x.text).join("") ?? "";
}

async function embed(text) {
  const res = await genai.models.embedContent({ model: "gemini-embedding-001", contents: text.slice(0, 8000), config: { outputDimensionality: 768 } });
  return res.embeddings[0].values;
}

(async () => {
  const { data: run } = await supa.from("ai_generation_runs").select("output_path, form_definition_id").eq("id", RUN_ID).single();
  const { data: cfg } = await supa.from("ai_generation_configs").select("dataset_id, model").eq("form_definition_id", run.form_definition_id).maybeSingle();
  console.log(`memo PDF: ${run.output_path}\n`);

  const memo = await transcribePdf("generated", run.output_path);
  console.log(`transcribed memo: ${memo.length} chars`);

  const vec = await embed(memo);
  const { data: precedents } = await supa.rpc("match_dataset_items", {
    query_embedding: `[${vec.join(",")}]`, p_dataset_id: cfg.dataset_id, match_count: 6, filter_tags: null,
  });
  console.log(`retrieved ${precedents.length} precedents: ${precedents.map((p) => `${p.title} (${p.similarity.toFixed(2)})`).join(" · ")}\n`);

  const precedentBlock = precedents.map((p) => `<precedent title="${p.title}" outcome="${p.outcome}">\n${(p.content || "").slice(0, 1500)}\n</precedent>`).join("\n\n");
  const taxonomyBlock = TAXONOMY.map(([c, d]) => `- ${c}: ${d}`).join("\n");

  const msg = await anthropic.messages.create({
    model: cfg.model && cfg.model.startsWith("claude-opus") ? "claude-opus-4-7" : "claude-sonnet-4-6",
    max_tokens: 2000,
    system:
      "You are a skeptical U.S. asylum adjudicator. Read the memo and predict the most likely grounds for DENIAL. " +
      "Use the similar precedents for reference. Respond with VALID JSON only: " +
      `{"overallRisk":"low|medium|high","summary":"...","reasons":[{"code":"<TAXONOMY_CODE>","probability":0..1,"rationale":"...","correction":"..."}]}.`,
    messages: [{ role: "user", content:
      `## TAXONOMY (use these codes)\n${taxonomyBlock}\n\n## MEMO\n${memo.slice(0, 18000)}\n\n## SIMILAR PRECEDENTS\n${precedentBlock}` }],
  });
  const raw = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const report = JSON.parse(json);
  console.log("=== PRE-MORTEM REPORT (real Anthropic) ===");
  console.log(`overallRisk: ${report.overallRisk}`);
  console.log(`summary: ${report.summary}\n`);
  for (const r of (report.reasons || [])) {
    console.log(`  [${r.code}] p=${r.probability}`);
    console.log(`    why: ${r.rationale}`);
    console.log(`    fix: ${r.correction}`);
  }
  console.log(`\ntokens: in=${msg.usage.input_tokens} out=${msg.usage.output_tokens}`);
})().catch((e) => { console.error(e); process.exit(1); });
