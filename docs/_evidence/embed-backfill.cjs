/**
 * Etapa D — backfill embeddings for ai_dataset_items (PROD, service role).
 * Embeds title + content + tags via Gemini gemini-embedding-001 @ 768 and writes
 * the `embedding` column. Idempotent: only embeds rows where embedding IS NULL
 * (pass --all to re-embed everything). Run: node docs/_evidence/embed-backfill.cjs
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
const ALL = process.argv.includes("--all");

async function embed(text) {
  const res = await genai.models.embedContent({
    model: "gemini-embedding-001",
    contents: text,
    config: { outputDimensionality: 768 },
  });
  const vec = res.embeddings?.[0]?.values;
  if (!Array.isArray(vec) || vec.length !== 768) throw new Error("bad embedding shape: " + (vec?.length ?? "?"));
  return vec;
}

(async () => {
  let q = supa.from("ai_dataset_items").select("id, title, content, tags, outcome, jurisdiction");
  if (!ALL) q = q.is("embedding", null);
  const { data, error } = await q;
  if (error) throw error;
  console.log(`backfill: ${data.length} item(s) to embed${ALL ? " (--all)" : " (embedding is null)"}`);

  let ok = 0;
  for (const it of data) {
    const text = [
      it.title,
      it.jurisdiction ? `Jurisdicción: ${it.jurisdiction}` : "",
      it.outcome ? `Resultado: ${it.outcome}` : "",
      (it.tags || []).length ? `Tags: ${(it.tags || []).join(", ")}` : "",
      it.content || "",
    ].filter(Boolean).join("\n");
    const vec = await embed(text);
    const { error: uErr } = await supa
      .from("ai_dataset_items")
      .update({ embedding: `[${vec.join(",")}]` })
      .eq("id", it.id);
    if (uErr) { console.log(`  FAIL ${it.title}: ${uErr.message}`); continue; }
    ok++;
    console.log(`  ok  ${it.title.slice(0, 60)}`);
  }
  console.log(`backfill done: ${ok}/${data.length} embedded`);
})().catch((e) => { console.error(e); process.exit(1); });
