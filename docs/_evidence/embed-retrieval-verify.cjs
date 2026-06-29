/**
 * Etapa D — live proof of semantic retrieval (RPC match_dataset_items).
 * Embeds a case-profile query and asks the RPC for the most similar dataset
 * items. Read-only. Run: node docs/_evidence/embed-retrieval-verify.cjs
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenAI } = require("@google/genai");

for (const line of fs.readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function embed(text) {
  const res = await genai.models.embedContent({
    model: "gemini-embedding-001",
    contents: text,
    config: { outputDimensionality: 768 },
  });
  return res.embeddings[0].values;
}

(async () => {
  const { data: ds } = await supa.from("ai_dataset_items").select("dataset_id").limit(1);
  const datasetId = ds[0].dataset_id;

  const query =
    "Solicitante venezolano, opositor político perseguido por el SEBIN por su opinión política; " +
    "detenido y torturado; teme persecución futura del gobierno. Nexo: opinión política.";
  const vec = await embed(query);

  const { data, error } = await supa.rpc("match_dataset_items", {
    query_embedding: `[${vec.join(",")}]`,
    p_dataset_id: datasetId,
    match_count: 6,
    filter_tags: null,
  });
  if (error) throw error;
  console.log(`Query: ${query}\n`);
  console.log(`Top ${data.length} por similitud coseno:`);
  for (const r of data) {
    console.log(`  ${r.similarity.toFixed(4)}  [${r.outcome ?? "-"}]  ${r.title}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
