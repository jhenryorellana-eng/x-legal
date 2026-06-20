/**
 * Adds required documents to both Asilo phases + the with_lawyer plan.
 * Idempotent-ish: deletes prior docs for these phases first.
 * Usage: SBTOKEN=<token> node docs/_evidence/asilo-docs-plan.cjs
 */
const PROJ = "uexxyokexcamyjcknxua";
const SVC = "344b44c9-0800-456d-87f7-d5c29e537d1b";
const PH_SUST = "10218501-fde6-488a-a11a-8b9ed4c41fc6"; // Sustentos
const PH_REF = "50465402-3ee9-458e-8057-533c71975a80"; // Reforzar
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.SBTOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (r.status >= 300) throw new Error(`HTTP ${r.status}: ${t}`);
  return t ? JSON.parse(t) : [];
};

const lbl = (es, en) => JSON.stringify({ es, en });

const SUST = [
  { slug: "pasaporte", es: "Pasaporte", en: "Passport", ai: true, req: true },
  { slug: "documento-identidad", es: "Cédula o documento de identidad", en: "National ID", ai: true, req: true },
  { slug: "i-94", es: "Formulario I-94 (registro de entrada)", en: "Form I-94", ai: false, req: true },
  { slug: "parole-nta", es: "Parole o Notice to Appear (NTA)", en: "Parole / Notice to Appear", ai: false, req: false },
  { slug: "acta-matrimonio", es: "Acta de matrimonio (si aplica)", en: "Marriage certificate (if applicable)", ai: false, req: false },
  { slug: "acta-nacimiento-hijos", es: "Acta de nacimiento de hijos (si aplica)", en: "Children's birth certificates (if applicable)", ai: false, req: false },
];
const REF = [
  { slug: "declaracion-jurada", es: "Declaración jurada (affidavit)", en: "Sworn declaration (affidavit)", ai: false, req: true },
  { slug: "evidencia-policial", es: "Denuncia o reporte policial", en: "Police report", ai: false, req: false },
  { slug: "evidencia-medica", es: "Informe médico", en: "Medical report", ai: false, req: false },
  { slug: "evidencia-psicologica", es: "Informe psicológico", en: "Psychological report", ai: false, req: false },
  { slug: "evidencia-amenazas", es: "Evidencia de amenazas (mensajes, cartas)", en: "Evidence of threats", ai: false, req: false },
  { slug: "evidencia-prensa", es: "Notas de prensa / condiciones del país", en: "Press / country-conditions evidence", ai: false, req: false },
  { slug: "carta-testigo", es: "Carta de testigo", en: "Witness letter", ai: false, req: false },
];

(async () => {
  await q(`delete from required_document_types where service_phase_id in ('${PH_SUST}','${PH_REF}');`);
  const ins = (phaseId, list) =>
    list.map((d, i) =>
      `('${phaseId}', '${d.slug}', $L$${lbl(d.es, d.en)}$L$, ${d.ai}, ${d.req}, ${i})`,
    ).join(",\n");
  await q(
    "insert into required_document_types (service_phase_id, slug, label_i18n, ai_extract, is_required, position) values\n" +
      ins(PH_SUST, SUST) + ",\n" + ins(PH_REF, REF) + ";",
  );

  // with_lawyer plan (idempotent on (service_id, kind))
  await q(
    `insert into service_plans (service_id, kind, price_cents, currency, requires_lawyer_validation, default_installments, default_downpayment_cents, is_active)
     values ('${SVC}', 'with_lawyer', 250000, 'USD', true, 12, 50000, true)
     on conflict do nothing;`,
  );

  // activate the service
  await q(`update services set is_active = true where id = '${SVC}';`);

  const docs = await q(`select sp.label_i18n->>'es' phase, count(*) n from required_document_types rdt join service_phases sp on sp.id=rdt.service_phase_id where sp.service_id='${SVC}' group by sp.label_i18n->>'es';`);
  const plans = await q(`select kind, price_cents from service_plans where service_id='${SVC}' order by kind;`);
  const svc = await q(`select is_active from services where id='${SVC}';`);
  console.log("docs:", JSON.stringify(docs), "\nplans:", JSON.stringify(plans), "\nactive:", JSON.stringify(svc));
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
