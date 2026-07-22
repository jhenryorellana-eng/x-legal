/*
 * Verificación del render determinista de la Carátula de Envío usando el CÓDIGO REAL
 * (resolveMailingCoverValues + renderMailingCoverPdf), con la config sembrada y los
 * valores que el field_copy produce para el caso U26-000046 (Paqui Tineo Ricardo).
 *
 * Uso:  npx tsx docs/_evidence/caratula-envio-ola6/verify-render.ts <outPath>
 */
import { writeFileSync } from "node:fs";
import { resolveMailingCoverValues } from "@/backend/modules/ai-engine/mailing-cover";
import { renderMailingCoverPdf } from "@/backend/platform/pdf";
import type { MailingCoverConfig } from "@/backend/modules/ai-engine/domain";

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

// The confirmed answers as field_copy materializes them from the EOIR-26 (keyed by
// question wording, exactly as loadResolvedInputs re-keys them).
const inputs = {
  forms: [
    {
      slug: "caratula-de-envio-cuestionario",
      answers: {
        "Nombre completo del cliente (como aparece en el sobre)": "Paqui Tineo Ricardo",
        "Dirección de OPLA (del buscador IA)": "450 Main Street, Room 483\nHartford, CT 06103-3060",
      },
    },
  ],
};

(async () => {
  const out = process.argv[2] || "caratula-out.pdf";
  const data = resolveMailingCoverValues(cfg, inputs);
  console.log("Resolved render data:", JSON.stringify(data, null, 2));
  const pdf = await renderMailingCoverPdf(data);
  writeFileSync(out, pdf);
  console.log(`WROTE ${out} (${pdf.length} bytes)`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
