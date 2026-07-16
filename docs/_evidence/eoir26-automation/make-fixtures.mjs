/**
 * Synthetic demo documents for the EOIR-26 E2E verification (demo client Yenifer).
 * All data is fictitious. Values are DISTINCTIVE so extraction results can be
 * asserted: decision date 2026-06-25, court Houston TX, A-Number A245-678-901.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join("C:/Users/mauri/Documents/Trabajos/usalatino-v2/.playwright-mcp");

async function makePdf(fileName, lines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  let page = doc.addPage([612, 792]);
  let y = 740;
  for (const l of lines) {
    if (l === "::pagebreak::") { page = doc.addPage([612, 792]); y = 740; continue; }
    const isBold = l.startsWith("**");
    const text = isBold ? l.slice(2) : l;
    page.drawText(text, { x: 72, y, size: isBold ? 13 : 11, font: isBold ? bold : font });
    y -= isBold ? 22 : 16;
    if (y < 72) { page = doc.addPage([612, 792]); y = 740; }
  }
  const bytes = await doc.save();
  fs.writeFileSync(path.join(OUT, fileName), bytes);
  console.log("wrote", fileName, bytes.length, "bytes");
}

await makePdf("demo-decision-juez.pdf", [
  "**UNITED STATES DEPARTMENT OF JUSTICE",
  "**EXECUTIVE OFFICE FOR IMMIGRATION REVIEW",
  "**IMMIGRATION COURT, HOUSTON, TEXAS",
  "",
  "In the Matter of:                                   File No.: A 245-678-901",
  "RODRIGUEZ ALVARADO, Yenifer del Carmen",
  "Respondent                                          IN REMOVAL PROCEEDINGS",
  "",
  "**DECISION AND ORDER OF THE IMMIGRATION JUDGE",
  "",
  "The respondent, a native and citizen of Venezuela, applied for asylum under",
  "section 208 of the Immigration and Nationality Act, withholding of removal",
  "under section 241(b)(3), and protection under the Convention Against Torture.",
  "",
  "The Court finds that the respondent's testimony lacked sufficient detail and",
  "corroboration regarding the alleged persecution by state actors. The Court",
  "further finds that the respondent did not establish a nexus to a protected",
  "ground. Accordingly, the application for asylum is DENIED. Withholding of",
  "removal and CAT protection are likewise DENIED.",
  "",
  "**ORDER",
  "",
  "IT IS HEREBY ORDERED that the respondent be REMOVED from the United States",
  "to VENEZUELA.",
  "",
  "Dated: June 25, 2026",
  "",
  "________________________________",
  "Robert T. Marshall",
  "United States Immigration Judge",
  "Immigration Court, Houston, TX",
]);

await makePdf("demo-pasaporte.pdf", [
  "**REPUBLICA BOLIVARIANA DE VENEZUELA",
  "**PASAPORTE / PASSPORT",
  "",
  "Tipo / Type: P",
  "Pais emisor / Issuing Country: VEN",
  "Pasaporte No. / Passport No.: 145887421",
  "",
  "Apellidos / Surname: RODRIGUEZ ALVARADO",
  "Nombres / Given Names: YENIFER DEL CARMEN",
  "",
  "Nacionalidad / Nationality: VENEZOLANA / VENEZUELAN",
  "Fecha de nacimiento / Date of Birth: 14 MAR 1992",
  "Sexo / Sex: F",
  "Lugar de nacimiento / Place of Birth: MARACAIBO, VENEZUELA",
  "",
  "Fecha de emision / Date of Issue: 02 FEB 2023",
  "Fecha de vencimiento / Date of Expiry: 01 FEB 2033",
]);

await makePdf("demo-asilo-completo.pdf", [
  "**COPY OF ASYLUM PACKAGE AS FILED (DEMO)",
  "",
  "Form I-589, Application for Asylum and for Withholding of Removal",
  "Applicant: RODRIGUEZ ALVARADO, Yenifer del Carmen",
  "A-Number: A 245-678-901",
  "Filed with: Immigration Court, Houston, TX",
  "Filing date: March 3, 2025",
  "",
  "Attachments: personal declaration, country conditions evidence, exhibits A-F.",
  "::pagebreak::",
  "**PERSONAL DECLARATION (EXCERPT — DEMO)",
  "",
  "I, Yenifer del Carmen Rodriguez Alvarado, declare under penalty of perjury",
  "that the following is true and correct. I fled Venezuela after receiving",
  "threats due to my political opinion...",
]);

console.log("done");
