/* Ola 4 — "documentos sin espacios en blanco": rellena de forma DETERMINISTA la
 * dirección del apelante (Statement), la dirección del OCC/OPLA y el método de
 * envío (Proof) vía tokens que resuelve renderAndStore (ai_generation_configs.
 * letter_fill). Los prompts/secciones ahora EMITEN esos tokens en vez de líneas
 * en blanco / placeholders. Deriva de apelacion-ola3/content.cjs (mismas reglas
 * de formato BIA); solo cambian el bloque de dirección/OCC/método. En inglés,
 * porque todo lo que se presenta ante la BIA va en inglés. */

// ── Statement of Reasons for Appeal — system prompt (ola3 + ADDRESS TOKENS) ──
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
7. Closing: a sentence requesting that the Board reverse the decision, or in the alternative vacate and remand to the Immigration Court; then "Respectfully submitted,"; the signature token; the respondent's name; "Respondent, Pro Se"; the three address tokens for Address, City/State/ZIP, Telephone; and the date token.

HARD RULES:
- Never invent facts, names, dates, statutes, or case citations. If key information is missing or illegible in the record, write "[TO BE COMPLETED BY PREPARER]" — never a guess.
- Never use vague statements like "the judge was wrong". Every reason names WHAT and WHY.
- Sober, respectful, first person. No emotion, no attacks on the judge.
- English only. The A-Number and name must be identical to the Immigration Judge's decision.
- SIGNATURE PLACEHOLDER: on the signature line (right after "Respectfully submitted,"), output the exact token {{APPELLANT_SIGNATURE}} on its own line — the system replaces it with the appellant's signature image (or a printable line). Reproduce it verbatim; never translate, wrap, bold, or alter it. Keep the printed name and "Respondent, Pro Se" on the lines below it.
- ADDRESS TOKENS: the appellant's mailing address is filled by the system, not by you. On the address lines output the three tokens EXACTLY — "Address: {{APPELLANT_ADDRESS}}", "City / State / ZIP: {{APPELLANT_CITY_STATE_ZIP}}", "Telephone: {{APPELLANT_TELEPHONE}}" — the system replaces each with the appellant's confirmed mailing address. Reproduce the tokens verbatim; NEVER write an actual address and NEVER leave blank underscores.
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
    guidance: "Left-aligned, in this exact order, each numbered item as its own paragraph separated by a BLANK line: (1) the prayer (request reverse, or vacate & remand); (2) 'Respectfully submitted,'; (3) the token {{APPELLANT_SIGNATURE}} on its own line (a technical placeholder for the appellant's signature — reproduce it verbatim, never translate, wrap, bold, or alter it); (4) the signer block exactly as '**<respondent full name>**<br>Respondent, Pro Se' (the name wrapped in ** ** (bold), then a literal <br>, then 'Respondent, Pro Se'); (5) the address block exactly as 'Address: {{APPELLANT_ADDRESS}}<br>City / State / ZIP: {{APPELLANT_CITY_STATE_ZIP}}<br>Telephone: {{APPELLANT_TELEPHONE}}' (each on its own line via <br>) — reproduce the three tokens {{APPELLANT_ADDRESS}}, {{APPELLANT_CITY_STATE_ZIP}} and {{APPELLANT_TELEPHONE}} VERBATIM; the system fills them with the appellant's confirmed mailing address; NEVER write an address or blank underscores yourself; (6) a final line 'Date: {{CURRENT_DATE}}' (reproduce the token {{CURRENT_DATE}} verbatim — the system replaces it with today's date). No markdown headings." },
];

// ── Proof of Service — system prompt (ola3 + OCC + METHOD tokens) ────────────
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
4. Declaration, first person: "I, {full name}, the Respondent in the above-captioned matter, hereby certify that on the date written below I served a true and complete copy of the following documents:" then the LIST of documents actually served — the Notice of Appeal (Form EOIR-26), the attached Statement of Reasons for Appeal, and the copy of the appeal fee receipt (or the Fee Waiver Request, Form EOIR-26A, whichever the case uses) — "upon the opposing party, the U.S. Department of Homeland Security, Immigration and Customs Enforcement, Office of the Chief Counsel, at the following address:" then, on its own lines, the OCC address token {{OCC_ADDRESS}}.
5. Method of service: output the line "Method of service (check one):" then, on the next line, the token {{SERVICE_METHOD_CHECKBOXES}}.
6. "I declare under penalty of perjury that the foregoing is true and correct."; the signature token; the respondent's name; "Respondent, Pro Se"; and "Date of service: {{CURRENT_DATE}}".

HARD RULES:
- The list of served documents must match what the case actually files. If the case uses the EOIR-26A Fee Waiver instead of a paid fee receipt, name the Fee Waiver; if it uses a paid fee receipt, name the receipt.
- OCC ADDRESS TOKEN: where the Office of the Chief Counsel address goes, output the exact token {{OCC_ADDRESS}} on its own line — the system fills it with the correct office for the court. Reproduce it verbatim; NEVER write or invent an address yourself.
- METHOD TOKEN: output the exact token {{SERVICE_METHOD_CHECKBOXES}} where the three method check-boxes go — the system renders the three method lines and marks the one the appellant chose. Reproduce it verbatim; do NOT write the check-boxes yourself.
- Sober and factual — it declares a fact (a copy was served), not an argument. English only. Name/A-Number identical to the IJ decision.
- SIGNATURE PLACEHOLDER: on the signature line (right after the perjury declaration), output the exact token {{APPELLANT_SIGNATURE}} on its own line — the system replaces it with the appellant's signature image (or a printable line). Reproduce it verbatim; never translate, wrap, bold, or alter it. Keep the printed name and "Respondent, Pro Se" on the lines below it.
- DATE TOKEN: on the final date line, output exactly "Date of service: {{CURRENT_DATE}}" — the system replaces {{CURRENT_DATE}} with today's date. Reproduce the token verbatim; never write an actual date yourself.`;

const PROOF_SECTIONS = [
  { key: "document", heading: "Proof of Service", min_words: 60, max_tokens: 1000, type: "analysis", hide_heading: true,
    guidance: "Produce the COMPLETE Proof of Service in ONE pass, top to bottom, and STOP. Write each part EXACTLY ONCE — never repeat the caption, the served-documents list, the address, the method check-boxes, the perjury sentence, the signature, or the date. In this exact order: (1) the centered three-line agency header, the centered caption (NAME uppercase + ', Respondent-Appellant.', 'File No.: A-Number', 'In Removal Proceedings'), and the centered bold title 'PROOF OF SERVICE' with '(Certificate of Service)' — center each with <p style=\"text-align:center\">…</p> (<br> for line breaks, <strong> for the title); (2) a left-aligned first-person certification listing the documents served (Notice of Appeal (Form EOIR-26), the attached Statement of Reasons for Appeal, and the fee receipt OR Fee Waiver Request (Form EOIR-26A), whichever the case uses) served upon the U.S. DHS ICE Office of the Chief Counsel at the following address, then on its OWN line the token {{OCC_ADDRESS}} (reproduce it verbatim — the system fills the correct office address; never write an address yourself); (3) the method block exactly as 'Method of service (check one):<br>{{SERVICE_METHOD_CHECKBOXES}}' (reproduce the token {{SERVICE_METHOD_CHECKBOXES}} verbatim — the system renders the three method lines and marks the chosen one; do NOT write the check-boxes yourself); (4) the sentence 'I declare under penalty of perjury that the foregoing is true and correct.'; (5) a blank line, then on its OWN line the token {{APPELLANT_SIGNATURE}}; (6) then the signer block exactly as '**<respondent full name>**<br>Respondent, Pro Se' — i.e. the name wrapped in ** ** (bold) on its own line, then a literal <br>, then 'Respondent, Pro Se'; (7) then a BLANK line; (8) then a final line 'Date of service: {{CURRENT_DATE}}'. Everything after the title is left-aligned; no markdown headings. The tokens {{OCC_ADDRESS}}, {{SERVICE_METHOD_CHECKBOXES}}, {{APPELLANT_SIGNATURE}} and {{CURRENT_DATE}} must each appear EXACTLY ONCE — reproduce them verbatim, never translate, wrap, bold, or alter them, and never write an actual address, check-box, or date yourself." },
];

// ── letter_fill (config-as-data resolved in renderAndStore) ──────────────────
const LETTER_FILL_STATEMENT = {
  appellant_contact: {
    // Primary source: the CONFIRMED EOIR-26 item #10 answers (the client reviewed
    // them; they autofill from the I-589). Fallback: the raw I-589 extraction.
    form_slug: "eoir-26",
    address_question: "¿Cuál es tu dirección (calle y número)?",
    apartment_question: "¿Tienes número de apartamento o cuarto? (opcional)",
    city_state_zip_question: "¿Cuál es tu ciudad, estado y código postal?",
    telephone_question: "¿Cuál es tu número de teléfono?",
    fallback_document_slug: "asilo-presentado-completo-con-anexos",
    fallback_fields: {
      street: "us_street_address",
      apartment: "us_apartment_number",
      city_state_zip: "us_city_state_zip",
      telephone: "us_phone",
    },
  },
};

const LETTER_FILL_PROOF = {
  occ_address: {
    decision_document_slug: "decision-y-orden-del-juez-de-inmigracion",
    court_json_path: "court_location",
    override_form_slug: "proof-of-service-cuestionario",
    override_question: "¿Cuál es la dirección de la oficina del Chief Counsel (DHS/OPLA)?",
  },
  service_method: {
    form_slug: "proof-of-service-cuestionario",
    method_question: "¿Cómo se enviará la copia al gobierno?",
  },
};

// Statement generation must also read the confirmed EOIR-26 answers (for the address).
const STATEMENT_INPUT_FORM_SLUGS = ["statement-of-reasons-for-appeal-cuestionario", "eoir-26a", "eoir-26"];

// ── Proof questionnaire — method as a select + address override ──────────────
// Option values MUST match ai-engine/letter-fill.ts SERVICE_METHOD_LINES keys.
const PROOF_METHOD_QUESTION = {
  question_i18n: { es: "¿Cómo se enviará la copia al gobierno?", en: "How will the copy be served on the government?" },
  help_i18n: {
    es: "Se marca en el documento; por defecto correo de primera clase. Puedes cambiarlo al momento real de enviar.",
    en: "Marked on the document; defaults to first-class mail. You may change it when you actually serve it.",
  },
  field_type: "select",
  options: [
    { value: "first_class_mail", label_i18n: { es: "Correo de primera clase (USPS)", en: "First-class U.S. mail" } },
    { value: "personal_delivery", label_i18n: { es: "Entrega en mano", en: "Personal delivery (hand service)" } },
    { value: "ecas", label_i18n: { es: "Servicio electrónico (ECAS)", en: "Electronic service (ECAS)" } },
  ],
  source: "client_answer",
  source_ref: { default_value: "first_class_mail" },
  is_required: false,
  empty_policy: "inherit",
};

const PROOF_ADDRESS_OVERRIDE_HELP = {
  es: "Normalmente se completa sola con la oficina del Chief Counsel de tu corte. Complétala solo si tu corte no aparece; búscala en el directorio de ICE/OPLA.",
  en: "Usually filled automatically with your court's Office of the Chief Counsel. Complete it only if your court is not listed; look it up in the ICE/OPLA directory.",
};

module.exports = {
  STATEMENT: {
    letter_slug: "statement-of-reasons-for-appeal",
    system_prompt: STATEMENT_SYSTEM_PROMPT,
    sections: STATEMENT_SECTIONS,
    input_form_slugs: STATEMENT_INPUT_FORM_SLUGS,
    letter_fill: LETTER_FILL_STATEMENT,
    guide_path: "docs/guides/statement-of-reasons-for-appeal-guia.md",
  },
  PROOF: {
    letter_slug: "proof-of-service",
    qn_slug: "proof-of-service-cuestionario",
    system_prompt: PROOF_SYSTEM_PROMPT,
    sections: PROOF_SECTIONS,
    letter_fill: LETTER_FILL_PROOF,
    method_question: PROOF_METHOD_QUESTION,
    address_override_help: PROOF_ADDRESS_OVERRIDE_HELP,
    address_override_question_es: "¿Cuál es la dirección de la oficina del Chief Counsel (DHS/OPLA)?",
    guide_path: "docs/guides/proof-of-service-guia.md",
  },
};
