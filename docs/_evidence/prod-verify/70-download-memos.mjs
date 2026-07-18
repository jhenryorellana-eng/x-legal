/* Download both completed memo PDFs from the `generated` bucket and verify with mupdf. */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : null; };
const supa = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const RUNS = [
  { id: "e67e069b-1afe-4c90-a10b-1711adec9928", label: "asilo" },
  { id: "8615dc23-8452-4601-be75-e35c4e3a77a5", label: "reforzar" },
];
const mupdf = await import("mupdf");
const probes = { asilo: ["Karelis", "Venezuela", "SEBIN", "journalist", "PERJURY", "Credible Fear", "Exhibit"], reforzar: ["Yenifer", "El Salvador", "MS-13", "gang", "PERJURY", "Credible Fear", "Exhibit"] };

for (const run of RUNS) {
  const { data: r } = await supa.from("ai_generation_runs").select("output_path, output_text, output_summary").eq("id", run.id).single();
  const dl = await supa.storage.from("generated").download(r.output_path);
  const buf = Buffer.from(await dl.data.arrayBuffer());
  const out = path.join(__dirname, `memo-${run.label}.pdf`);
  fs.writeFileSync(out, buf);
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const pages = doc.countPages();
  let text = "";
  for (let i = 0; i < pages; i++) text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText() + "\n";
  const isPdf = buf.subarray(0, 4).toString("latin1") === "%PDF";
  console.log(`\n=== MEMO ${run.label.toUpperCase()} ===`);
  console.log(`file=${out} bytes=${buf.length} %PDF=${isPdf} pages=${pages} textChars=${text.length}`);
  console.log("probes: " + probes[run.label].map((p) => (text.includes(p) ? "✓" : "✗") + p).join("  "));
  // show the table-of-contents / section headings sample
  const heads = text.split(/\n/).filter((l) => /^(I\.|II\.|III\.|IV\.|V\.|Exhibit|TABLE|MEMORANDUM|STATEMENT)/.test(l.trim())).slice(0, 12);
  console.log("headings sample:\n  " + heads.join("\n  "));
}
