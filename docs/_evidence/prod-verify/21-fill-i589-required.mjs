/* Fase 2.1 — Fill the base required I-589 fields the heuristic missed (birthdate,
 * middle name, nationality, race, religion, marital status, children). Single, no
 * children -> avoids the conditional spouse/children required cascade.
 * Run: node docs/_evidence/prod-verify/21-fill-i589-required.mjs */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : null; };
const supa = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const ids = JSON.parse(fs.readFileSync(path.join(__dirname, "asilo-ids.json"), "utf8"));

const EXTRA = {
  "d769e6b1-4a15-4ba9-b301-a97b49e53cd6": "1988-05-14",
  "09798890-be55-4f67-adef-e597b8128671": "1988-05-14",
  "ad5db1e3-d2b2-4875-947e-6f93cb3efd48": "Andreína",
  "7cb88aeb-46a0-4a5e-a252-c9d377dcf12e": "Andreína",
  "09f50db8-a2ac-48d4-938c-027c48ff8cb5": "Andreína",
  "d0697169-1c6a-409f-9248-887755905aa4": "Venezuela",
  "bdb865d7-36ca-470f-ba09-eaad9080c72f": "Venezuela",
  "cccb38f7-4188-4aa6-a779-a7cc7ed627af": "Venezuelan",
  "f35387d0-8a6a-42cd-bdf7-29fdb245b87a": "Venezuelan",
  "0215dca2-81b5-4c6b-aeb7-d1af1277bf93": "Hispanic/Latino",
  "70a3e5d7-be95-4028-b5af-7060dc491273": "Hispanic/Latino",
  "953ae92a-12d3-494c-8b59-22941eeb1d3c": "Roman Catholic",
  "c15a42a7-7fc0-4d3e-a525-99c20c030070": "Roman Catholic",
  "a861242c-2cbd-4e4e-a4a6-c2b3ce215004": "no",
  "78084b1a-bdab-4e89-a783-ff1ddaaa29f7": "single",
  "67351891-7f71-48bc-a057-fd5053e7ac9d": "no",
};

const { data: resp } = await supa.from("case_form_responses").select("answers").eq("id", ids.i589ResponseId).single();
const answers = { ...(resp.answers || {}), ...EXTRA };
const { error } = await supa.from("case_form_responses").update({ answers }).eq("id", ids.i589ResponseId);
if (error) { console.error("FAIL", error.message); process.exit(2); }
console.log(`OK — merged ${Object.keys(EXTRA).length} required fields into response ${ids.i589ResponseId}.`);
