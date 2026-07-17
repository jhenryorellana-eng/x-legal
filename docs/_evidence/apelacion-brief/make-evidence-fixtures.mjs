/**
 * Synthetic NEW-EVIDENCE documents for the Appeal Brief E2E (demo client Diego,
 * U26-000034). All data is fictitious and coherent with Diego's fixtures
 * (Venezuelan, political opinion, denied 2026-07-02 by IJ Marshall for lack of
 * nexus + corroboration). Both items POST-DATE the hearing — the honest
 * unavailability ground for the Motion to Remand.
 */
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const OUT = path.join("C:/Users/mauri/Documents/Trabajos/usalatino-v2/.playwright-mcp");

async function makePdf(fileName, lines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  let page = doc.addPage([612, 792]);
  let y = 740;
  for (const l of lines) {
    const isBold = l.startsWith("**");
    const text = isBold ? l.slice(2) : l;
    page.drawText(text, { x: 72, y, size: isBold ? 13 : 11, font: isBold ? bold : font });
    y -= isBold ? 22 : 16;
    if (y < 72) { page = doc.addPage([612, 792]); y = 740; }
  }
  const bytes = await doc.save();
  fs.writeFileSync(path.join(OUT, fileName), bytes);
  console.log("wrote", path.join(OUT, fileName), bytes.length, "bytes");
}

await makePdf("diego-evidencia-denuncia.pdf", [
  "**REPUBLICA BOLIVARIANA DE VENEZUELA",
  "**MINISTERIO PUBLICO - FISCALIA MUNICIPAL DE MARACAIBO",
  "**CONSTANCIA DE DENUNCIA No. MP-2026-088341",
  "",
  "Fecha de la denuncia: 5 de julio de 2026",
  "Denunciante: Carmen Gomez de Perez (madre del ciudadano Diego Armando Perez Gomez)",
  "",
  "La compareciente expone: que en fecha 3 de julio de 2026, funcionarios armados",
  "que se identificaron como miembros del SEBIN se presentaron en el domicilio",
  "familiar en Maracaibo preguntando por su hijo, DIEGO ARMANDO PEREZ GOMEZ,",
  "senalado por su participacion en actividades de la oposicion politica.",
  "Los funcionarios registraron la vivienda sin orden judicial, amenazaron a la",
  "familia con detenerla si no revelaba el paradero de su hijo, y advirtieron",
  "que 'cuando regrese al pais lo vamos a estar esperando'.",
  "",
  "La denunciante manifiesta que su hijo salio del pais en 2024 tras recibir",
  "amenazas similares por su labor como coordinador vecinal de la plataforma",
  "opositora, y que esta constancia se emite a su solicitud para ser presentada",
  "ante las autoridades migratorias de los Estados Unidos.",
  "",
  "Se emite la presente constancia a peticion de la parte interesada.",
  "",
  "Fiscal Auxiliar: Abg. Maria Fernanda Lugo",
  "Sello y firma",
]);

await makePdf("diego-evidencia-carta-testigo.pdf", [
  "**SWORN WITNESS LETTER / CARTA DE TESTIGO",
  "",
  "Date: July 8, 2026",
  "",
  "To the Board of Immigration Appeals:",
  "",
  "My name is Jose Rafael Contreras Blanco. I am a Venezuelan citizen currently",
  "residing in Bogota, Colombia, where I was granted refugee status in 2025.",
  "I was the secretary of the neighborhood committee of the opposition platform",
  "in Maracaibo where Diego Armando Perez Gomez served as coordinator from 2022",
  "until he fled Venezuela in 2024.",
  "",
  "I personally witnessed the following events:",
  "1. In March 2024, SEBIN officers photographed Diego and other committee",
  "   members while we organized a signature drive.",
  "2. In April 2024, Diego showed me the written death threat he received,",
  "   signed 'colectivos de la revolucion', naming him and his family.",
  "3. In May 2024, two committee members were detained; one of them remains",
  "   imprisoned. Diego fled the country days later.",
  "",
  "I did not provide this letter earlier because I feared retaliation against",
  "my family while my own refugee case in Colombia was pending. My status was",
  "granted in late 2025, and Diego's family located me in July 2026.",
  "",
  "I declare under penalty of perjury that the foregoing is true and correct.",
  "",
  "Jose Rafael Contreras Blanco",
  "Bogota, Colombia",
]);

console.log("done");
