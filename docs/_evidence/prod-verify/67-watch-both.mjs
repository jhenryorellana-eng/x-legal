/* Foreground watchdog for BOTH memo runs at once (background procs get killed in this env).
 * Polls both; auto-resumes either on stall (>STALL_MS, running); exits when both terminal
 * OR iter budget exhausted (re-run to continue). Usage: node docs/_evidence/prod-verify/67-watch-both.mjs [maxIters] */
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : null; };
const supa = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const RUNS = [
  { id: "e67e069b-1afe-4c90-a10b-1711adec9928", label: "ASILO" },
  { id: "8615dc23-8452-4601-be75-e35c4e3a77a5", label: "REFORZAR" },
];
const STALL_MS = 240_000, INTERVAL_MS = 20_000;
const maxIters = Number(process.argv[2] || 24);
const ts = () => new Date().toISOString().slice(11, 19);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const resumeCount = {};

for (let i = 1; i <= maxIters; i++) {
  let allTerminal = true;
  const line = [];
  for (const run of RUNS) {
    const { data: r } = await supa.from("ai_generation_runs")
      .select("status, progress, updated_at, cost_usd, output_path, output_text, model, input_tokens, output_tokens")
      .eq("id", run.id).maybeSingle();
    if (!r) { line.push(`${run.label}=?`); allTerminal = false; continue; }
    const prog = (r.progress && typeof r.progress === "object") ? r.progress : {};
    const sections = prog.sectionsDone ?? "?";
    const ageMs = Date.now() - new Date(r.updated_at).getTime();
    if (r.status === "completed") {
      line.push(`${run.label}=✅done cost=$${r.cost_usd} chars=${(r.output_text || "").length}`);
      if (!run.done) { run.done = true; console.log(`\n[${ts()}] ${run.label} COMPLETED model=${r.model} in=${r.input_tokens} out=${r.output_tokens} cost=$${r.cost_usd} chars=${(r.output_text || "").length} path=${r.output_path}\n`); }
    } else if (r.status === "failed" || r.status === "cancelled") {
      line.push(`${run.label}=⛔${r.status}`);
    } else {
      allTerminal = false;
      line.push(`${run.label}=${r.status} s${sections} age${Math.round(ageMs / 1000)}`);
      if (r.status === "running" && ageMs > STALL_MS) {
        resumeCount[run.id] = (resumeCount[run.id] || 0) + 1;
        try { execSync(`npx -y tsx docs/_evidence/prod-verify/65-resume-run.ts ${run.id} wb${resumeCount[run.id]}`, { cwd: path.join(__dirname, "../../.."), stdio: "ignore" }); line.push(`(${run.label}🔄r${resumeCount[run.id]})`); } catch { line.push(`(${run.label} resume-fail)`); }
      }
    }
  }
  console.log(`[${ts()}] ${i}/${maxIters} | ${line.join("  ")}`);
  if (allTerminal) { console.log(`[${ts()}] all runs terminal.`); process.exit(0); }
  if (i < maxIters) await sleep(INTERVAL_MS);
}
console.log(`[${ts()}] budget exhausted — re-run to continue.`);
