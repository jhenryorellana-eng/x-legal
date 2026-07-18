/* Monitor an ai_generation_runs row until terminal (or budget of polls exhausted).
 * Usage: node docs/_evidence/prod-verify/61-monitor-run.mjs <runId> [maxPolls] [intervalSec] */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : null; };
const supa = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const runId = process.argv[2];
const maxPolls = Number(process.argv[3] || 24);
const intervalMs = Number(process.argv[4] || 20) * 1000;
const ts = () => new Date().toISOString().slice(11, 19);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 1; i <= maxPolls; i++) {
  const { data: r } = await supa.from("ai_generation_runs")
    .select("status, model, progress, input_tokens, output_tokens, cost_usd, output_text, output_path, error")
    .eq("id", runId).single();
  const prog = r?.progress && typeof r.progress === "object" ? r.progress : {};
  const done = prog.sectionsDone ?? prog.completedSections ?? "?";
  const rstep = prog.researchStep ?? "?";
  const outLen = (r?.output_text || "").length;
  console.log(`[${ts()}] poll ${i}/${maxPolls} status=${r?.status} research=${rstep} sections=${done} outChars=${outLen} cost=$${r?.cost_usd ?? 0}`);
  if (r?.status === "completed") { console.log(`[${ts()}] ✅ COMPLETED model=${r.model} in=${r.input_tokens} out=${r.output_tokens} cost=$${r.cost_usd} path=${r.output_path} chars=${outLen}`); process.exit(0); }
  if (r?.status === "failed" || r?.status === "cancelled") { console.log(`[${ts()}] ⛔ ${r.status}: ${r?.error ?? ""}`); process.exit(1); }
  if (i < maxPolls) await sleep(intervalMs);
}
console.log(`[${ts()}] ⏳ still running after ${maxPolls} polls — re-run monitor to continue.`);
