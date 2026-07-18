/* Fase 3.1 — Generate the filled I-589 PDF via the real generateFilledPdf use case.
 * Run: npx -y tsx docs/_evidence/prod-verify/30-gen-i589.ts */
import * as fs from "fs";
import * as path from "path";
import { loadEnv, IDS, staffAdminActor } from "./_env";
loadEnv();

const ids = JSON.parse(fs.readFileSync(path.resolve(__dirname, "asilo-ids.json"), "utf8"));
const ts = () => new Date().toISOString().slice(11, 19);

(async () => {
  const cases = await import("../../../src/backend/modules/cases");
  const { createServiceClient } = await import("../../../src/backend/platform/supabase");
  const sb = createServiceClient();
  const actor = staffAdminActor(IDS.ORG);

  console.log(`[${ts()}] generateFilledPdf response=${ids.i589ResponseId}…`);
  const res = await cases.generateFilledPdf(actor, { responseId: ids.i589ResponseId });
  console.log(`[${ts()}] result:`, res);

  const { data: row } = await sb.from("case_form_responses").select("filled_pdf_path, status").eq("id", ids.i589ResponseId).single();
  console.log(`[${ts()}] filled_pdf_path=${row?.filled_pdf_path} status=${row?.status}`);

  if (row?.filled_pdf_path) {
    const dl = await sb.storage.from("generated").download(row.filled_pdf_path);
    if (dl.data) {
      const buf = Buffer.from(await dl.data.arrayBuffer());
      const out = path.resolve(__dirname, "i589-filled.pdf");
      fs.writeFileSync(out, buf);
      const isPdf = buf.subarray(0, 4).toString("latin1") === "%PDF";
      console.log(`[${ts()}] ✅ downloaded ${buf.length} bytes, %PDF=${isPdf} → ${out}`);
    } else {
      console.log(`[${ts()}] download error:`, dl.error?.message);
    }
  }
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
