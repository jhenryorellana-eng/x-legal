/**
 * Synthetic fixtures for the FULL Appeal E2E (new demo client Valentina, PROD).
 * All data is fictitious and internally consistent (the Pre-Mortem cross-checks
 * names/A-numbers/dates against every document):
 *   - VALENTINA CAROLINA ROJAS MEDINA · Venezuelan · A398-201-556 · DOB 1997-03-14
 *   - I-589 filed 2025-01-20 · political opinion (student movement, Barquisimeto)
 *   - Hearing 2026-06-26 · WRITTEN decision 2026-07-06 · IJ Susan K. Albright,
 *     Immigration Court, San Francisco, CA (9th Cir. — matches the dataset)
 *   - Grounds: insufficient corroboration + nexus; withholding denied; CAT in one line
 *   - 3 NEW evidences, all honestly unavailable before the hearing.
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

// ── 1. Pasaporte ────────────────────────────────────────────────────────────
await makePdf("valentina-pasaporte.pdf", [
  "**REPUBLICA BOLIVARIANA DE VENEZUELA",
  "**PASAPORTE / PASSPORT",
  "",
  "Tipo / Type: P        Pais / Country: VEN",
  "Pasaporte No. / Passport No.: 145623987",
  "",
  "Apellidos / Surname: ROJAS MEDINA",
  "Nombres / Given names: VALENTINA CAROLINA",
  "Nacionalidad / Nationality: VENEZOLANA / VENEZUELAN",
  "Fecha de nacimiento / Date of birth: 14 MAR 1997",
  "Lugar de nacimiento / Place of birth: BARQUISIMETO, VENEZUELA",
  "Sexo / Sex: F",
  "Fecha de emision / Date of issue: 02 FEB 2023",
  "Fecha de vencimiento / Date of expiry: 01 FEB 2033",
]);

// ── 2. Asilo presentado completo (I-589 + declaración + anexos) ─────────────
await makePdf("valentina-asilo-completo.pdf", [
  "**FORM I-589 — APPLICATION FOR ASYLUM AND FOR WITHHOLDING OF REMOVAL",
  "**AS FILED — COMPLETE PACKAGE WITH ANNEXES",
  "",
  "Date filed: January 20, 2025",
  "Part A.I — Information about you",
  "Alien Registration Number (A-Number): A 398-201-556",
  "Full name: ROJAS MEDINA, Valentina Carolina",
  "Date of birth: 03/14/1997    Country of birth: Venezuela",
  "Nationality: Venezuelan",
  "8. Residence in the U.S.: 1584 Mission Street, Apt 12",
  "   San Francisco, CA 94103     Telephone: (415) 555-0139",
  "Date of last entry into the U.S.: 05/18/2024",
  "",
  "Part B — Why are you applying? Basis: POLITICAL OPINION",
  "",
  "**DECLARATION OF VALENTINA CAROLINA ROJAS MEDINA (ANNEX A)",
  "",
  "1. I was an organizer of the university student movement at Universidad",
  "   Centroccidental in Barquisimeto from 2021 until I fled in April 2024.",
  "   I coordinated protest logistics and voter-registration drives for the",
  "   democratic opposition.",
  "2. On March 15, 2023, after a campus protest, I was detained by state",
  "   security agents for 48 hours. I was beaten during that detention and",
  "   treated at the Hospital Central Antonio Maria Pineda emergency room on",
  "   March 18, 2023. The hospital kept the original report.",
  "3. In November 2023, a written threat signed by 'colectivos' was left at",
  "   my parents' home naming me and warning that student traitors 'disappear'.",
  "4. In February 2024, a SEBIN summons (citacion) was delivered at my home",
  "   ordering me to appear; friends warned me that others who appeared were",
  "   detained. I went into hiding, staying with my aunt in Valencia, where",
  "   men on motorcycles asked neighbors about me within two weeks.",
  "5. I left Venezuela on April 29, 2024 through Colombia and entered the",
  "   United States on May 18, 2024.",
  "6. My faculty advisor, Professor Ana Belen Torres, witnessed the March 2023",
  "   detention and saw the November 2023 written threat. She left Venezuela",
  "   in 2024; at the time of my filing I had no way to contact her safely.",
  "",
  "**ANNEX B — COUNTRY CONDITIONS CLIPPINGS (AS FILED)",
  "Press article 1: 'Student leaders detained after Barquisimeto protest'",
  "(El Impulso, March 17, 2023) — names the March 2023 campus protest and",
  "reports detentions by state security forces.",
  "Press article 2: 'Colectivos threaten university organizers' (Efecto",
  "Cocuyo, December 2, 2023) — documents written threats against student",
  "organizers in Lara state in late 2023.",
  "",
  "**ANNEX C — PROOF OF STUDENT MOVEMENT MEMBERSHIP (AS FILED)",
  "Certification of the student federation naming Valentina Rojas Medina as",
  "logistics coordinator (2021-2024), signed by the federation secretary.",
]);

// ── 3. Decisión y orden del juez (San Francisco, 9th Cir.) ──────────────────
await makePdf("valentina-decision-juez.pdf", [
  "**UNITED STATES DEPARTMENT OF JUSTICE",
  "**EXECUTIVE OFFICE FOR IMMIGRATION REVIEW",
  "**IMMIGRATION COURT, SAN FRANCISCO, CALIFORNIA",
  "",
  "In the Matter of:                                 File No.: A 398-201-556",
  "ROJAS MEDINA, Valentina Carolina",
  "Respondent                                        IN REMOVAL PROCEEDINGS",
  "",
  "**DECISION AND ORDER OF THE IMMIGRATION JUDGE (WRITTEN DECISION)",
  "",
  "The respondent, a native and citizen of Venezuela, applied for asylum",
  "under INA section 208, withholding of removal under section 241(b)(3),",
  "and protection under the Convention Against Torture. The merits hearing",
  "was held on June 26, 2026; the respondent was the only witness.",
  "",
  "The Court finds, first, that the respondent's testimony, while generally",
  "consistent, was NOT SUFFICIENTLY CORROBORATED: she produced no medical",
  "record of the claimed March 2023 detention injuries, no police or",
  "prosecutorial record, and no statement from any witness with direct",
  "knowledge of the events, although such corroboration should reasonably",
  "have been available to her.",
  "",
  "Second, the Court finds that the respondent FAILED TO ESTABLISH A NEXUS",
  "between the harm she fears and a protected ground: the evidence does not",
  "show that she was targeted on account of an actual or imputed political",
  "opinion rather than as part of generalized unrest affecting students.",
  "",
  "Withholding of removal necessarily fails with the asylum claim. The",
  "application for protection under the Convention Against Torture is also",
  "denied.",
  "",
  "**ORDER",
  "IT IS HEREBY ORDERED that the respondent be REMOVED from the United",
  "States to VENEZUELA.",
  "",
  "Dated: July 6, 2026",
  "Susan K. Albright",
  "United States Immigration Judge",
  "Immigration Court, San Francisco, CA",
]);

// ── 4. Evidencia nueva 1 — Denuncia ante la Fiscalía (post-decisión) ────────
await makePdf("valentina-ev1-denuncia.pdf", [
  "**REPUBLICA BOLIVARIANA DE VENEZUELA",
  "**MINISTERIO PUBLICO - FISCALIA SUPERIOR DEL ESTADO LARA, BARQUISIMETO",
  "**CONSTANCIA DE DENUNCIA No. MP-LARA-2026-045512",
  "",
  "Fecha de la denuncia: 11 de julio de 2026",
  "Denunciante: Miriam Medina de Rojas (madre de Valentina Carolina Rojas Medina)",
  "",
  "La compareciente expone: que el dia 9 de julio de 2026, un grupo de hombres",
  "en motocicletas, identificados por vecinos como miembros de colectivos",
  "armados, se presento en la vivienda familiar en Barquisimeto preguntando",
  "por su hija VALENTINA CAROLINA ROJAS MEDINA, senalada por su actividad en",
  "el movimiento estudiantil opositor. Golpearon la puerta, fotografiaron la",
  "fachada y advirtieron a gritos que la joven 'tiene una cuenta pendiente",
  "con la revolucion' y que 'la vamos a encontrar donde este'.",
  "",
  "La denunciante manifiesta que su hija salio del pais en abril de 2024 tras",
  "una citacion del SEBIN y amenazas escritas de colectivos, y solicita esta",
  "constancia para presentarla ante las autoridades migratorias de los",
  "Estados Unidos.",
  "",
  "Se emite la presente constancia a peticion de la parte interesada.",
  "Fiscal Auxiliar: Abg. Ricardo Uzcategui",
  "Sello y firma",
]);

// ── 5. Evidencia nueva 2 — Carta de la testigo (profesora, asilada) ────────
await makePdf("valentina-ev2-carta-profesora.pdf", [
  "**SWORN WITNESS STATEMENT / DECLARACION JURADA DE TESTIGO",
  "",
  "Date: July 12, 2026",
  "To the Board of Immigration Appeals:",
  "",
  "My name is Ana Belen Torres Quintero. I was a professor at Universidad",
  "Centroccidental in Barquisimeto and the faculty advisor of the student",
  "movement in which Valentina Carolina Rojas Medina served as logistics",
  "coordinator from 2021 to 2024. I was granted asylum in Spain in May 2026.",
  "",
  "I personally witnessed the following:",
  "1. On March 15, 2023, state security agents detained Valentina after the",
  "   campus protest. I saw her taken from the university gate. When she was",
  "   released two days later I saw bruises on her face and arms, and I",
  "   accompanied her while she received medical attention.",
  "2. In November 2023 Valentina showed me the written threat signed by",
  "   'colectivos' that was left at her parents' home. It named her and",
  "   warned that student traitors 'disappear'.",
  "3. In February 2024 she showed me the SEBIN summons delivered to her home.",
  "   Two students of our movement who obeyed similar summonses that month",
  "   were detained for weeks.",
  "",
  "I could not provide this statement earlier: I fled Venezuela myself in",
  "2024 and, while my asylum case in Spain was pending, I avoided signing",
  "any public declaration out of fear of reprisals against my relatives in",
  "Lara. My protection was granted in May 2026, and Valentina's family",
  "reached me through a former colleague in July 2026.",
  "",
  "I declare under penalty of perjury that the foregoing is true and correct.",
  "Ana Belen Torres Quintero — Madrid, Spain",
]);

// ── 6. Evidencia nueva 3 — Informe médico de marzo 2023 (copia certificada) ─
await makePdf("valentina-ev3-informe-medico.pdf", [
  "**HOSPITAL CENTRAL UNIVERSITARIO ANTONIO MARIA PINEDA — BARQUISIMETO",
  "**SERVICIO DE EMERGENCIA — COPIA CERTIFICADA DE INFORME MEDICO",
  "",
  "Fecha de emision de la copia certificada: 10 de julio de 2026",
  "Fecha de la atencion original: 18 de marzo de 2023",
  "",
  "Paciente: ROJAS MEDINA, VALENTINA CAROLINA",
  "Fecha de nacimiento: 14/03/1997",
  "",
  "Motivo de consulta: politraumatismos. La paciente refiere agresion fisica",
  "durante detencion de 48 horas por funcionarios de seguridad del Estado.",
  "",
  "Hallazgos: contusiones multiples en rostro y brazos, hematoma periorbitario",
  "izquierdo, escoriaciones en munecas compatibles con sujecion prolongada.",
  "Se indica tratamiento ambulatorio y control.",
  "",
  "NOTA DE CERTIFICACION: El presente es copia fiel del informe que reposa en",
  "el archivo clinico de este hospital. La copia certificada fue solicitada",
  "por la familia de la paciente en repetidas oportunidades desde 2024 y",
  "emitida el 10 de julio de 2026 previa autorizacion de la direccion del",
  "centro, tramitada con apoyo de la Fiscalia Superior del Estado Lara.",
  "",
  "Dr. Luis Anzola — Medico de guardia (firma y sello)",
  "Direccion de Registros Medicos (sello de certificacion)",
]);

console.log("done");
