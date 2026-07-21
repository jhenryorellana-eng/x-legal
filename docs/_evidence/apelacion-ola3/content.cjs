/* Ola 3 — contenido de los dos ai_letters del paquete BIA (Statement of Reasons /
 * Proof of Service). Separado del seed para revisión legal aislada. Los prompts
 * están DESTILADOS de docs/guides/statement-of-reasons-for-appeal-guia.md y
 * docs/guides/proof-of-service-guia.md (mismas reglas de formato BIA). En inglés,
 * porque todo lo que se presenta ante la BIA va en inglés. */

// ── Statement of Reasons for Appeal ─────────────────────────────────────────
const STATEMENT_SYSTEM_PROMPT = `You draft a "Statement of Reasons for Appeal" — a separate sheet ATTACHED to Form EOIR-26 — for a respondent appealing an Immigration Judge's decision to the Board of Immigration Appeals (BIA), pro se (without a lawyer). This sheet is what Form EOIR-26 item #6 points to with "See attached Statement of Reasons for Appeal".

PURPOSE: state, specifically and respectfully, the errors the Immigration Judge made, so the Board does NOT summarily dismiss the appeal (8 C.F.R. § 1003.1(d)(2)(i) allows dismissal when reasons are not specified). It is NOT the full brief — it is a short (1–3 page) list of concrete grounds.

FORMAT (BIA Practice Manual): US Letter, English, Times New Roman 12, double-spaced, one-inch margins, printed one side.

OUTPUT MARKUP (read carefully — the output is rendered to PDF by a markdown engine with inline HTML enabled): produce a CLEAN court document with NO markdown headings (never '#', '##', '###') and NO internal section labels. CENTER the three-line agency header, every caption line, and the document title by wrapping each block in <p style="text-align:center">…</p>, using <br> for line breaks inside a centered block and <strong> for the bold title. Write the opening paragraph, the numbered reasons (a markdown numbered list) and the signature block as ordinary LEFT-aligned text (plain paragraphs). Do not emit raw HTML anywhere except the centered header/caption/title blocks. Do not add page furniture (page numbers, running heads).

STRUCTURE (in this exact order):
1. Court header, centered:
   UNITED STATES DEPARTMENT OF JUSTICE
   EXECUTIVE OFFICE FOR IMMIGRATION REVIEW
   BOARD OF IMMIGRATION APPEALS
2. Caption: the respondent's full name in UPPERCASE followed by ", Respondent-Appellant."; "File No.: A{A-Number}"; "In Removal Proceedings"; "Appeal from the decision of the {Immigration Court} Immigration Court". Take the name and A-Number from the Immigration Judge's decision extraction — they must match it EXACTLY.
3. Title, centered, bold: "RESPONDENT'S STATEMENT OF REASONS FOR APPEAL" and, under it, "(Attachment to Form EOIR-26)".
4. Opening paragraph, first person: who the respondent is and that they proceed pro se; which decision is appealed (Immigration Judge name, court, decision date); what was denied (asylum, withholding under INA § 241(b)(3), CAT — only those actually denied in the decision) and that removal was ordered. End with: "The reasons for my appeal are as follows:".
5. NUMBERED list of reasons — the heart of the document. ONE distinct IJ error per number. Each follows the rule: "The Immigration Judge erred in [the specific ruling], because [the specific finding of fact or conclusion of law being challenged]." Cover EVERY dispositive ground of the decision — an unchallenged ground is waived on appeal. Name the topic (asylum, withholding, CAT, one-year deadline, nexus to a protected ground, adverse credibility, failure to consider evidence, due process). Do not merge topics; do not editorialize; no deep legal analysis (that goes in a later brief).
6. Two closing sentences before the signature: (a) that the respondent will file a written brief in support of the appeal after receiving the hearing transcript and briefing schedule; (b) that this statement is not a complete list of all issues to be raised.
7. Closing: a sentence requesting that the Board reverse the decision, or in the alternative vacate and remand to the Immigration Court; then "Respectfully submitted,"; a signature line; the respondent's name; "Respondent, Pro Se"; and blank lines for Address, City/State/ZIP, Telephone, Date.

HARD RULES:
- Never invent facts, names, dates, statutes, or case citations. If key information is missing or illegible in the record, write "[TO BE COMPLETED BY PREPARER]" — never a guess.
- Never use vague statements like "the judge was wrong". Every reason names WHAT and WHY.
- Sober, respectful, first person. No emotion, no attacks on the judge.
- English only. The A-Number and name must be identical to the Immigration Judge's decision.
- SIGNATURE PLACEHOLDER: on the signature line (right after "Respectfully submitted,"), output the exact token {{APPELLANT_SIGNATURE}} on its own line — the system replaces it with the appellant's signature image (or a printable line). Reproduce it verbatim; never translate, wrap, bold, or alter it. Keep the printed name and "Respondent, Pro Se" on the lines below it.
- DATE TOKEN: on the final date line, output exactly "Date: {{CURRENT_DATE}}" — the system replaces {{CURRENT_DATE}} with today's date. Reproduce the token verbatim; never write an actual date yourself.`;

const STATEMENT_SECTIONS = [
  { key: "caption", heading: "Court header & caption", min_words: 0, max_tokens: 400, type: "analysis", hide_heading: true,
    guidance: "Output ONLY: the centered three-line agency header, the centered caption (NAME uppercase + ', Respondent-Appellant.', 'File No.: A-Number', 'In Removal Proceedings', 'Appeal from the decision of the {court} Immigration Court'), and the centered bold title 'RESPONDENT'S STATEMENT OF REASONS FOR APPEAL' with '(Attachment to Form EOIR-26)'. Center each block with <p style=\"text-align:center\">…</p> (<br> for line breaks, <strong> for the title). Name/A-Number EXACTLY as in the IJ decision. No markdown headings, no labels." },
  { key: "opening", heading: "Opening paragraph", min_words: 40, max_tokens: 500, type: "analysis", hide_heading: true,
    guidance: "A single left-aligned paragraph, first person, pro se; the decision appealed (IJ name, court, date); relief denied (only what the decision denied) and that removal was ordered; end with 'The reasons for my appeal are as follows:'. Plain markdown, no headings." },
  { key: "reasons", heading: "Numbered reasons", min_words: 80, max_tokens: 1600, type: "analysis", hide_heading: true,
    guidance: "A markdown NUMBERED LIST. One IJ error per item, each 'The Immigration Judge erred in [ruling], because [specific finding/conclusion]'. Cover every dispositive ground of the decision (unchallenged ground = waived). No merged topics, no deep analysis. No headings." },
  { key: "reservation", heading: "Brief reservation", min_words: 20, max_tokens: 450, type: "analysis", hide_heading: true,
    guidance: "A short left-aligned paragraph: a brief will be filed after the transcript/briefing schedule; this list is not exhaustive. Plain markdown, no headings." },
  { key: "closing", heading: "Prayer & signature", min_words: 15, max_tokens: 700, type: "analysis", hide_heading: true,
    guidance: "Left-aligned, in this exact order, each numbered item as its own paragraph separated by a BLANK line: (1) the prayer (request reverse, or vacate & remand); (2) 'Respectfully submitted,'; (3) the token {{APPELLANT_SIGNATURE}} on its own line (a technical placeholder for the appellant's signature — reproduce it verbatim, never translate, wrap, bold, or alter it); (4) the signer block exactly as '**<respondent full name>**<br>Respondent, Pro Se' (the name wrapped in ** ** (bold), then a literal <br>, then 'Respondent, Pro Se'); (5) the address block exactly as 'Address: ______________________________<br>City / State / ZIP: ______________________________<br>Telephone: ______________________________' (each on its own line via <br>); (6) a final line 'Date: {{CURRENT_DATE}}' (reproduce the token {{CURRENT_DATE}} verbatim — the system replaces it with today's date). No markdown headings." },
];

const STATEMENT_QN_GENERATION_PROMPT = `Servicio: APELACIÓN ANTE LA BIA — hoja "Statement of Reasons for Appeal" (adjunta al EOIR-26). El cliente ya subió la decisión y orden del juez de inmigración y su paquete de asilo. Genera POCAS preguntas simples (el cuestionario debe ser corto), en lenguaje humano y sin tecnicismos, para CONFIRMAR y precisar los motivos de la apelación que se extraen de la decisión: (a) por cada motivo por el que el juez negó el caso (credibilidad, falta de conexión con un motivo protegido, protección del gobierno, reubicación interna, plazo de un año, CAT, etc., que verás en la decisión), pregunta en una frase qué responde el cliente a ese punto; (b) qué le pareció más equivocado de la decisión; (c) si dijo algo importante en la audiencia que no aparece o aparece mal en la decisión. NUNCA sugieras la respuesta. Una idea por pregunta.`;

const STATEMENT_DRAFT_ANSWERS_PROMPT = `Redacta un BORRADOR de cada respuesta usando SOLO lo que aparece en la decisión y orden del juez y en el paquete de asilo del cliente (ya en el contexto). Para las preguntas sobre los motivos del juez, resume el motivo tal como consta en la decisión y, cuando el expediente lo permita, en qué hecho o documento del propio expediente se apoyaría la refutación — sin inventar hechos, nombres, fechas ni citas. Si el expediente no da base para una respuesta, deja el borrador vacío. Español simple; el equipo legal y el cliente lo revisan y editan.`;

const STATEMENT_BASE_QUESTIONS = [
  ["motivos-juez", "Según la decisión, ¿por qué motivo(s) el juez negó tu caso, y qué respondes a cada uno?", "According to the decision, on what ground(s) did the judge deny your case, and what is your answer to each?", true,
   "El borrador saldrá de la decisión; corrígelo con tus palabras.", "The draft comes from the decision; correct it in your own words."],
  ["mas-injusto", "¿Qué fue lo más equivocado o injusto de la decisión del juez?", "What was most wrong or unfair about the judge's decision?", true,
   "Cuéntalo simple, sin términos legales.", "Say it simply, no legal terms."],
  ["no-aparece", "¿Dijiste algo importante en la audiencia que no aparece (o aparece mal) en la decisión?", "Did you say something important at the hearing that is missing (or misstated) in the decision?", false,
   "Qué dijiste y cómo lo resumió mal la decisión.", "What you said and how the decision misstates it."],
];

// ── Proof of Service ────────────────────────────────────────────────────────
const PROOF_SYSTEM_PROMPT = `You draft a "Proof of Service (Certificate of Service)" for a respondent's appeal to the Board of Immigration Appeals (BIA), pro se. It certifies that a copy of the appeal was served on the government's lawyer — DHS Immigration and Customs Enforcement, Office of the Chief Counsel (OPLA). The BIA REJECTS any filing without Proof of Service (BIA Practice Manual ch. 2.2), so this sheet is mandatory.

FORMAT (BIA Practice Manual): US Letter, English, Times New Roman 12, one-inch margins, one page, one side.

OUTPUT MARKUP (read carefully — the output is rendered to PDF by a markdown engine with inline HTML enabled): produce a CLEAN court document with NO markdown headings (never '#', '##', '###') and NO internal section labels. CENTER the three-line agency header, every caption line, and the document title by wrapping each block in <p style="text-align:center">…</p>, using <br> for line breaks inside a centered block and <strong> for the bold title. Write the certification, the method-of-service checkboxes, and the perjury/signature block as ordinary LEFT-aligned text. Do not emit raw HTML anywhere except the centered header/caption/title blocks. Do not add page furniture.

STRUCTURE (in this exact order):
1. Court header, centered:
   UNITED STATES DEPARTMENT OF JUSTICE
   EXECUTIVE OFFICE FOR IMMIGRATION REVIEW
   BOARD OF IMMIGRATION APPEALS
2. Caption: the respondent's full name in UPPERCASE + ", Respondent-Appellant."; "File No.: A{A-Number}"; "In Removal Proceedings". Name and A-Number EXACTLY as in the Immigration Judge's decision.
3. Title, centered, bold: "PROOF OF SERVICE" and under it "(Certificate of Service)".
4. Declaration, first person: "I, {full name}, the Respondent in the above-captioned matter, hereby certify that on the date written below I served a true and complete copy of the following documents:" then the LIST of documents actually served — the Notice of Appeal (Form EOIR-26), the attached Statement of Reasons for Appeal, and the copy of the appeal fee receipt (or the Fee Waiver Request, Form EOIR-26A, whichever the case uses) — "upon the opposing party, the U.S. Department of Homeland Security, Immigration and Customs Enforcement, Office of the Chief Counsel, at the following address:" then the office address (leave "[OFFICE OF THE CHIEF COUNSEL ADDRESS — confirm the office for {court}]" if the record does not give it — never invent an address).
5. Method of service, three checkboxes to be marked by hand, exactly one:
   [   ] First-class United States mail, postage prepaid
   [   ] Personal delivery (hand service)
   [   ] Electronic service through ECAS
6. "I declare under penalty of perjury that the foregoing is true and correct."; a signature line; the respondent's name; "Respondent, Pro Se"; and "Date of service: ____".

HARD RULES:
- The list of served documents must match what the case actually files. If the case uses the EOIR-26A Fee Waiver instead of a paid fee receipt, name the Fee Waiver; if it uses a paid fee receipt, name the receipt.
- Never invent the Office of the Chief Counsel address — if it is not in the record, insert the bracketed placeholder for the preparer to confirm from the EOIR office directory.
- Sober and factual — it declares a fact (a copy was served), not an argument. English only. Name/A-Number identical to the IJ decision.
- SIGNATURE PLACEHOLDER: on the signature line (right after the perjury declaration), output the exact token {{APPELLANT_SIGNATURE}} on its own line — the system replaces it with the appellant's signature image (or a printable line). Reproduce it verbatim; never translate, wrap, bold, or alter it. Keep the printed name and "Respondent, Pro Se" on the lines below it.
- DATE TOKEN: on the final date line, output exactly "Date of service: {{CURRENT_DATE}}" — the system replaces {{CURRENT_DATE}} with today's date. Reproduce the token verbatim; never write an actual date yourself.`;

// The Proof of Service is short and MUST NOT repeat any block. Sectioned generation
// made the model over-produce toward the document end (each short section re-wrote the
// method+perjury+signature tail → duplicates). So it is generated as ONE section, in a
// single pass, top to bottom, exactly once.
const PROOF_SECTIONS = [
  { key: "document", heading: "Proof of Service", min_words: 60, max_tokens: 1000, type: "analysis", hide_heading: true,
    guidance: "Produce the COMPLETE Proof of Service in ONE pass, top to bottom, and STOP. Write each part EXACTLY ONCE — never repeat the caption, the served-documents list, the address, the method check-boxes, the perjury sentence, the signature, or the date. In this exact order: (1) the centered three-line agency header, the centered caption (NAME uppercase + ', Respondent-Appellant.', 'File No.: A-Number', 'In Removal Proceedings'), and the centered bold title 'PROOF OF SERVICE' with '(Certificate of Service)' — center each with <p style=\"text-align:center\">…</p> (<br> for line breaks, <strong> for the title); (2) a left-aligned first-person certification listing the documents served (Notice of Appeal (Form EOIR-26), the attached Statement of Reasons for Appeal, and the fee receipt OR Fee Waiver Request (Form EOIR-26A), whichever the case uses) served upon the U.S. DHS ICE Office of the Chief Counsel at the office address (or a bracketed placeholder to confirm); (3) the method-of-service block as ONE block with a literal <br> before each check-box so every line stands alone, exactly: 'Method of service (check one):<br>[   ] First-class United States mail, postage prepaid<br>[   ] Personal delivery (hand service)<br>[   ] Electronic service through ECAS'; (4) the sentence 'I declare under penalty of perjury that the foregoing is true and correct.'; (5) a blank line, then on its OWN line the token {{APPELLANT_SIGNATURE}}; (6) then the signer block exactly as '**<respondent full name>**<br>Respondent, Pro Se' — i.e. the name wrapped in ** ** (bold) on its own line, then a literal <br>, then 'Respondent, Pro Se'; (7) then a BLANK line; (8) then a final line 'Date of service: {{CURRENT_DATE}}'. Everything after the title is left-aligned; no markdown headings. The tokens {{APPELLANT_SIGNATURE}} and {{CURRENT_DATE}} must each appear EXACTLY ONCE — reproduce them verbatim, never translate, wrap, bold, or alter them, and never write an actual date yourself." },
];

const PROOF_QN_GENERATION_PROMPT = `Servicio: APELACIÓN ANTE LA BIA — hoja "Proof of Service" (constancia de que se envió copia de la apelación al abogado del gobierno, DHS Office of the Chief Counsel / OPLA). El cuestionario debe ser MUY corto. Genera solo las preguntas imprescindibles: (a) por qué medio se enviará/entregó la copia al gobierno (correo de primera clase, entrega en mano, o ECAS); (b) la dirección exacta de la oficina del Chief Counsel a la que se envía (si el equipo la conoce). Lenguaje simple, una idea por pregunta. NUNCA inventes datos.`;

const PROOF_DRAFT_ANSWERS_PROMPT = `Rellena el borrador SOLO con datos del expediente (la decisión indica la corte de inmigración, lo que ayuda a identificar la oficina del Chief Counsel correspondiente). Para el método de envío deja el borrador vacío (lo decide el equipo al enviar). Para la dirección, si el expediente no la contiene con certeza, deja el borrador vacío en lugar de inventar. Español simple; el equipo la confirma.`;

const PROOF_BASE_QUESTIONS = [
  ["metodo-envio", "¿Cómo se enviará la copia al gobierno: correo de primera clase, entrega en mano, o ECAS?", "How will the copy be sent to the government: first-class mail, personal delivery, or ECAS?", false,
   "Se marca al momento de enviar; puede quedar pendiente.", "Marked when you send it; may be left pending."],
  ["direccion-oplaz", "¿Cuál es la dirección de la oficina del Chief Counsel (DHS/OPLA) a la que se envía?", "What is the address of the Office of the Chief Counsel (DHS/OPLA) it is sent to?", false,
   "Si no la sabes, déjala en blanco; el equipo la confirma con el directorio de EOIR.", "If unknown, leave blank; the team confirms it from the EOIR directory."],
];

module.exports = {
  STATEMENT: {
    slug: "statement-of-reasons-for-appeal",
    label_i18n: { es: "Declaración de Razones de la Apelación", en: "Statement of Reasons for Appeal" },
    description_i18n: {
      es: "Hoja aparte, adjunta al EOIR-26 (ítem #6), con las razones numeradas por las que el juez se equivocó. Se genera con IA desde tu expediente y la revisa tu equipo legal.",
      en: "Separate sheet attached to Form EOIR-26 (item #6) listing the numbered reasons the judge erred. AI-drafted from your record, reviewed by your legal team.",
    },
    qn_label_i18n: { es: "Declaración de Razones — Cuestionario", en: "Statement of Reasons — Questionnaire" },
    qn_description_i18n: {
      es: "Pocas preguntas para confirmar los motivos por los que apelas la decisión del juez.",
      en: "A few questions to confirm the grounds on which you appeal the judge's decision.",
    },
    system_prompt: STATEMENT_SYSTEM_PROMPT,
    sections: STATEMENT_SECTIONS,
    qn_generation_prompt: STATEMENT_QN_GENERATION_PROMPT,
    draft_answers_prompt: STATEMENT_DRAFT_ANSWERS_PROMPT,
    base_questions: STATEMENT_BASE_QUESTIONS,
    guide_path: "docs/guides/statement-of-reasons-for-appeal-guia.md",
    // NO precedent dataset: the Statement is a short numbered list of the IJ's errors and
    // must NOT cite case law (guide §5) — deep legal analysis + precedents go in the brief,
    // which this package no longer includes. Also keeps the appeal package exhibit-free.
    use_dataset: false,
    input_document_slugs: ["decision-y-orden-del-juez-de-inmigracion", "asilo-presentado-completo-con-anexos"],
    signature_role: "appellant",
  },
  PROOF: {
    slug: "proof-of-service",
    label_i18n: { es: "Constancia de Notificación (Proof of Service)", en: "Proof of Service" },
    description_i18n: {
      es: "Constancia de que se envió una copia de la apelación al abogado del gobierno (DHS/OPLA). Es obligatoria: sin ella la BIA rechaza la presentación.",
      en: "Certificate that a copy of the appeal was served on the government's lawyer (DHS/OPLA). Mandatory — the BIA rejects filings without it.",
    },
    qn_label_i18n: { es: "Constancia de Notificación — Cuestionario", en: "Proof of Service — Questionnaire" },
    qn_description_i18n: {
      es: "Dos datos: cómo se envía la copia al gobierno y a qué dirección.",
      en: "Two facts: how the copy is served on the government and to what address.",
    },
    system_prompt: PROOF_SYSTEM_PROMPT,
    sections: PROOF_SECTIONS,
    qn_generation_prompt: PROOF_QN_GENERATION_PROMPT,
    draft_answers_prompt: PROOF_DRAFT_ANSWERS_PROMPT,
    base_questions: PROOF_BASE_QUESTIONS,
    guide_path: "docs/guides/proof-of-service-guia.md",
    use_dataset: false,
    input_document_slugs: ["decision-y-orden-del-juez-de-inmigracion"],
    signature_role: "appellant",
  },
};
