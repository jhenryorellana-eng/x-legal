/*
 * Genera la Carátula de Envío (hoja 1 del expediente) para los dos casos reales,
 * usando el CÓDIGO REAL de producción (resolveMailingCoverValues + renderMailingCoverPdf)
 * con la config `mailing_cover` sembrada y las respuestas confirmadas del cuestionario.
 *
 * Uso:  npx tsx docs/_evidence/caratula-envio-ola6/gen-both.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveMailingCoverValues } from "@/backend/modules/ai-engine/mailing-cover";
import { renderMailingCoverPdf } from "@/backend/platform/pdf";
import type { MailingCoverConfig } from "@/backend/modules/ai-engine/domain";

// Config real (ai_generation_configs.mailing_cover para form caratula-de-envio).
const cfg: MailingCoverConfig = {
  return_address: ["10951 N. Town Center Drive", "Highland, UT 84003"],
  sender_name: { form_slug: "caratula-de-envio-cuestionario", question: "Nombre completo del cliente (como aparece en el sobre)" },
  envelopes: [
    { recipient_lines: ["Board of Immigration Appeals", "5107 Leesburg Pike, Suite 2000", "Falls Church, VA 22041"], address_from: null },
    {
      recipient_lines: ["Office of the Principal Legal Advisor (OPLA)", "U.S. Immigration and Customs Enforcement"],
      address_from: { form_slug: "caratula-de-envio-cuestionario", question: "Dirección de OPLA (del buscador IA)" },
    },
  ],
  spacing: { block_gap_pt: 120, line_height: 1.5, font_size_pt: 13, margin_pt: 96 },
};

// Respuestas confirmadas (case_form_responses.answers), re-keyed por enunciado como lo
// hace loadResolvedInputs (en BD están keyed por question_id UUID).
const cases = [
  {
    out: "caratula-U26-000038-ivis.pdf",
    label: "U26-000038 · Ivis Michell Palma Rodriguez",
    answers: {
      "Nombre completo del cliente (como aparece en el sobre)": "Ivis Michell Palma Rodriguez",
      "Dirección de OPLA (del buscador IA)": "126 Northpoint Drive, Room 2020\nHouston, TX 77060",
    },
  },
  {
    out: "caratula-U26-000046-paqui-tineo.pdf",
    label: "U26-000046 · Paqui Tineo Ricardo",
    answers: {
      "Nombre completo del cliente (como aparece en el sobre)": "Paqui Tineo Ricardo",
      "Dirección de OPLA (del buscador IA)": "450 Main Street, Room 483\nHartford, CT 06103-3060",
    },
  },
];

(async () => {
  const dir = join(process.cwd(), "docs/_evidence/caratula-envio-ola6");
  for (const c of cases) {
    const inputs = { forms: [{ slug: "caratula-de-envio-cuestionario", answers: c.answers }] };
    const data = resolveMailingCoverValues(cfg, inputs);
    const pdf = await renderMailingCoverPdf(data);
    const outPath = join(dir, c.out);
    writeFileSync(outPath, pdf);
    console.log(`OK ${c.label} → ${c.out} (${pdf.length} bytes)`);
    console.log("   render:", JSON.stringify(data));
  }
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
