/*
 * Verificación del hoist: la carátula se antepone como hoja 1 SIN Bates y el paquete
 * legal (índice + Bates USALP-000x) queda INTACTO. Usa el código real: stampBates +
 * prependPdfPages + countPdfPages.
 *
 * Uso:  npx tsx docs/_evidence/caratula-envio-ola6/verify-prepend.ts <outPath>
 */
import { writeFileSync } from "node:fs";
import { renderMailingCoverPdf, htmlToPdf, stampBates, prependPdfPages, countPdfPages } from "@/backend/platform/pdf";

(async () => {
  const out = process.argv[2] || "expediente-con-caratula.pdf";

  // 1) La carátula (hoja de envío).
  const caratula = await renderMailingCoverPdf({
    senderName: "Paqui Tineo Ricardo",
    returnAddress: ["10951 N. Town Center Drive", "Highland, UT 84003"],
    envelopes: [
      { recipientLines: ["Board of Immigration Appeals", "5107 Leesburg Pike, Suite 2000", "Falls Church, VA 22041"], addressLines: [] },
      { recipientLines: ["Office of the Principal Legal Advisor (OPLA)", "U.S. Immigration and Customs Enforcement"], addressLines: ["450 Main Street, Room 483", "Hartford, CT 06103-3060"] },
    ],
    spacing: { blockGapPt: 120, lineHeight: 1.5, fontSizePt: 13, marginPt: 96 },
  });

  // 2) Un "paquete legal" simulado de 2 páginas (índice + un documento), estampado con
  //    Bates como lo hace compileExpedientePdf → USALP-0001 (índice), USALP-0002 (doc).
  const toc = await htmlToPdf(`<!DOCTYPE html><html><body style="font-family:Helvetica;margin:54pt 60pt"><div style="font-size:22pt;font-weight:bold">Table of Contents</div><table style="width:100%;font-size:12pt"><tr><td>Form EOIR-26 — Notice of Appeal</td><td style="text-align:right">2</td></tr></table></body></html>`);
  const body = await htmlToPdf(`<!DOCTYPE html><html><body style="font-family:Helvetica;margin:72pt"><div style="font-size:16pt;font-weight:bold">Form EOIR-26 — Notice of Appeal</div><p>(contenido del paquete legal…)</p></body></html>`);
  // merge toc+body then stamp Bates (mirrors compileExpedientePdf order)
  const merged = await prependPdfPages(toc, body); // toc first, then body
  const filedStamped = await stampBates(merged); // USALP-0001 (toc), USALP-0002 (body)

  // 3) Anteponer la carátula (sin Bates) al paquete ya estampado — como compileExpediente.
  const finalPdf = await prependPdfPages(caratula, filedStamped);

  const caratulaPages = await countPdfPages(caratula);
  const filedPages = await countPdfPages(filedStamped);
  const totalPages = await countPdfPages(finalPdf);
  console.log(JSON.stringify({ caratulaPages, filedPages, totalPages, expectedTotal: caratulaPages + filedPages }, null, 2));

  writeFileSync(out, finalPdf);
  console.log(`WROTE ${out} (${finalPdf.length} bytes)`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
