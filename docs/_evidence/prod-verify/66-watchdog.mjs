/* Watchdog (pure node + supabase-js for reliable reads). Polls a run; if the sectioned
 * engine's self-chain drops a link (no checkpoint update for STALL_MS while running), it
 * re-enqueues via the resume tsx script (prod QStash). Guarantees completion on the prod path.
 * Usage: node docs/_evidence/prod-verify/66-watchdog.mjs <runId> <label> */
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : null; };
const supa = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const runId = process.argv[2];
const label = process.argv[3] || runId.slice(0, 6);
const STALL_MS = 240_000, INTERVAL_MS = 20_000, MAX_ITERS = 150;
const ts = () => new Date().toISOString().slice(11, 19);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let resumes = 0;

for (let i = 1; i <= MAX_ITERS; i++) {
  const { data: r } = await supa.from("ai_generation_runs")
    .select("status, progress, updated_at, cost_usd, output_path, output_text, model, input_tokens, output_tokens")
    .eq("id", runId).maybeSingle();
  if (!r) { console.log(`[${ts()}] ${label}: run not found (poll ${i})`); await sleep(INTERVAL_MS); continue; }
  const prog = (r.progress && typeof r.progress === "object") ? r.progress : {};
  const sections = prog.sectionsDone ?? prog.completedSections ?? "?";
  const rstep = prog.researchStep ?? "?";
  const ageMs = Date.now() - new Date(r.updated_at).getTime();
  console.log(`[${ts()}] ${label} poll ${i} status=${r.status} research=${rstep} sections=${sections} age=${Math.round(ageMs / 1000)}s resumes=${resumes}`);

  if (r.status === "completed") {
    console.log(`[${ts()}] DONE ${label} COMPLETED model=${r.model} in=${r.input_tokens} out=${r.output_tokens} cost=$${r.cost_usd} chars=${(r.output_text || "").length} path=${r.output_path}`);
    process.exit(0);
  }
  if (r.status === "failed" || r.status === "cancelled") { console.log(`[${ts()}] ${label} ${r.status}`); process.exit(1); }

  if (r.status === "running" && ageMs > STALL_MS) {
    resumes++;
    try {
      execSync(`npx -y tsx docs/_evidence/prod-verify/65-resume-run.ts ${runId} wd${resumes}`, { cwd: path.join(__dirname, "../../.."), stdio: "ignore" });
      console.log(`[${ts()}] ${label} STALL ${Math.round(ageMs / 1000)}s -> re-enqueued (resume #${resumes})`);
    } catch (e) { console.log(`[${ts()}] ${label} resume failed: ${String(e).slice(0, 120)}`); }
  }
  await sleep(INTERVAL_MS);
}
console.log(`[${ts()}] ${label} watchdog gave up after ${MAX_ITERS} iters`);
process.exit(2);
