/* Create the EOIR-26A (Fee Waiver Request) pdf_automation for the Apelación service,
 * config-as-data (form_definition + version + groups + questions). Requires migrations
 * 0098-0100 (applied 2026-07-20). Mirrors how EOIR-26 was configured.
 *
 *   node docs/_evidence/eoir26a-automation/publish-eoir26a.cjs            # dry-run (prints plan)
 *   node docs/_evidence/eoir26a-automation/publish-eoir26a.cjs --apply    # create DRAFT in PROD
 *   node docs/_evidence/eoir26a-automation/publish-eoir26a.cjs --apply --publish  # + publish v1
 *
 * SAFE BY DEFAULT: dry-run. Without --publish it leaves the version as a DRAFT (never
 * served to clients) so the version is verified in the admin editor (Generar PDF de
 * prueba, which runs the app's own validateVersionPublication) before going live.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));

const APPLY = process.argv.includes("--apply");
const PUBLISH = process.argv.includes("--publish");
const PDF_PATH = "C:/Users/mauri/Documents/Trabajos/UsaLatinoPrime/documentos/EOIR-26A.pdf";
const DECISION_SLUG = "decision-y-orden-del-juez-de-inmigracion";

const ROOT = path.join(__dirname, "../../..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");
if (!URL || !SERVICE) { console.error("Missing SUPABASE creds in .env.local"); process.exit(2); }
const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
const die = (s, e) => { console.error(`FAIL [${s}]:`, e?.message ?? e); process.exit(1); };

const t = (es, en) => ({ es, en });
const uid = () => crypto.randomUUID();

// ── Survey design (config-as-data). ids generated up-front so computed refs resolve. ──
const ID = {
  name: uid(), anum: uid(), printname: uid(), sig: uid(), sigdate: uid(),
  inc1: uid(), inc2: uid(), inc3: uid(), inc4: uid(), totinc: uid(),
  exp1: uid(), exp2: uid(), exp3: uid(), exp4: uid(), exp5: uid(), totexp: uid(),
  net: uid(), info: uid(), attSig: uid(), attName: uid(), attEoir: uid(), attDate: uid(),
};
const dx = (json_path) => ({ document_slug: DECISION_SLUG, json_path }); // document_extraction ref
const money = (es, en, pdf) => ({
  id: undefined, field_type: "number", source: "client_answer", source_ref: { default_value: "0" },
  pdf_field_name: pdf, question_i18n: t(es, en), is_required: false,
});

const GROUPS = [
  { title: t("Encabezado", "Header"), do_not_fill: false, questions: [
    { id: ID.name, field_type: "text", source: "document_extraction", source_ref: dx("respondent_full_name"),
      pdf_field_name: "Name Last First Middle", no_translate: true, is_required: false,
      question_i18n: t("Nombre completo (Apellido, Nombre, Segundo nombre)", "Name (Last, First, Middle)"),
      help_i18n: t("Lo tomamos de la decisión del juez que subiste. Debe coincidir con tus documentos.", "Taken from the judge's decision you uploaded; must match your immigration documents.") },
    { id: ID.anum, field_type: "text", source: "document_extraction", source_ref: dx("a_number"),
      pdf_field_name: "Alien A Number", no_translate: true, is_required: false,
      question_i18n: t("Número “A” (Alien Number)", "Alien (“A”) Number"),
      help_i18n: t("Empieza con A y 8 o 9 dígitos. Lo tomamos de la decisión del juez.", "Starts with A and 8-9 digits; taken from the judge's decision.") },
  ] },
  { title: t("Declaración jurada (Affidavit)", "Affidavit"), do_not_fill: false, questions: [
    { id: ID.printname, field_type: "text", source: "document_extraction", source_ref: dx("respondent_full_name"),
      pdf_field_name: "Print name of alien filing the form", no_translate: true, is_required: false,
      question_i18n: t("Tu nombre en letra de molde (quien firma la declaración)", "Print name of respondent filing the form"),
      help_i18n: t("Es la misma persona del encabezado: la declaración la firma el cliente, nunca el abogado.", "Same person as the header; the affidavit is signed by the client, never the attorney.") },
  ] },
  { title: t("Firma y fecha (las firmas tú a mano)", "Signature and date (you sign by hand)"), do_not_fill: true, questions: [
    { id: ID.sig, field_type: "text", source: "client_answer", source_ref: null, pdf_field_name: "Signature of Alien Filing the Form",
      is_required: false, question_i18n: t("Firma del respondente", "Signature of respondent") },
    { id: ID.sigdate, field_type: "date", source: "client_answer", source_ref: null, pdf_field_name: "AlienSigDate",
      is_required: false, question_i18n: t("Fecha de la firma", "Date signed") },
  ] },
  { title: t("Parte 1 — Ingresos mensuales (promedio, monto bruto)", "Part 1 — Monthly income (average, gross)"), do_not_fill: false, questions: [
    { ...money("Empleo o trabajo por tu cuenta", "Employment, including self-employment", "IncomeEmployment"), id: ID.inc1,
      help_i18n: t("Lo que ganas al mes por trabajar, ANTES de descuentos. Si te pagan semanal/quincenal, saca el promedio mensual.", "Monthly gross from work, before deductions. Convert weekly/biweekly pay to a monthly average.") },
    { ...money("Renta de propiedades", "Income from real property (rental)", "IncomeProperty"), id: ID.inc2 },
    { ...money("Intereses de cuentas bancarias", "Interest from checking/savings account(s)", "IncomeInterest"), id: ID.inc3 },
    { ...money("Otros ingresos (pensión, manutención, seguro social, desempleo, ayuda pública, dividendos, etc.)", "All other income (alimony, child support, social security, unemployment, public assistance, dividends, etc.)", "IncomeOther"), id: ID.inc4 },
    { id: ID.totinc, field_type: "number", source: "computed", source_ref: { op: "sum", inputs: [ID.inc1, ID.inc2, ID.inc3, ID.inc4] },
      pdf_field_name: "MonthIncome", is_required: false,
      question_i18n: t("1.A Total de ingresos mensuales", "1.A Total average monthly income"),
      help_i18n: t("Se calcula solo: la suma de los cuatro ingresos de arriba.", "Computed automatically: the sum of the four income rows above.") },
  ] },
  { title: t("Parte 2 — Gastos mensuales (promedio)", "Part 2 — Monthly expenses (average)"), do_not_fill: false, questions: [
    { ...money("Renta o hipoteca", "Rent or home-mortgage payment(s)", "ExpenseRent"), id: ID.exp1 },
    { ...money("Servicios (luz, agua, gas, teléfono, internet)", "Utilities (electricity, water, gas, phone, internet)", "ExpenseUtil"), id: ID.exp2 },
    { ...money("Pagos a plazos o deudas (tarjetas, carro, préstamos — NO incluyas renta/hipoteca)", "Installment payments or debts (credit cards, vehicle, loans — NOT rent/mortgage)", "ExpenseInstall"), id: ID.exp3 },
    { ...money("Gastos de vida (comida, ropa, transporte, cuidado de niños, colegiaturas)", "Living expenses (food, clothing, transportation, child care, tuition)", "ExpenseLiving"), id: ID.exp4 },
    { ...money("Otros gastos (pensión que pagas, seguros, médicos, impuestos, honorarios de abogado)", "All other expenses (alimony, insurance, medical, taxes, attorney fees)", "ExpenseOther"), id: ID.exp5 },
    { id: ID.totexp, field_type: "number", source: "computed", source_ref: { op: "sum", inputs: [ID.exp1, ID.exp2, ID.exp3, ID.exp4, ID.exp5] },
      pdf_field_name: "MonthExpense", is_required: false,
      question_i18n: t("2.B Total de gastos mensuales", "2.B Total average monthly expenses"),
      help_i18n: t("Se calcula solo: la suma de los cinco gastos de arriba.", "Computed automatically: the sum of the five expense rows above.") },
  ] },
  { title: t("Parte 3 — Cálculo", "Part 3 — Calculation"), do_not_fill: false, questions: [
    { id: ID.net, field_type: "number", source: "computed", source_ref: { op: "subtract", inputs: [ID.totinc, ID.totexp] },
      pdf_field_name: "TotalTot", is_required: false,
      question_i18n: t("TOTAL (ingresos menos gastos)", "TOTAL (income minus expenses)"),
      help_i18n: t("Se calcula solo: ingresos (1.A) menos gastos (2.B). Puede salir negativo, y eso AYUDA a tu solicitud.", "Computed automatically: income (1.A) minus expenses (2.B). It may be negative, which HELPS your request.") },
  ] },
  { title: t("Parte 4 — Explicación", "Part 4 — Explanation"), do_not_fill: false, questions: [
    { id: ID.info, field_type: "textarea", source: "client_answer", source_ref: null, pdf_field_name: "Information", is_required: true,
      question_i18n: t("Explica por qué no puedes pagar la tarifa de tu apelación", "Explain why you cannot pay the filing fee for your appeal"),
      help_i18n: t("MUY importante: si pusiste ceros o casi todo en cero, aquí DEBES explicar por qué (no puedes trabajar, discapacidad, sin permiso de trabajo, gastos médicos, dependientes, estás detenido, etc.). Sin explicación, es muy probable que te la nieguen.", "VERY important: if you entered zeros, you MUST explain why here (unable to work, disability, no work permit, medical bills, dependents, detained, etc.). Without an explanation the request is likely to be denied."),
      ai_improve: { instruction: "Mejora la redacción de la explicación del cliente sobre por qué no puede pagar la tarifa: hazla clara, respetuosa y en primera persona, SIN inventar hechos, montos ni circunstancias que el cliente no haya escrito. Conserva su significado. No agregues cifras." } },
  ] },
  { title: t("Sección del abogado (no llenar — pro se)", "Attorney section (leave blank — pro se)"), do_not_fill: true, questions: [
    { id: ID.attSig, field_type: "text", source: "client_answer", source_ref: null, pdf_field_name: "Signature of Attorney or Representative", is_required: false, question_i18n: t("Firma del abogado/representante", "Signature of Attorney or Representative") },
    { id: ID.attName, field_type: "text", source: "client_answer", source_ref: null, pdf_field_name: "Print Name", is_required: false, question_i18n: t("Nombre del abogado", "Attorney print name") },
    { id: ID.attEoir, field_type: "text", source: "client_answer", source_ref: null, pdf_field_name: "EOIR ID Number", is_required: false, question_i18n: t("Número EOIR del abogado", "EOIR ID Number") },
    { id: ID.attDate, field_type: "date", source: "client_answer", source_ref: null, pdf_field_name: "Date", is_required: false, question_i18n: t("Fecha", "Date") },
  ] },
];

(async () => {
  // 1. Resolve service + phase.
  const { data: svc } = await db.from("services").select("id, slug").eq("slug", "apelacion").maybeSingle();
  if (!svc) die("service", "apelacion not found");
  const { data: phase } = await db.from("service_phases").select("id, slug").eq("service_id", svc.id).order("position").limit(1).maybeSingle();
  if (!phase) die("phase", "no phase for apelacion");

  // 2. Idempotency — abort if eoir-26a already exists.
  const { data: existing } = await db.from("form_definitions").select("id").eq("service_phase_id", phase.id).eq("slug", "eoir-26a").maybeSingle();
  if (existing) die("idempotency", `eoir-26a already exists (${existing.id}) — delete it first to recreate`);

  // 3. Detect AcroForm fields (mupdf) from the official PDF.
  const bytes = new Uint8Array(fs.readFileSync(PDF_PATH));
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const detected = [];
  for (let i = 0; i < doc.countPages(); i++) {
    for (const w of doc.loadPage(i).getWidgets?.() ?? []) {
      const rawType = w.getFieldType?.() ?? "text";
      const type = ["text", "checkbox", "combobox", "radiobutton", "signature", "button"].includes(rawType) ? rawType : "text";
      detected.push({ pdf_field_name: w.getName?.() ?? "", field_type: type, page: i + 1, rect: (w.getBounds?.() ?? [0, 0, 0, 0]).map((x) => Math.round(x)) });
    }
  }
  const detectedNames = new Set(detected.map((d) => d.pdf_field_name));

  // 4. Inline validation (mirrors validateVersionPublication essentials).
  const allQ = GROUPS.flatMap((g) => g.questions);
  const idSet = new Set(allQ.map((q) => q.id));
  const seenPdf = new Set();
  const errors = [];
  for (const q of allQ) {
    if (q.pdf_field_name && !detectedNames.has(q.pdf_field_name)) errors.push(`campo inexistente en el PDF: "${q.pdf_field_name}"`);
    if (q.pdf_field_name) { if (seenPdf.has(q.pdf_field_name)) errors.push(`pdf_field_name duplicado: "${q.pdf_field_name}"`); seenPdf.add(q.pdf_field_name); }
    if (q.source === "computed") {
      const r = q.source_ref;
      if (r.op === "subtract" && r.inputs.length < 2) errors.push(`subtract con <2 inputs: ${q.id}`);
      for (const inp of r.inputs) {
        if (!idSet.has(inp)) errors.push(`operando inexistente ${inp} en ${q.id}`);
        const op = allQ.find((x) => x.id === inp);
        if (op && op.source !== "client_answer" && op.source !== "computed") errors.push(`operando de fuente inválida (${op.source}) en ${q.id}`);
      }
    }
  }
  if (errors.length) die("validation", "\n  - " + errors.join("\n  - "));

  // Verify the computed math on the guide's worked example (1400 income, 1900 expenses → -500).
  const cents = (n) => Math.round(n * 100);
  const sampleInc = cents(1400), sampleExp = cents(1900);
  const netCents = sampleInc - sampleExp;
  const fmt = (c) => { const neg = c < 0; const [i, d] = Math.abs(c / 100).toFixed(2).split("."); return `${neg ? "-" : ""}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${d}`; };
  console.log(`\n=== EOIR-26A plan ===`);
  console.log(`service=${svc.slug} phase=${phase.slug}  ·  ${GROUPS.length} grupos, ${allQ.length} preguntas, ${detected.length} campos detectados`);
  console.log(`computed check (guía §3): 1.A=${fmt(sampleInc)} · 2.B=${fmt(sampleExp)} · TOTAL=${fmt(netCents)} (esperado -500.00)`);
  if (fmt(netCents) !== "-500.00") die("computed-check", `formato inesperado: ${fmt(netCents)}`);
  console.log(`validación inline: OK (0 errores)\n`);
  for (const g of GROUPS) console.log(`  [${g.do_not_fill ? "no-llenar" : "llenable"}] ${g.title.es} — ${g.questions.length} preguntas`);

  if (!APPLY) { console.log(`\n(dry-run — nada escrito. Usa --apply para crear el borrador${PUBLISH ? " y publicar" : ""}.)`); return; }

  // 5. Upload PDF to catalog-assets.
  const formDefId = uid();
  const pdfPath = `forms/${formDefId}/${Date.now()}-EOIR-26A.pdf`;
  const up = await db.storage.from("catalog-assets").upload(pdfPath, Buffer.from(bytes), { contentType: "application/pdf", upsert: false });
  if (up.error) die("upload", up.error);

  // 6. form_definition.
  const fd = await db.from("form_definitions").insert({
    id: formDefId, service_phase_id: phase.id, slug: "eoir-26a", kind: "pdf_automation", filled_by: "client",
    is_per_party: false, is_required: false, position: 1, requires_documents_complete: false,
    label_i18n: t("Formulario EOIR-26A — Solicitud de Exención de Pago", "Form EOIR-26A — Fee Waiver Request"),
    description_i18n: t("Opcional. Pídelo si no puedes pagar la tarifa de la apelación.", "Optional. File it if you cannot pay the appeal fee."),
    is_active: true,
  }).select("id").single();
  if (fd.error) die("form_definition", fd.error);

  // 7. version (draft).
  const verId = uid();
  const ver = await db.from("form_automation_versions").insert({
    id: verId, form_definition_id: formDefId, version: 1, source_pdf_path: pdfPath, detected_fields: detected,
    status: "draft", source_language: "en", default_empty_policy: "blank",
  }).select("id").single();
  if (ver.error) die("version", ver.error);

  // 8. groups + questions.
  for (let gi = 0; gi < GROUPS.length; gi++) {
    const g = GROUPS[gi];
    const gid = uid();
    const gr = await db.from("form_question_groups").insert({ id: gid, automation_version_id: verId, title_i18n: g.title, position: gi, do_not_fill: g.do_not_fill });
    if (gr.error) die(`group ${gi}`, gr.error);
    const rows = g.questions.map((q, qi) => ({
      id: q.id, group_id: gid, question_i18n: q.question_i18n, help_i18n: q.help_i18n ?? null,
      field_type: q.field_type, options: q.options ?? null, pdf_field_name: q.pdf_field_name ?? null,
      source: q.source, source_ref: q.source_ref ?? null, is_required: q.is_required, position: qi,
      validation: null, condition: null, empty_policy: "inherit", empty_placeholder: null,
      no_translate: q.no_translate ?? false, ai_improve: q.ai_improve ?? null,
    }));
    const qr = await db.from("form_questions").insert(rows);
    if (qr.error) die(`questions ${gi}`, qr.error);
  }
  console.log(`\nOK — borrador creado: form_definition ${formDefId}, version ${verId} (draft).`);

  // 9. publish (only with --publish).
  if (PUBLISH) {
    const pub = await db.from("form_automation_versions").update({ status: "published", published_at: new Date().toISOString() }).eq("id", verId);
    if (pub.error) die("publish", pub.error);
    console.log(`OK — versión 1 PUBLICADA.`);
  } else {
    console.log(`(dejado como DRAFT — publícalo/verifícalo desde el editor de admin: "Generar PDF de prueba" corre la validación real antes de publicar.)`);
  }
  console.log("DONE");
})();
